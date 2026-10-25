import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { getEnv, sessionSecret } from "@/config/env";
import { hmac, safeEqual } from "@/server/crypto";

/** Private object storage for evidence files. Nothing is ever publicly readable. */
export interface StorageProvider {
  readonly name: "local" | "supabase";
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  remove(key: string): Promise<void>;
  /** A URL that works for a short time only, for one object. */
  signedDownloadUrl(key: string, opts: { fileName: string; contentType: string; expiresInSeconds?: number }): Promise<string>;
}

export const DOWNLOAD_URL_TTL_SECONDS = 60;

/* ---------------------------- Local disk ---------------------------- */

interface LocalToken {
  k: string;
  n: string;
  t: string;
  e: number;
}

export function signLocalToken(payload: LocalToken): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${hmac(sessionSecret(), `file:${body}`)}`;
}

export function verifyLocalToken(token: string, now = Date.now()): LocalToken | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  if (!safeEqual(sig, hmac(sessionSecret(), `file:${body}`))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as LocalToken;
    if (typeof payload.e !== "number" || payload.e < now) return null;
    if (!/^evidence\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/.test(payload.k)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function localStorageProvider(root = getEnv().LOCAL_STORAGE_DIR): StorageProvider {
  const resolve = (key: string) => {
    const full = path.resolve(root, key);
    if (!full.startsWith(path.resolve(root) + path.sep)) throw new Error("Invalid storage key");
    return full;
  };
  return {
    name: "local",
    async put(key, bytes) {
      const full = resolve(key);
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, bytes, { mode: 0o600 });
    },
    async remove(key) {
      await rm(resolve(key), { force: true });
    },
    async signedDownloadUrl(key, { fileName, contentType, expiresInSeconds = DOWNLOAD_URL_TTL_SECONDS }) {
      const token = signLocalToken({ k: key, n: fileName, t: contentType, e: Date.now() + expiresInSeconds * 1000 });
      return `/api/files/${token}`;
    },
  };
}

export async function readLocalObject(key: string, root = getEnv().LOCAL_STORAGE_DIR): Promise<Buffer> {
  const full = path.resolve(root, key);
  if (!full.startsWith(path.resolve(root) + path.sep)) throw new Error("Invalid storage key");
  return readFile(full);
}

/* ----------------------------- Supabase ----------------------------- */

/** Uses a private bucket and the service role key on the server only. Not exercised against a live project here. */
export function supabaseStorageProvider(): StorageProvider {
  const env = getEnv();
  const client = createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const bucket = () => client.storage.from(env.SUPABASE_STORAGE_BUCKET);
  return {
    name: "supabase",
    async put(key, bytes, contentType) {
      const { error } = await bucket().upload(key, bytes, { contentType, upsert: false });
      if (error) throw new Error("Storage upload failed");
    },
    async remove(key) {
      const { error } = await bucket().remove([key]);
      if (error) throw new Error("Storage removal failed");
    },
    async signedDownloadUrl(key, { fileName, expiresInSeconds = DOWNLOAD_URL_TTL_SECONDS }) {
      const { data, error } = await bucket().createSignedUrl(key, expiresInSeconds, { download: fileName });
      if (error || !data) throw new Error("Could not create download link");
      return data.signedUrl;
    },
  };
}

let override: StorageProvider | null = null;
export function setStorageForTesting(p: StorageProvider | null) {
  override = p;
}

export function getStorage(): StorageProvider {
  if (override) return override;
  return getEnv().STORAGE_PROVIDER === "supabase" ? supabaseStorageProvider() : localStorageProvider();
}

/* --------------------------- Upload checks -------------------------- */

const ALLOWED: Record<string, { ext: string[]; magic?: number[][] }> = {
  "application/pdf": { ext: ["pdf"], magic: [[0x25, 0x50, 0x44, 0x46]] },
  "image/png": { ext: ["png"], magic: [[0x89, 0x50, 0x4e, 0x47]] },
  "image/jpeg": { ext: ["jpg", "jpeg"], magic: [[0xff, 0xd8, 0xff]] },
  "image/webp": { ext: ["webp"], magic: [[0x52, 0x49, 0x46, 0x46]] },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { ext: ["docx"], magic: [[0x50, 0x4b, 0x03, 0x04]] },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { ext: ["xlsx"], magic: [[0x50, 0x4b, 0x03, 0x04]] },
  "text/plain": { ext: ["txt"] },
};
export const allowedUploadTypes = Object.keys(ALLOWED);
export const allowedUploadExtensions = Object.values(ALLOWED).flatMap((v) => v.ext);

/** Checks size, declared type, extension and leading bytes. Returns an error message or null. */
export function checkUpload(file: { name: string; type: string; bytes: Uint8Array }, maxMb = getEnv().MAX_UPLOAD_MB): string | null {
  if (file.bytes.length === 0) return "The file is empty.";
  if (file.bytes.length > maxMb * 1024 * 1024) return `Files can be up to ${maxMb} MB.`;
  const rule = ALLOWED[file.type];
  if (!rule) return "Upload a PDF, image (PNG, JPEG, WebP), Word, Excel or plain-text file.";
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!rule.ext.includes(ext)) return "The file extension does not match its type.";
  if (rule.magic && !rule.magic.some((sig) => sig.every((b, i) => file.bytes[i] === b))) return "The file contents do not match its type.";
  return null;
}

/** Keeps a readable, harmless file name for downloads. */
export function safeFileName(name: string): string {
  const cleaned = name.replace(/[^\w.\- ]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 120);
  return cleaned || "evidence";
}

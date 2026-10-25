import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import * as schema from "@/server/db/schema";
import { setDbForTesting, type Database } from "@/server/db/client";
import { setStorageForTesting, type StorageProvider } from "@/server/storage";
import { resetEnvForTesting } from "@/config/env";

/** In-memory object storage that records what was stored and removed. */
export function memoryStorage() {
  const objects = new Map<string, Uint8Array>();
  const removed: string[] = [];
  const provider: StorageProvider = {
    name: "local",
    async put(key, bytes) {
      objects.set(key, bytes);
    },
    async remove(key) {
      objects.delete(key);
      removed.push(key);
    },
    async signedDownloadUrl(key) {
      return `memory://${key}?expires=60`;
    },
  };
  return { provider, objects, removed };
}

/** A fresh, fully migrated database for one test file. */
export async function setupTestDb() {
  resetEnvForTesting();
  const client = new PGlite();
  const db = drizzle(client, { schema }) as unknown as Database;
  await migrate(db as never, { migrationsFolder: path.join(__dirname, "../../drizzle") });
  setDbForTesting(db);
  const storage = memoryStorage();
  setStorageForTesting(storage.provider);
  return {
    db,
    client,
    storage,
    async close() {
      setDbForTesting(undefined);
      setStorageForTesting(null);
      await client.close();
    },
  };
}

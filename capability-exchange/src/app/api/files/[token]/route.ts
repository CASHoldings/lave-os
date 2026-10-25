import { NextResponse } from "next/server";
import { getEnv } from "@/config/env";
import { readLocalObject, verifyLocalToken } from "@/server/storage";
import { logError } from "@/server/log";

/**
 * Serves a file from local private storage when presented with a signed, unexpired token.
 * Tokens are only issued after a permission check. Not used with Supabase storage.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/files/[token]">) {
  const notFound = () => NextResponse.json({ message: "This download link has expired or is not valid." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  if (getEnv().STORAGE_PROVIDER !== "local") return notFound();
  const { token } = await ctx.params;
  const payload = verifyLocalToken(token);
  if (!payload) return notFound();
  try {
    const bytes = await readLocalObject(payload.k);
    const fileName = payload.n.replace(/[^\w.\- ]+/g, "_");
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": payload.t,
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    logError("files.read_failed", error);
    return notFound();
  }
}

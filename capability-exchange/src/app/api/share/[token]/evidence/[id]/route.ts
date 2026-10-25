import { authoriseEvidenceDownload } from "@/server/services/portfolio";
import { errorResponse, redirectNoStore } from "@/server/http";

export async function GET(request: Request, ctx: RouteContext<"/api/share/[token]/evidence/[id]">) {
  try {
    const { token, id } = await ctx.params;
    const { url } = await authoriseEvidenceDownload({ kind: "share", token }, id);
    return redirectNoStore(url, request.url);
  } catch (error) {
    return errorResponse("share_download", error);
  }
}

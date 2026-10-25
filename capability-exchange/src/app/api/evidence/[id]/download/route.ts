import { getCurrentActor } from "@/server/auth/current";
import { authoriseEvidenceDownload } from "@/server/services/portfolio";
import { errorResponse, redirectNoStore } from "@/server/http";

/** Checks permission for this viewer and file, then redirects to a link that expires in one minute. */
export async function GET(request: Request, ctx: RouteContext<"/api/evidence/[id]/download">) {
  try {
    const { id } = await ctx.params;
    const applicationId = new URL(request.url).searchParams.get("application");
    const actor = await getCurrentActor();
    const { url } = await authoriseEvidenceDownload(applicationId ? { kind: "application", actor, applicationId } : { kind: "live", actor }, id);
    return redirectNoStore(url, request.url);
  } catch (error) {
    return errorResponse("evidence_download", error);
  }
}

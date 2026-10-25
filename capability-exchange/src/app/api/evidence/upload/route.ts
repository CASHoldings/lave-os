import { NextResponse } from "next/server";
import { getCurrentActor } from "@/server/auth/current";
import { uploadEvidenceFile } from "@/server/services/portfolio";
import { errorResponse, sameOrigin } from "@/server/http";
import { getEnv } from "@/config/env";
import { unauthenticated, validationError } from "@/server/errors";

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return NextResponse.json({ message: "Request refused." }, { status: 403 });
    const actor = await getCurrentActor();
    if (!actor) throw unauthenticated();
    const maxBytes = getEnv().MAX_UPLOAD_MB * 1024 * 1024;
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (declared > maxBytes + 64 * 1024) throw validationError({ file: `Files can be up to ${getEnv().MAX_UPLOAD_MB} MB.` });
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw validationError({ file: "Choose a file to upload." });
    const id = await uploadEvidenceFile(
      actor,
      {
        title: form.get("title"),
        description: form.get("description"),
        isRedacted: form.get("isRedacted"),
        redactionNote: form.get("redactionNote"),
        visibility: form.get("visibility") || "private",
        claimId: form.get("claimId"),
      },
      { name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) },
    );
    return NextResponse.json({ id }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse("evidence_upload", error);
  }
}

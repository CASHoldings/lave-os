import { NextResponse } from "next/server";
import { getCurrentActor } from "@/server/auth/current";
import { exportAccountData } from "@/server/services/account-data";
import { errorResponse } from "@/server/http";
import { unauthenticated } from "@/server/errors";

export async function GET() {
  try {
    const actor = await getCurrentActor();
    if (!actor) throw unauthenticated();
    const data = await exportAccountData(actor);
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="account-export-${new Date().toISOString().slice(0, 10)}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return errorResponse("export", error);
  }
}

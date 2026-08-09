import { NextRequest, NextResponse } from "next/server";
import { runTranscodeMissionRecovery } from "@/lib/cron-jobs";
import { withApiHandler } from "@/lib/observability/api-handler";

async function GETHandler(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ success: true, ...(await runTranscodeMissionRecovery()) });
}

export const GET = withApiHandler(GETHandler);
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

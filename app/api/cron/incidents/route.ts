import { NextRequest, NextResponse } from "next/server";
import { withApiHandler } from "@/lib/observability/api-handler";
import { AppError } from "@/lib/observability/errors";
import { cleanupExpiredIncidents } from "@/lib/observability/incident-store";
import { logInfo } from "@/lib/observability/logger";

async function GETHandler(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    throw new AppError({
      code: "CRON_NOT_CONFIGURED",
      status: 503,
      safeMessage: "Scheduled maintenance is unavailable.",
      cause: new Error("CRON_SECRET is not configured"),
    });
  }

  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const deleted = await cleanupExpiredIncidents();
  logInfo("incident.retention_cleanup_completed", { deletedCount: deleted }, "Expired incidents deleted");
  return NextResponse.json({ success: true, deleted });
}

export const GET = withApiHandler(GETHandler);


export const dynamic = "force-dynamic";

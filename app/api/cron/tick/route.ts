import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { runCronTick } from "@/lib/cron-scheduler";
import { withApiHandler } from "@/lib/observability/api-handler";
import { AppError } from "@/lib/observability/errors";

function secretsMatch(provided: string, expected: string): boolean {
  const providedDigest = createHash("sha256").update(provided).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}

async function POSTHandler(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new AppError({
      code: "CRON_NOT_CONFIGURED",
      status: 503,
      safeMessage: "Scheduled maintenance is unavailable.",
      cause: new Error("CRON_SECRET must be configured with at least 32 characters"),
    });
  }

  const authorization = request.headers.get("authorization") || "";
  const prefix = "Bearer ";
  const provided = authorization.startsWith(prefix) ? authorization.slice(prefix.length) : "";
  if (!provided || !secretsMatch(provided, secret)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const result = await runCronTick();
  return NextResponse.json(result, {
    status: result.success ? 200 : 500,
    headers: { "Cache-Control": "no-store" },
  });
}

export const POST = withApiHandler(POSTHandler);
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

import { createHash, timingSafeEqual } from "node:crypto";
import { performance } from "node:perf_hooks";
import { NextRequest, NextResponse } from "next/server";
import { serverlessCronJobs, type CronJobResult } from "@/lib/cron-jobs";
import { withApiHandler } from "@/lib/observability/api-handler";
import { AppError } from "@/lib/observability/errors";
import { runBackgroundJob } from "@/lib/observability/background-job";

type JobRun = {
  name: string;
  schedule: string;
  status: "completed" | "failed";
  durationMs: number;
  result?: CronJobResult;
};

function apiKeysMatch(provided: string, expected: string): boolean {
  const providedDigest = createHash("sha256").update(provided).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}

async function POSTHandler(request: NextRequest) {
  const expectedApiKey = process.env.CRON_API_KEY;
  if (!expectedApiKey) {
    throw new AppError({
      code: "CRON_NOT_CONFIGURED",
      status: 503,
      safeMessage: "Cron execution is unavailable.",
      cause: new Error("CRON_API_KEY is not configured"),
    });
  }

  const providedApiKey = request.headers.get("x-api-key") ?? "";
  if (!providedApiKey || !apiKeysMatch(providedApiKey, expectedApiKey)) {
    return NextResponse.json(
      { error: "Unauthorized", code: "UNAUTHORIZED" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const startedAt = new Date();
  const jobs: JobRun[] = [];

  // Keep the execution order deterministic. Several jobs operate on the same
  // groups and assignments, so running them concurrently can create races.
  for (const job of serverlessCronJobs) {
    const jobStartedAt = performance.now();
    const result = await runBackgroundJob(job.name, job.run);
    jobs.push({
      name: job.name,
      schedule: job.schedule,
      status: result === undefined ? "failed" : "completed",
      durationMs: Math.round((performance.now() - jobStartedAt) * 100) / 100,
      ...(result === undefined ? {} : { result }),
    });
  }

  const completedAt = new Date();
  const allSucceeded = jobs.every((job) => job.status === "completed");
  return NextResponse.json(
    {
      success: allSucceeded,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - startedAt.getTime(),
      jobs,
    },
    {
      status: allSucceeded ? 200 : 207,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

export const POST = withApiHandler(POSTHandler);
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

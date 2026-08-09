import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Prisma } from "@prisma/client";
import { cronJobs, type CronJobDefinition, type CronJobResult } from "@/lib/cron-jobs";
import { nextScheduledAt } from "@/lib/cron-schedule";
import { db } from "@/lib/db";
import { logInfo, reportError, serializeUnknownError } from "@/lib/observability/logger";
import { runWithRequestContext } from "@/lib/observability/request-context";

const LEASE_MS = 10 * 60 * 1_000;
const RETRY_DELAYS_MS = [60_000, 2 * 60_000, 5 * 60_000, 10 * 60_000, 15 * 60_000] as const;

type ClaimedState = {
  nextRunAt: Date | string;
  consecutiveFailures: number;
  leaseExpiresAt: Date | string;
};

type ClaimedJob = {
  definition: CronJobDefinition;
  leaseOwner: string;
  runId: string;
  scheduledFor: Date;
  attempt: number;
  leaseExpiresAt: Date;
};

export type CronTickJobResult = {
  name: string;
  runId: string;
  scheduledFor: string;
  attempt: number;
  status: "SUCCEEDED" | "FAILED";
  durationMs: number;
  result?: CronJobResult;
  retryAt?: string;
  logId?: string;
};

export type CronTickResult = {
  tickId: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  configuredJobs: number;
  claimedJobs: number;
  skippedJobs: number;
  success: boolean;
  jobs: CronTickJobResult[];
};

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function retryDelayMs(consecutiveFailures: number): number {
  return RETRY_DELAYS_MS[Math.min(Math.max(1, consecutiveFailures), RETRY_DELAYS_MS.length) - 1];
}

async function claimJob(definition: CronJobDefinition, tickId: string, now: Date): Promise<ClaimedJob | null> {
  const leaseOwner = `${tickId}:${definition.name}`;
  const leaseExpiresAt = new Date(now.getTime() + LEASE_MS);
  // On first deployment, minute jobs are immediately eligible while slower
  // jobs wait for their next normal calendar slot. Existing rows retain missed
  // nextRunAt values so downtime causes one catch-up run, not a burst per slot.
  const initialNextRunAt = nextScheduledAt(definition.schedule, new Date(now.getTime() - 60_000));

  return db.$transaction(async (tx) => {
    await tx.cronJobState.upsert({
      where: { name: definition.name },
      create: { name: definition.name, schedule: definition.schedule, nextRunAt: initialNextRunAt },
      update: { schedule: definition.schedule },
    });

    const claimed = await tx.$queryRaw<ClaimedState[]>`
      UPDATE "cron_job_states"
      SET
        "leaseOwner" = ${leaseOwner},
        "leaseExpiresAt" = ${leaseExpiresAt},
        "lastStartedAt" = ${now},
        "updatedAt" = ${now}
      WHERE "name" = ${definition.name}
        AND "nextRunAt" <= ${now}
        AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" <= ${now})
      RETURNING "nextRunAt", "consecutiveFailures", "leaseExpiresAt"
    `;
    if (!claimed[0]) return null;

    await tx.cronJobRun.updateMany({
      where: { jobName: definition.name, status: "RUNNING", completedAt: null },
      data: {
        status: "ABANDONED",
        completedAt: now,
        error: jsonValue({ code: "LEASE_EXPIRED", message: "A later tick reclaimed this job after its execution lease expired." }),
      },
    });

    const run = await tx.cronJobRun.create({
      data: {
        jobName: definition.name,
        tickId,
        scheduledFor: new Date(claimed[0].nextRunAt),
        attempt: claimed[0].consecutiveFailures + 1,
        status: "RUNNING",
        startedAt: now,
      },
      select: { id: true },
    });

    return {
      definition,
      leaseOwner,
      runId: run.id,
      scheduledFor: new Date(claimed[0].nextRunAt),
      attempt: claimed[0].consecutiveFailures + 1,
      leaseExpiresAt: new Date(claimed[0].leaseExpiresAt),
    };
  });
}

async function finishSuccess(claim: ClaimedJob, result: CronJobResult, completedAt: Date, durationMs: number): Promise<void> {
  const nextRunAt = nextScheduledAt(claim.definition.schedule, completedAt);
  await db.$transaction(async (tx) => {
    const released = await tx.cronJobState.updateMany({
      where: { name: claim.definition.name, leaseOwner: claim.leaseOwner },
      data: {
        nextRunAt,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastCompletedAt: completedAt,
        lastSucceededAt: completedAt,
        consecutiveFailures: 0,
        lastResult: jsonValue(result),
        lastError: Prisma.DbNull,
      },
    });
    if (released.count !== 1) throw new Error(`Cron lease ownership was lost before ${claim.definition.name} completed`);
    await tx.cronJobRun.update({
      where: { id: claim.runId },
      data: { status: "SUCCEEDED", completedAt, durationMs, result: jsonValue(result) },
    });
  });
}

async function finishFailure(claim: ClaimedJob, error: unknown, logId: string, completedAt: Date, durationMs: number): Promise<Date> {
  const failureCount = claim.attempt;
  const retryAt = new Date(completedAt.getTime() + retryDelayMs(failureCount));
  const serialized = { logId, ...serializeUnknownError(error), retryAt: retryAt.toISOString() };
  await db.$transaction(async (tx) => {
    const released = await tx.cronJobState.updateMany({
      where: { name: claim.definition.name, leaseOwner: claim.leaseOwner },
      data: {
        nextRunAt: retryAt,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastCompletedAt: completedAt,
        lastFailedAt: completedAt,
        consecutiveFailures: failureCount,
        lastError: jsonValue(serialized),
      },
    });
    if (released.count !== 1) throw new Error(`Cron lease ownership was lost while ${claim.definition.name} was failing`);
    await tx.cronJobRun.update({
      where: { id: claim.runId },
      data: { status: "FAILED", completedAt, durationMs, error: jsonValue(serialized) },
    });
  });
  return retryAt;
}

async function executeClaim(claim: ClaimedJob, tickId: string): Promise<CronTickJobResult> {
  const startedAt = performance.now();
  return runWithRequestContext(
    { requestId: tickId, jobRunId: claim.runId, method: "CRON", route: `cron:${claim.definition.name}` },
    async () => {
      logInfo("cron.job.started", {
        tickId,
        cronJob: claim.definition.name,
        cronRunId: claim.runId,
        schedule: claim.definition.schedule,
        scheduledFor: claim.scheduledFor,
        leaseExpiresAt: claim.leaseExpiresAt,
        attempt: claim.attempt,
      }, "Scheduled job started");
      try {
        const result = await claim.definition.run();
        const completedAt = new Date();
        const durationMs = Math.round(performance.now() - startedAt);
        await finishSuccess(claim, result, completedAt, durationMs);
        logInfo("cron.job.completed", {
          tickId,
          cronJob: claim.definition.name,
          cronRunId: claim.runId,
          scheduledFor: claim.scheduledFor,
          durationMs,
          result,
        }, "Scheduled job completed");
        return {
          name: claim.definition.name,
          runId: claim.runId,
          scheduledFor: claim.scheduledFor.toISOString(),
          attempt: claim.attempt,
          status: "SUCCEEDED",
          durationMs,
          result,
        };
      } catch (error: unknown) {
        const completedAt = new Date();
        const durationMs = Math.round(performance.now() - startedAt);
        const logId = reportError("cron.job.failed", error, {
          tickId,
          cronJob: claim.definition.name,
          cronRunId: claim.runId,
          schedule: claim.definition.schedule,
          scheduledFor: claim.scheduledFor,
          attempt: claim.attempt,
          durationMs,
        }, "Scheduled job failed and will retry");
        const retryAt = await finishFailure(claim, error, logId, completedAt, durationMs);
        return {
          name: claim.definition.name,
          runId: claim.runId,
          scheduledFor: claim.scheduledFor.toISOString(),
          attempt: claim.attempt,
          status: "FAILED",
          durationMs,
          retryAt: retryAt.toISOString(),
          logId,
        };
      }
    },
  );
}

export async function runCronTick(): Promise<CronTickResult> {
  const tickId = randomUUID();
  const startedAt = new Date();
  const startedPerformance = performance.now();
  logInfo("cron.tick.started", { tickId, configuredJobs: cronJobs.length }, "External cron scheduler tick started");

  // Claim every due job before executing any work. This closes the race where
  // a second one-minute trigger could otherwise claim later jobs while the
  // first invocation is still busy with an earlier job.
  const claimed: ClaimedJob[] = [];
  for (const definition of cronJobs) {
    const job = await claimJob(definition, tickId, startedAt);
    if (job) claimed.push(job);
  }

  logInfo("cron.tick.claimed", {
    tickId,
    configuredJobs: cronJobs.length,
    claimedJobs: claimed.map((job) => ({ name: job.definition.name, runId: job.runId, scheduledFor: job.scheduledFor })),
    skippedJobs: cronJobs.length - claimed.length,
  }, "Due cron jobs claimed with durable leases");

  const jobs: CronTickJobResult[] = [];
  for (const claim of claimed) jobs.push(await executeClaim(claim, tickId));

  const completedAt = new Date();
  const result: CronTickResult = {
    tickId,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: Math.round(performance.now() - startedPerformance),
    configuredJobs: cronJobs.length,
    claimedJobs: claimed.length,
    skippedJobs: cronJobs.length - claimed.length,
    success: jobs.every((job) => job.status === "SUCCEEDED"),
    jobs,
  };
  logInfo("cron.tick.completed", result, result.success ? "External cron scheduler tick completed" : "External cron scheduler tick completed with failed jobs");
  return result;
}

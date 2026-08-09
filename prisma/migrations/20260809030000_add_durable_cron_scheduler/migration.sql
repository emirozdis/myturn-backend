CREATE TABLE "cron_job_states" (
  "name" TEXT NOT NULL,
  "schedule" TEXT NOT NULL,
  "nextRunAt" TIMESTAMPTZ(3) NOT NULL,
  "leaseOwner" TEXT,
  "leaseExpiresAt" TIMESTAMPTZ(3),
  "lastStartedAt" TIMESTAMPTZ(3),
  "lastCompletedAt" TIMESTAMPTZ(3),
  "lastSucceededAt" TIMESTAMPTZ(3),
  "lastFailedAt" TIMESTAMPTZ(3),
  "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
  "lastResult" JSONB,
  "lastError" JSONB,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cron_job_states_pkey" PRIMARY KEY ("name"),
  CONSTRAINT "cron_job_states_failures_check" CHECK ("consecutiveFailures" >= 0)
);

CREATE TABLE "cron_job_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "jobName" TEXT NOT NULL,
  "tickId" UUID NOT NULL,
  "scheduledFor" TIMESTAMPTZ(3) NOT NULL,
  "attempt" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "startedAt" TIMESTAMPTZ(3) NOT NULL,
  "completedAt" TIMESTAMPTZ(3),
  "durationMs" INTEGER,
  "result" JSONB,
  "error" JSONB,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cron_job_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "cron_job_runs_attempt_check" CHECK ("attempt" >= 1),
  CONSTRAINT "cron_job_runs_status_check" CHECK ("status" IN ('RUNNING', 'SUCCEEDED', 'FAILED', 'ABANDONED')),
  CONSTRAINT "cron_job_runs_duration_check" CHECK ("durationMs" IS NULL OR "durationMs" >= 0),
  CONSTRAINT "cron_job_runs_jobName_fkey" FOREIGN KEY ("jobName") REFERENCES "cron_job_states"("name") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "cron_job_states_nextRunAt_leaseExpiresAt_idx"
ON "cron_job_states"("nextRunAt", "leaseExpiresAt");

CREATE INDEX "cron_job_runs_jobName_startedAt_idx"
ON "cron_job_runs"("jobName", "startedAt");

CREATE INDEX "cron_job_runs_status_startedAt_idx"
ON "cron_job_runs"("status", "startedAt");

CREATE INDEX "cron_job_runs_tickId_idx"
ON "cron_job_runs"("tickId");

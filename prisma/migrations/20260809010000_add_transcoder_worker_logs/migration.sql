ALTER TABLE "transcoder_supervisor_config"
ADD COLUMN "workerLogRetentionDays" INTEGER NOT NULL DEFAULT 30;

ALTER TABLE "transcoder_supervisor_config"
ADD CONSTRAINT "transcoder_supervisor_config_worker_log_retention_check"
CHECK ("workerLogRetentionDays" BETWEEN 0 AND 3650);

CREATE TABLE "transcoder_worker_logs" (
  "id" UUID NOT NULL,
  "instanceId" UUID,
  "vastInstanceId" INTEGER,
  "instanceLabel" TEXT,
  "jobId" TEXT,
  "level" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "service" TEXT NOT NULL,
  "correlationId" TEXT,
  "context" JSONB,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL,
  "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "transcoder_worker_logs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "transcoder_worker_logs_instance_fkey" FOREIGN KEY ("instanceId") REFERENCES "transcoder_instances"("id") ON DELETE SET NULL
);

CREATE INDEX "transcoder_worker_logs_occurredAt_idx" ON "transcoder_worker_logs"("occurredAt");
CREATE INDEX "transcoder_worker_logs_level_occurredAt_idx" ON "transcoder_worker_logs"("level", "occurredAt");
CREATE INDEX "transcoder_worker_logs_jobId_occurredAt_idx" ON "transcoder_worker_logs"("jobId", "occurredAt");
CREATE INDEX "transcoder_worker_logs_vastInstanceId_occurredAt_idx" ON "transcoder_worker_logs"("vastInstanceId", "occurredAt");

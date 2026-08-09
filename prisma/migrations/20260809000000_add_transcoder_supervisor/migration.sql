CREATE TABLE "transcoder_supervisor_config" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "maxHourlyPrice" DECIMAL(10,4) NOT NULL DEFAULT 1.5,
  "verifiedOnly" BOOLEAN NOT NULL DEFAULT true,
  "datacenterOnly" BOOLEAN NOT NULL DEFAULT true,
  "requireFullMachine" BOOLEAN NOT NULL DEFAULT false,
  "allowedGpuModels" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "minimumGpuRamMb" INTEGER NOT NULL DEFAULT 16000,
  "minimumCpuCores" INTEGER NOT NULL DEFAULT 4,
  "minimumRamMb" INTEGER NOT NULL DEFAULT 16000,
  "minimumReliability" DOUBLE PRECISION NOT NULL DEFAULT 0.98,
  "minimumDownloadMbps" DOUBLE PRECISION NOT NULL DEFAULT 200,
  "minimumUploadMbps" DOUBLE PRECISION NOT NULL DEFAULT 100,
  "diskGb" INTEGER NOT NULL DEFAULT 20,
  "offerSearchLimit" INTEGER NOT NULL DEFAULT 100,
  "maxWorkers" INTEGER NOT NULL DEFAULT 1,
  "jobsPerWorker" INTEGER NOT NULL DEFAULT 1,
  "queueDepthPerNewWorker" INTEGER NOT NULL DEFAULT 1,
  "idleTimeoutSeconds" INTEGER NOT NULL DEFAULT 300,
  "idleAction" TEXT NOT NULL DEFAULT 'DESTROY',
  "startupTimeoutSeconds" INTEGER NOT NULL DEFAULT 600,
  "healthPollSeconds" INTEGER NOT NULL DEFAULT 5,
  "maxInstanceFailures" INTEGER NOT NULL DEFAULT 3,
  "maxMissionAttempts" INTEGER NOT NULL DEFAULT 3,
  "vastTemplateHash" TEXT NOT NULL,
  "policyVersion" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "transcoder_supervisor_config_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "transcoder_supervisor_config_idle_action_check" CHECK ("idleAction" IN ('STOP', 'DESTROY')),
  CONSTRAINT "transcoder_supervisor_config_limits_check" CHECK (
    "maxHourlyPrice" > 0 AND "minimumGpuRamMb" > 0 AND "minimumCpuCores" > 0 AND
    "minimumRamMb" > 0 AND "minimumReliability" BETWEEN 0 AND 1 AND "diskGb" >= 10 AND
    "offerSearchLimit" BETWEEN 1 AND 500 AND "maxWorkers" BETWEEN 1 AND 20 AND
    "jobsPerWorker" BETWEEN 1 AND 20 AND "queueDepthPerNewWorker" BETWEEN 1 AND 100 AND
    "idleTimeoutSeconds" BETWEEN 30 AND 86400 AND "startupTimeoutSeconds" BETWEEN 60 AND 3600 AND
    "healthPollSeconds" BETWEEN 2 AND 60 AND "maxInstanceFailures" BETWEEN 1 AND 20 AND
    "maxMissionAttempts" BETWEEN 1 AND 10
  )
);

CREATE TABLE "transcoder_instances" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "vastInstanceId" INTEGER NOT NULL,
  "offerId" INTEGER,
  "machineId" INTEGER,
  "state" TEXT NOT NULL,
  "workerUrl" TEXT,
  "gpuName" TEXT,
  "hourlyPrice" DECIMAL(10,4),
  "fullMachine" BOOLEAN NOT NULL DEFAULT false,
  "classification" JSONB,
  "healthStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
  "successfulJobs" INTEGER NOT NULL DEFAULT 0,
  "failedJobs" INTEGER NOT NULL DEFAULT 0,
  "lastHeartbeatAt" TIMESTAMPTZ(3),
  "idleSince" TIMESTAMPTZ(3),
  "startedAt" TIMESTAMPTZ(3),
  "terminatedAt" TIMESTAMPTZ(3),
  "lastError" TEXT,
  "rawState" JSONB,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "transcoder_instances_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "transcoder_missions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "externalId" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "priority" INTEGER NOT NULL DEFAULT 0,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "assignedInstanceId" UUID,
  "lastErrorCode" TEXT,
  "lastErrorMessage" TEXT,
  "registeredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dispatchedAt" TIMESTAMPTZ(3),
  "completedAt" TIMESTAMPTZ(3),
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "transcoder_missions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "transcoder_missions_instance_fkey" FOREIGN KEY ("assignedInstanceId") REFERENCES "transcoder_instances"("id") ON DELETE SET NULL
);

CREATE TABLE "transcoder_supervisor_events" (
  "id" BIGSERIAL NOT NULL,
  "severity" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "missionId" UUID,
  "instanceId" UUID,
  "context" JSONB,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "transcoder_supervisor_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "transcoder_supervisor_events_mission_fkey" FOREIGN KEY ("missionId") REFERENCES "transcoder_missions"("id") ON DELETE SET NULL,
  CONSTRAINT "transcoder_supervisor_events_instance_fkey" FOREIGN KEY ("instanceId") REFERENCES "transcoder_instances"("id") ON DELETE SET NULL
);

CREATE UNIQUE INDEX "transcoder_instances_vastInstanceId_key" ON "transcoder_instances"("vastInstanceId");
CREATE INDEX "transcoder_instances_state_healthStatus_updatedAt_idx" ON "transcoder_instances"("state", "healthStatus", "updatedAt");
CREATE UNIQUE INDEX "transcoder_missions_externalId_key" ON "transcoder_missions"("externalId");
CREATE INDEX "transcoder_missions_status_availableAt_priority_registeredAt_idx" ON "transcoder_missions"("status", "availableAt", "priority", "registeredAt");
CREATE INDEX "transcoder_missions_assignedInstanceId_status_idx" ON "transcoder_missions"("assignedInstanceId", "status");
CREATE INDEX "transcoder_supervisor_events_createdAt_idx" ON "transcoder_supervisor_events"("createdAt");
CREATE INDEX "transcoder_supervisor_events_severity_createdAt_idx" ON "transcoder_supervisor_events"("severity", "createdAt");
CREATE INDEX "transcoder_supervisor_events_missionId_createdAt_idx" ON "transcoder_supervisor_events"("missionId", "createdAt");
CREATE INDEX "transcoder_supervisor_events_instanceId_createdAt_idx" ON "transcoder_supervisor_events"("instanceId", "createdAt");

-- Cut over unfinished work from the former direct-worker dispatcher. Completed
-- media is untouched; unfinished durable R2 sources are re-registered with the
-- new supervisor by upload finalization or the recovery cron.
UPDATE "clips"
SET "transcodeStatus" = 'QUEUED', "transcodeJobId" = NULL, "transcodeDispatchAt" = NULL
WHERE "mediaType" <> 'photo'
  AND "finalizedAt" IS NOT NULL
  AND "transcodeReadyAt" IS NULL
  AND "transcodeStatus" IN ('QUEUED', 'DISPATCHING', 'PROCESSING', 'FAILED');

UPDATE "photo_responses"
SET "transcodeStatus" = 'QUEUED', "transcodeJobId" = NULL, "transcodeDispatchAt" = NULL
WHERE "mediaType" <> 'photo'
  AND "transcodeStatus" IN ('QUEUED', 'DISPATCHING', 'PROCESSING', 'FAILED');

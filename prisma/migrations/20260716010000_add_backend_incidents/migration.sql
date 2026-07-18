CREATE TABLE "backend_incidents" (
    "id" TEXT NOT NULL,
    "requestId" TEXT,
    "jobRunId" TEXT,
    "level" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "code" TEXT,
    "route" TEXT,
    "method" TEXT,
    "status" INTEGER,
    "userId" TEXT,
    "groupId" TEXT,
    "clipId" TEXT,
    "errorType" TEXT,
    "errorMessage" TEXT,
    "stack" TEXT,
    "context" JSONB,
    "environment" TEXT NOT NULL,
    "release" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "backend_incidents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "backend_incidents_requestId_idx" ON "backend_incidents"("requestId");
CREATE INDEX "backend_incidents_jobRunId_idx" ON "backend_incidents"("jobRunId");
CREATE INDEX "backend_incidents_level_createdAt_idx" ON "backend_incidents"("level", "createdAt");
CREATE INDEX "backend_incidents_event_createdAt_idx" ON "backend_incidents"("event", "createdAt");
CREATE INDEX "backend_incidents_expiresAt_idx" ON "backend_incidents"("expiresAt");

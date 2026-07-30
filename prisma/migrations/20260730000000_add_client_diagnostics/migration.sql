ALTER TABLE "backend_incidents"
ADD COLUMN "source" TEXT NOT NULL DEFAULT 'server',
ADD COLUMN "clientIncidentId" TEXT,
ADD COLUMN "clientRequestId" TEXT,
ADD COLUMN "operationId" TEXT,
ADD COLUMN "installationIdHash" TEXT,
ADD COLUMN "appSessionId" TEXT,
ADD COLUMN "authState" TEXT,
ADD COLUMN "reportedUserId" TEXT,
ADD COLUMN "fingerprint" TEXT,
ADD COLUMN "occurredAt" TIMESTAMP(3),
ADD COLUMN "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "durationMs" INTEGER,
ADD COLUMN "retryNumber" INTEGER,
ADD COLUMN "recovered" BOOLEAN,
ADD COLUMN "deviceContext" JSONB,
ADD COLUMN "networkContext" JSONB,
ADD COLUMN "appContext" JSONB,
ADD COLUMN "finalizedAt" TIMESTAMP(3);

CREATE TABLE "incident_breadcrumbs" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "phase" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "category" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "outcome" TEXT,
    "durationMs" INTEGER,
    "status" INTEGER,
    "code" TEXT,
    "context" JSONB,
    CONSTRAINT "incident_breadcrumbs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "backend_incidents_clientIncidentId_key" ON "backend_incidents"("clientIncidentId");
CREATE INDEX "backend_incidents_clientRequestId_idx" ON "backend_incidents"("clientRequestId");
CREATE INDEX "backend_incidents_operationId_idx" ON "backend_incidents"("operationId");
CREATE INDEX "backend_incidents_installationIdHash_occurredAt_idx" ON "backend_incidents"("installationIdHash", "occurredAt");
CREATE INDEX "backend_incidents_userId_occurredAt_idx" ON "backend_incidents"("userId", "occurredAt");
CREATE INDEX "backend_incidents_fingerprint_occurredAt_idx" ON "backend_incidents"("fingerprint", "occurredAt");
CREATE UNIQUE INDEX "incident_breadcrumbs_incidentId_sequence_key" ON "incident_breadcrumbs"("incidentId", "sequence");
CREATE INDEX "incident_breadcrumbs_incidentId_occurredAt_idx" ON "incident_breadcrumbs"("incidentId", "occurredAt");

ALTER TABLE "incident_breadcrumbs"
ADD CONSTRAINT "incident_breadcrumbs_incidentId_fkey"
FOREIGN KEY ("incidentId") REFERENCES "backend_incidents"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

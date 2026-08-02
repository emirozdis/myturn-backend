ALTER TABLE "profiles"
ADD COLUMN "isSuspended" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "suspendedAt" TIMESTAMPTZ(3),
ADD COLUMN "suspensionReason" TEXT;

CREATE TABLE "admin_audit_logs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "actorEmail" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "targetType" TEXT,
  "targetId" TEXT,
  "details" JSONB,
  "ipAddress" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "admin_audit_logs_createdAt_idx"
ON "admin_audit_logs"("createdAt");

CREATE INDEX "admin_audit_logs_action_createdAt_idx"
ON "admin_audit_logs"("action", "createdAt");

CREATE INDEX "admin_audit_logs_targetType_targetId_createdAt_idx"
ON "admin_audit_logs"("targetType", "targetId", "createdAt");

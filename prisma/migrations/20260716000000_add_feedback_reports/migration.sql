CREATE TABLE "feedback_reports" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "screen" TEXT,
    "appVersion" TEXT,
    "screenshotPath" TEXT,
    "logs" TEXT,
    "deviceInfo" TEXT,
    "includedScreenshot" BOOLEAN NOT NULL DEFAULT false,
    "includedLogs" BOOLEAN NOT NULL DEFAULT false,
    "includedDeviceInfo" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feedback_reports_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "feedback_reports_userId_createdAt_idx" ON "feedback_reports"("userId", "createdAt");
CREATE INDEX "feedback_reports_status_createdAt_idx" ON "feedback_reports"("status", "createdAt");

ALTER TABLE "feedback_reports"
ADD CONSTRAINT "feedback_reports_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

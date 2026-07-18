ALTER TABLE "clips"
  ADD COLUMN "finalizedAt" TIMESTAMP(3),
  ADD COLUMN "transcodeDispatchAt" TIMESTAMP(3);

-- Historical non-uploading clips already passed the legacy reward path.
UPDATE "clips" SET "finalizedAt" = "recordedAt" WHERE "transcodeStatus" <> 'UPLOADING';

CREATE UNIQUE INDEX "clips_transcodeJobId_key" ON "clips"("transcodeJobId");

CREATE TABLE "boost_purchases" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "transactionId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "store" TEXT,
  "isSandbox" BOOLEAN NOT NULL DEFAULT false,
  "purchasedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "boost_purchases_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "boost_purchases_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "boost_purchases_transactionId_key" ON "boost_purchases"("transactionId");
CREATE INDEX "boost_purchases_userId_purchasedAt_idx" ON "boost_purchases"("userId", "purchasedAt");

CREATE TABLE "transcoder_webhook_events" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "event" TEXT NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  CONSTRAINT "transcoder_webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "transcoder_webhook_events_jobId_idx" ON "transcoder_webhook_events"("jobId");
CREATE UNIQUE INDEX "transcoder_webhook_events_jobId_event_key" ON "transcoder_webhook_events"("jobId", "event");

CREATE TABLE "media_upload_grants" (
  "id" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "clipId" TEXT NOT NULL,
  "mediaType" TEXT NOT NULL,
  "contentType" TEXT NOT NULL,
  "maxBytes" INTEGER NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "media_upload_grants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "media_upload_grants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "media_upload_grants_clipId_fkey" FOREIGN KEY ("clipId") REFERENCES "clips"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "media_upload_grants_path_key" ON "media_upload_grants"("path");
CREATE INDEX "media_upload_grants_userId_clipId_idx" ON "media_upload_grants"("userId", "clipId");

ALTER TABLE "active_uploads"
  ADD COLUMN "clipId" TEXT,
  ADD COLUMN "contentType" TEXT,
  ADD COLUMN "expectedChunks" INTEGER,
  ADD COLUMN "expectedBytes" BIGINT,
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'INITIATED',
  ADD COLUMN "expiresAt" TIMESTAMP(3),
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Existing sessions cannot be safely resumed because their expected size and
-- part count were never recorded. Preserve their storage identifiers so the
-- API can abort their multipart fragments on the next client reconciliation.
UPDATE "active_uploads"
SET
  "clipId" = 'legacy-' || "id",
  "contentType" = 'application/octet-stream',
  "expectedChunks" = 0,
  "expectedBytes" = 0,
  "status" = 'LEGACY_REJECTED',
  "expiresAt" = CURRENT_TIMESTAMP;

ALTER TABLE "active_uploads"
  ALTER COLUMN "clipId" SET NOT NULL,
  ALTER COLUMN "contentType" SET NOT NULL,
  ALTER COLUMN "expectedChunks" SET NOT NULL,
  ALTER COLUMN "expectedBytes" SET NOT NULL,
  ALTER COLUMN "expiresAt" SET NOT NULL;

CREATE UNIQUE INDEX "active_uploads_clipId_key" ON "active_uploads"("clipId");

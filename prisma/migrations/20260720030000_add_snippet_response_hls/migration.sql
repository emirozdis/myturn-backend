ALTER TABLE "photo_responses"
  ADD COLUMN "hlsUrl" TEXT,
  ADD COLUMN "transcodeStatus" TEXT NOT NULL DEFAULT 'COMPLETED',
  ADD COLUMN "transcodeAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "transcodeJobId" TEXT,
  ADD COLUMN "transcodeDispatchAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "photo_responses_transcodeJobId_key"
  ON "photo_responses"("transcodeJobId");

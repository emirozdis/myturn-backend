-- Processing completion and publication are separate events. A ready video can
-- remain hidden until all earlier videos from the same user and group are ready.
ALTER TABLE "clips"
ADD COLUMN "transcodeReadyAt" TIMESTAMPTZ(3);

CREATE INDEX "clips_userId_groupId_finalizedAt_recordedAt_idx"
ON "clips"("userId", "groupId", "finalizedAt", "recordedAt");

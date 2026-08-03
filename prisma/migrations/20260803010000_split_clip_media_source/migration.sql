ALTER TABLE "clips"
  ADD COLUMN IF NOT EXISTS "imageUrl" TEXT;

UPDATE "clips"
SET "imageUrl" = "videoUrl"
WHERE "mediaType" = 'photo'
  AND "imageUrl" IS NULL;

ALTER TABLE "clips"
  DROP COLUMN "videoUrl";

ALTER TABLE "users"
ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;

-- Collapse legacy duplicates before enforcing one reaction of each supported
-- kind per user and clip.
DELETE FROM "reactions" AS duplicate
USING "reactions" AS keeper
WHERE duplicate."clipId" = keeper."clipId"
  AND duplicate."userId" = keeper."userId"
  AND duplicate."emoji" = keeper."emoji"
  AND (
    duplicate."createdAt" > keeper."createdAt"
    OR (
      duplicate."createdAt" = keeper."createdAt"
      AND duplicate."id" > keeper."id"
    )
  );

CREATE UNIQUE INDEX "reactions_clipId_userId_emoji_key"
ON "reactions"("clipId", "userId", "emoji");

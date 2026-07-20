-- ActiveUpload retains the multipart session briefly for idempotent retries,
-- but once its clip is visible it should no longer look merely finalized.
UPDATE "active_uploads" AS upload
SET
  "status" = 'PUBLISHED',
  "updatedAt" = CURRENT_TIMESTAMP
FROM "clips" AS clip
WHERE
  upload."clipId" = clip."id"
  AND upload."status" = 'FINALIZED'
  AND clip."transcodeStatus" = 'COMPLETED';

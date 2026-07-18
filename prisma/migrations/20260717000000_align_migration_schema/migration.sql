-- The hardening migration needed a default while backfilling legacy upload
-- rows. Prisma's @updatedAt field owns this value after deployment, so remove
-- the database default once every row has been populated.
ALTER TABLE "active_uploads"
  ALTER COLUMN "updatedAt" DROP DEFAULT;

-- PostgreSQL truncated the original generated identifier to 63 characters.
-- Rename it to the stable name Prisma derives from the current schema.
ALTER INDEX IF EXISTS "group_member_xp_events_groupId_groupMemberId_businessDate_reaso"
  RENAME TO "group_member_xp_events_groupId_groupMemberId_businessDate_r_key";

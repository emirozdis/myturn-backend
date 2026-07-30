-- This migration intentionally preserves every existing row. Closed-domain
-- TEXT columns are cast in place; they are never dropped and recreated.
BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

-- Fail before taking schema-changing locks if production contains a value that
-- cannot be represented by the hardened schema.
DO $preflight$
BEGIN
  IF EXISTS (SELECT 1 FROM "profiles" WHERE "name" IS NULL OR "email" IS NULL) THEN
    RAISE EXCEPTION 'schema hardening aborted: profiles.name/email contains NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM "PushSubscription" WHERE "userId" IS NULL) THEN
    RAISE EXCEPTION 'schema hardening aborted: PushSubscription.userId contains NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM "profiles" WHERE "locale" NOT IN ('en', 'tr')) THEN
    RAISE EXCEPTION 'schema hardening aborted: unsupported profile locale';
  END IF;
  IF EXISTS (SELECT 1 FROM "group_members" WHERE "role" NOT IN ('member', 'admin')) THEN
    RAISE EXCEPTION 'schema hardening aborted: unsupported group role';
  END IF;
  IF EXISTS (SELECT 1 FROM "daily_assignments" WHERE "status" NOT IN ('active', 'completed', 'missed')) THEN
    RAISE EXCEPTION 'schema hardening aborted: unsupported assignment status';
  END IF;
  IF EXISTS (SELECT 1 FROM "friendships" WHERE "status" NOT IN ('pending', 'accepted')) THEN
    RAISE EXCEPTION 'schema hardening aborted: unsupported friendship status';
  END IF;
  IF EXISTS (SELECT 1 FROM "clips" WHERE "mediaType" NOT IN ('vlog', 'photo', 'snippet')) OR
     EXISTS (SELECT 1 FROM "photo_responses" WHERE "mediaType" NOT IN ('vlog', 'photo', 'snippet')) OR
     EXISTS (SELECT 1 FROM "active_uploads" WHERE "mediaType" NOT IN ('vlog', 'photo', 'snippet')) OR
     EXISTS (SELECT 1 FROM "media_upload_grants" WHERE "mediaType" NOT IN ('vlog', 'photo', 'snippet')) THEN
    RAISE EXCEPTION 'schema hardening aborted: unsupported media type';
  END IF;
  IF EXISTS (SELECT 1 FROM "clips" WHERE "transcodeStatus" NOT IN ('UPLOADING', 'QUEUED', 'DISPATCHING', 'PROCESSING', 'COMPLETED', 'FAILED', 'FAILED_PERMANENTLY')) OR
     EXISTS (SELECT 1 FROM "photo_responses" WHERE "transcodeStatus" NOT IN ('UPLOADING', 'QUEUED', 'DISPATCHING', 'PROCESSING', 'COMPLETED', 'FAILED', 'FAILED_PERMANENTLY')) THEN
    RAISE EXCEPTION 'schema hardening aborted: unsupported transcode status';
  END IF;
  IF EXISTS (SELECT 1 FROM "clips" WHERE "storageTier" NOT IN ('HOT', 'MIGRATING', 'COLD', 'PRUNED', 'FAILED_MIGRATION')) THEN
    RAISE EXCEPTION 'schema hardening aborted: unsupported storage tier';
  END IF;
  IF EXISTS (SELECT 1 FROM "active_uploads" WHERE "status" NOT IN ('INITIATED', 'COMPLETING', 'ASSEMBLED', 'FINALIZED', 'PUBLISHED', 'LEGACY_REJECTED')) THEN
    RAISE EXCEPTION 'schema hardening aborted: unsupported active upload status';
  END IF;
  IF EXISTS (SELECT 1 FROM "feedback_reports" WHERE "category" NOT IN ('bug', 'idea', 'other')) THEN
    RAISE EXCEPTION 'schema hardening aborted: unsupported feedback category';
  END IF;
  IF EXISTS (SELECT 1 FROM "backend_incidents" WHERE "source" NOT IN ('server', 'client') OR "level" NOT IN ('warn', 'error', 'fatal')) THEN
    RAISE EXCEPTION 'schema hardening aborted: unsupported incident source/level';
  END IF;
  IF EXISTS (SELECT 1 FROM "transcoder_webhook_events" WHERE "event" NOT IN ('Saved', 'Error')) THEN
    RAISE EXCEPTION 'schema hardening aborted: unsupported transcoder event';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "daily_assignments" d
    LEFT JOIN "profiles" p ON p."id" = d."passedByUserId"
    WHERE d."passedByUserId" IS NOT NULL AND p."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'schema hardening aborted: orphan passedByUserId';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "active_uploads" u
    LEFT JOIN "daily_assignments" d ON d."id" = u."assignmentId"
    WHERE d."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'schema hardening aborted: orphan active upload assignment';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "volunteers" v
    LEFT JOIN "group_members" m ON m."groupId" = v."groupId" AND m."userId" = v."userId"
    WHERE m."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'schema hardening aborted: volunteer is not a group member';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "clips" c
    JOIN "daily_assignments" d ON d."id" = c."assignmentId"
    WHERE c."groupId" <> d."groupId" OR c."userId" <> d."userId"
  ) THEN
    RAISE EXCEPTION 'schema hardening aborted: clip disagrees with assignment';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "group_member_xp_events" x
    JOIN "group_members" m ON m."id" = x."groupMemberId"
    WHERE x."groupId" <> m."groupId"
  ) THEN
    RAISE EXCEPTION 'schema hardening aborted: XP event disagrees with membership';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "comments" c
    JOIN "comments" p ON p."id" = c."parentId"
    WHERE c."clipId" <> p."clipId"
  ) THEN
    RAISE EXCEPTION 'schema hardening aborted: reply points to another clip';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "friendships" a
    JOIN "friendships" b
      ON a."requesterId" = b."addresseeId"
     AND a."addresseeId" = b."requesterId"
     AND a."id" < b."id"
  ) THEN
    RAISE EXCEPTION 'schema hardening aborted: reverse duplicate friendship';
  END IF;
END
$preflight$;

CREATE TYPE "Locale" AS ENUM ('en', 'tr');
CREATE TYPE "GroupRole" AS ENUM ('member', 'admin');
CREATE TYPE "AssignmentStatus" AS ENUM ('active', 'completed', 'missed');
CREATE TYPE "FriendshipStatus" AS ENUM ('pending', 'accepted');
CREATE TYPE "MediaType" AS ENUM ('vlog', 'photo', 'snippet');
CREATE TYPE "TranscodeStatus" AS ENUM ('UPLOADING', 'QUEUED', 'DISPATCHING', 'PROCESSING', 'COMPLETED', 'FAILED', 'FAILED_PERMANENTLY');
CREATE TYPE "StorageTier" AS ENUM ('HOT', 'MIGRATING', 'COLD', 'PRUNED', 'FAILED_MIGRATION');
CREATE TYPE "ActiveUploadStatus" AS ENUM ('INITIATED', 'COMPLETING', 'ASSEMBLED', 'FINALIZED', 'PUBLISHED', 'LEGACY_REJECTED');
CREATE TYPE "FeedbackCategory" AS ENUM ('bug', 'idea', 'other');
CREATE TYPE "IncidentSource" AS ENUM ('server', 'client');
CREATE TYPE "IncidentLevel" AS ENUM ('warn', 'error', 'fatal');
CREATE TYPE "TranscoderEvent" AS ENUM ('Saved', 'Error');

-- Preserve each value while converting TEXT to its closed-domain enum.
ALTER TABLE "profiles" ALTER COLUMN "locale" DROP DEFAULT;
ALTER TABLE "profiles" ALTER COLUMN "locale" TYPE "Locale" USING "locale"::text::"Locale";
ALTER TABLE "profiles" ALTER COLUMN "locale" SET DEFAULT 'en';

ALTER TABLE "group_members" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "group_members" ALTER COLUMN "role" TYPE "GroupRole" USING "role"::text::"GroupRole";
ALTER TABLE "group_members" ALTER COLUMN "role" SET DEFAULT 'member';

ALTER TABLE "daily_assignments" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "daily_assignments" ALTER COLUMN "status" TYPE "AssignmentStatus" USING "status"::text::"AssignmentStatus";
ALTER TABLE "daily_assignments" ALTER COLUMN "status" SET DEFAULT 'active';

ALTER TABLE "friendships" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "friendships" ALTER COLUMN "status" TYPE "FriendshipStatus" USING "status"::text::"FriendshipStatus";
ALTER TABLE "friendships" ALTER COLUMN "status" SET DEFAULT 'pending';

ALTER TABLE "clips" ALTER COLUMN "mediaType" DROP DEFAULT;
ALTER TABLE "clips" ALTER COLUMN "mediaType" TYPE "MediaType" USING "mediaType"::text::"MediaType";
ALTER TABLE "clips" ALTER COLUMN "mediaType" SET DEFAULT 'vlog';
ALTER TABLE "photo_responses" ALTER COLUMN "mediaType" DROP DEFAULT;
ALTER TABLE "photo_responses" ALTER COLUMN "mediaType" TYPE "MediaType" USING "mediaType"::text::"MediaType";
ALTER TABLE "photo_responses" ALTER COLUMN "mediaType" SET DEFAULT 'photo';
ALTER TABLE "active_uploads" ALTER COLUMN "mediaType" DROP DEFAULT;
ALTER TABLE "active_uploads" ALTER COLUMN "mediaType" TYPE "MediaType" USING "mediaType"::text::"MediaType";
ALTER TABLE "active_uploads" ALTER COLUMN "mediaType" SET DEFAULT 'vlog';
ALTER TABLE "media_upload_grants" ALTER COLUMN "mediaType" TYPE "MediaType" USING "mediaType"::text::"MediaType";

ALTER TABLE "clips" ALTER COLUMN "transcodeStatus" DROP DEFAULT;
ALTER TABLE "clips" ALTER COLUMN "transcodeStatus" TYPE "TranscodeStatus" USING "transcodeStatus"::text::"TranscodeStatus";
ALTER TABLE "clips" ALTER COLUMN "transcodeStatus" SET DEFAULT 'UPLOADING';
ALTER TABLE "photo_responses" ALTER COLUMN "transcodeStatus" DROP DEFAULT;
ALTER TABLE "photo_responses" ALTER COLUMN "transcodeStatus" TYPE "TranscodeStatus" USING "transcodeStatus"::text::"TranscodeStatus";
ALTER TABLE "photo_responses" ALTER COLUMN "transcodeStatus" SET DEFAULT 'COMPLETED';

ALTER TABLE "clips" ALTER COLUMN "storageTier" DROP DEFAULT;
ALTER TABLE "clips" ALTER COLUMN "storageTier" TYPE "StorageTier" USING "storageTier"::text::"StorageTier";
ALTER TABLE "clips" ALTER COLUMN "storageTier" SET DEFAULT 'HOT';

ALTER TABLE "active_uploads" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "active_uploads" ALTER COLUMN "status" TYPE "ActiveUploadStatus" USING "status"::text::"ActiveUploadStatus";
ALTER TABLE "active_uploads" ALTER COLUMN "status" SET DEFAULT 'INITIATED';

ALTER TABLE "feedback_reports" ALTER COLUMN "category" TYPE "FeedbackCategory" USING "category"::text::"FeedbackCategory";
ALTER TABLE "backend_incidents" ALTER COLUMN "source" DROP DEFAULT;
ALTER TABLE "backend_incidents" ALTER COLUMN "source" TYPE "IncidentSource" USING "source"::text::"IncidentSource";
ALTER TABLE "backend_incidents" ALTER COLUMN "source" SET DEFAULT 'server';
ALTER TABLE "backend_incidents" ALTER COLUMN "level" TYPE "IncidentLevel" USING "level"::text::"IncidentLevel";
ALTER TABLE "transcoder_webhook_events" ALTER COLUMN "event" TYPE "TranscoderEvent" USING "event"::text::"TranscoderEvent";

-- Prisma historically created timestamp-without-time-zone columns. Values have
-- always represented UTC instants, so use an explicit UTC conversion.
ALTER TABLE "PushSubscription"
  ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'UTC';
ALTER TABLE "active_uploads"
  ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "expiresAt" TYPE TIMESTAMPTZ(3) USING "expiresAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'UTC';
ALTER TABLE "agreement_acceptances"
  ALTER COLUMN "agreementEffectiveAt" TYPE TIMESTAMPTZ(3) USING "agreementEffectiveAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "acceptedAt" TYPE TIMESTAMPTZ(3) USING "acceptedAt" AT TIME ZONE 'UTC';
ALTER TABLE "backend_incidents"
  ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "expiresAt" TYPE TIMESTAMPTZ(3) USING "expiresAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "occurredAt" TYPE TIMESTAMPTZ(3) USING "occurredAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "receivedAt" TYPE TIMESTAMPTZ(3) USING "receivedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "finalizedAt" TYPE TIMESTAMPTZ(3) USING "finalizedAt" AT TIME ZONE 'UTC';
ALTER TABLE "beta_applications" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "boost_purchases"
  ALTER COLUMN "purchasedAt" TYPE TIMESTAMPTZ(3) USING "purchasedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "clips"
  ALTER COLUMN "archivedAt" TYPE TIMESTAMPTZ(3) USING "archivedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "recordedAt" TYPE TIMESTAMPTZ(3) USING "recordedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "finalizedAt" TYPE TIMESTAMPTZ(3) USING "finalizedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "transcodeDispatchAt" TYPE TIMESTAMPTZ(3) USING "transcodeDispatchAt" AT TIME ZONE 'UTC';
ALTER TABLE "comments" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "daily_assignments" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "feedback_reports"
  ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'UTC';
ALTER TABLE "friendships" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "group_boosts" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "group_member_xp_events" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "group_members"
  ALTER COLUMN "joinedAt" TYPE TIMESTAMPTZ(3) USING "joinedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "lastActiveAt" TYPE TIMESTAMPTZ(3) USING "lastActiveAt" AT TIME ZONE 'UTC';
ALTER TABLE "groups"
  ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "boostGracePeriodEndsAt" TYPE TIMESTAMPTZ(3) USING "boostGracePeriodEndsAt" AT TIME ZONE 'UTC';
ALTER TABLE "incident_breadcrumbs" ALTER COLUMN "occurredAt" TYPE TIMESTAMPTZ(3) USING "occurredAt" AT TIME ZONE 'UTC';
ALTER TABLE "media_upload_grants"
  ALTER COLUMN "expiresAt" TYPE TIMESTAMPTZ(3) USING "expiresAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "consumedAt" TYPE TIMESTAMPTZ(3) USING "consumedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "photo_responses"
  ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "transcodeDispatchAt" TYPE TIMESTAMPTZ(3) USING "transcodeDispatchAt" AT TIME ZONE 'UTC';
ALTER TABLE "pokes" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "profiles"
  ALTER COLUMN "emailVerified" TYPE TIMESTAMPTZ(3) USING "emailVerified" AT TIME ZONE 'UTC',
  ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "prompts" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "rate_limit_buckets"
  ALTER COLUMN "resetAt" TYPE TIMESTAMPTZ(3) USING "resetAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'UTC';
ALTER TABLE "reactions" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "transcoder_webhook_events"
  ALTER COLUMN "receivedAt" TYPE TIMESTAMPTZ(3) USING "receivedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "processedAt" TYPE TIMESTAMPTZ(3) USING "processedAt" AT TIME ZONE 'UTC';
ALTER TABLE "unlocked_achievements" ALTER COLUMN "unlockedAt" TYPE TIMESTAMPTZ(3) USING "unlockedAt" AT TIME ZONE 'UTC';
ALTER TABLE "verification_tokens" ALTER COLUMN "expires" TYPE TIMESTAMPTZ(3) USING "expires" AT TIME ZONE 'UTC';
ALTER TABLE "views" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "volunteers" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';

ALTER TABLE "profiles" ALTER COLUMN "name" SET NOT NULL, ALTER COLUMN "email" SET NOT NULL;
ALTER TABLE "PushSubscription" ALTER COLUMN "userId" SET NOT NULL;

-- Keep the current prompt text as a historical snapshot while adding a real
-- catalog reference for new writes.
ALTER TABLE "daily_assignments" ADD COLUMN "activePromptId" TEXT;
UPDATE "daily_assignments" AS assignment
SET "activePromptId" = (
  SELECT prompt."id"
  FROM "prompts" AS prompt
  WHERE prompt."text" = assignment."activePrompt"
     OR EXISTS (
       SELECT 1
       FROM jsonb_each_text(COALESCE(prompt."translations", '{}'::jsonb)) AS translation
       WHERE translation.value = assignment."activePrompt"
     )
  ORDER BY (prompt."text" = assignment."activePrompt") DESC, prompt."id"
  LIMIT 1
)
WHERE assignment."activePrompt" IS NOT NULL;

ALTER TABLE "clips" DROP CONSTRAINT "clips_assignmentId_fkey";
ALTER TABLE "comments" DROP CONSTRAINT "comments_parentId_fkey";
ALTER TABLE "group_member_xp_events" DROP CONSTRAINT "group_member_xp_events_groupMemberId_fkey";

CREATE UNIQUE INDEX "group_members_id_groupId_key" ON "group_members"("id", "groupId");
CREATE UNIQUE INDEX "daily_assignments_id_groupId_userId_key" ON "daily_assignments"("id", "groupId", "userId");
CREATE UNIQUE INDEX "comments_id_clipId_key" ON "comments"("id", "clipId");

ALTER TABLE "group_member_xp_events"
  ADD CONSTRAINT "group_member_xp_events_groupMemberId_groupId_fkey"
  FOREIGN KEY ("groupMemberId", "groupId") REFERENCES "group_members"("id", "groupId")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "daily_assignments"
  ADD CONSTRAINT "daily_assignments_passedByUserId_fkey"
  FOREIGN KEY ("passedByUserId") REFERENCES "profiles"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "daily_assignments"
  ADD CONSTRAINT "daily_assignments_activePromptId_fkey"
  FOREIGN KEY ("activePromptId") REFERENCES "prompts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "volunteers"
  ADD CONSTRAINT "volunteers_groupId_userId_fkey"
  FOREIGN KEY ("groupId", "userId") REFERENCES "group_members"("groupId", "userId")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "clips"
  ADD CONSTRAINT "clips_assignmentId_groupId_userId_fkey"
  FOREIGN KEY ("assignmentId", "groupId", "userId") REFERENCES "daily_assignments"("id", "groupId", "userId")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "comments"
  ADD CONSTRAINT "comments_parentId_clipId_fkey"
  FOREIGN KEY ("parentId", "clipId") REFERENCES "comments"("id", "clipId")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "active_uploads"
  ADD CONSTRAINT "active_uploads_assignmentId_fkey"
  FOREIGN KEY ("assignmentId") REFERENCES "daily_assignments"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Query-shaped indexes. Drop only indexes whose leading columns are covered by
-- a replacement or an existing unique index.
DROP INDEX "clips_assignmentId_idx";
DROP INDEX "clips_groupId_idx";
DROP INDEX "clips_userId_idx";
DROP INDEX "comments_clipId_idx";
DROP INDEX "comments_userId_idx";
DROP INDEX "daily_assignments_groupId_idx";
DROP INDEX "friendships_addresseeId_idx";
DROP INDEX "friendships_requesterId_idx";
DROP INDEX "group_members_groupId_idx";
DROP INDEX "media_upload_grants_userId_clipId_idx";
DROP INDEX "photo_responses_clipId_idx";
DROP INDEX "reactions_clipId_idx";
DROP INDEX "transcoder_webhook_events_jobId_idx";
DROP INDEX "views_clipId_idx";
DROP INDEX "views_userId_idx";
DROP INDEX "volunteers_groupId_idx";

CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");
CREATE INDEX "active_uploads_userId_idx" ON "active_uploads"("userId");
CREATE INDEX "active_uploads_groupId_idx" ON "active_uploads"("groupId");
CREATE INDEX "active_uploads_assignmentId_status_idx" ON "active_uploads"("assignmentId", "status");
CREATE INDEX "active_uploads_status_expiresAt_idx" ON "active_uploads"("status", "expiresAt");
CREATE INDEX "active_uploads_status_updatedAt_idx" ON "active_uploads"("status", "updatedAt");
CREATE INDEX "clips_assignmentId_transcodeStatus_recordedAt_idx" ON "clips"("assignmentId", "transcodeStatus", "recordedAt");
CREATE INDEX "clips_userId_transcodeStatus_recordedAt_idx" ON "clips"("userId", "transcodeStatus", "recordedAt");
CREATE INDEX "clips_groupId_transcodeStatus_recordedAt_idx" ON "clips"("groupId", "transcodeStatus", "recordedAt");
CREATE INDEX "clips_transcodeStatus_recordedAt_idx" ON "clips"("transcodeStatus", "recordedAt");
CREATE INDEX "clips_storageTier_transcodeStatus_recordedAt_idx" ON "clips"("storageTier", "transcodeStatus", "recordedAt");
CREATE INDEX "comments_clipId_createdAt_idx" ON "comments"("clipId", "createdAt");
CREATE INDEX "comments_userId_createdAt_idx" ON "comments"("userId", "createdAt");
CREATE INDEX "daily_assignments_activePromptId_idx" ON "daily_assignments"("activePromptId");
CREATE INDEX "daily_assignments_groupId_status_date_idx" ON "daily_assignments"("groupId", "status", "date");
CREATE INDEX "daily_assignments_userId_status_date_idx" ON "daily_assignments"("userId", "status", "date");
CREATE INDEX "friendships_requesterId_status_createdAt_idx" ON "friendships"("requesterId", "status", "createdAt");
CREATE INDEX "friendships_addresseeId_status_createdAt_idx" ON "friendships"("addresseeId", "status", "createdAt");
CREATE UNIQUE INDEX "friendships_canonical_pair_key"
  ON "friendships"(LEAST("requesterId", "addresseeId"), GREATEST("requesterId", "addresseeId"));
CREATE INDEX "group_members_groupId_lastActiveAt_idx" ON "group_members"("groupId", "lastActiveAt");
CREATE INDEX "media_upload_grants_clipId_idx" ON "media_upload_grants"("clipId");
CREATE INDEX "media_upload_grants_userId_consumedAt_expiresAt_idx" ON "media_upload_grants"("userId", "consumedAt", "expiresAt");
CREATE INDEX "photo_responses_clipId_createdAt_idx" ON "photo_responses"("clipId", "createdAt");
CREATE INDEX "pokes_assignmentId_pokerId_createdAt_idx" ON "pokes"("assignmentId", "pokerId", "createdAt");
CREATE INDEX "views_userId_createdAt_idx" ON "views"("userId", "createdAt");
CREATE INDEX "groups_expiring_boost_grace_idx"
  ON "groups"("boostGracePeriodEndsAt")
  WHERE "boostGracePeriodEndsAt" IS NOT NULL AND "isFrozen" = FALSE;

-- Domain constraints mirror existing API validation and make direct database
-- writes equally safe.
ALTER TABLE "profiles"
  ADD CONSTRAINT "profiles_name_length_check" CHECK (char_length(btrim("name")) BETWEEN 1 AND 100),
  ADD CONSTRAINT "profiles_email_length_check" CHECK (char_length("email") BETWEEN 3 AND 320),
  ADD CONSTRAINT "profiles_email_normalized_check" CHECK ("email" = lower(btrim("email"))),
  ADD CONSTRAINT "profiles_handle_format_check" CHECK ("handle" IS NULL OR "handle" ~ '^[a-z0-9_]{3,20}$'),
  ADD CONSTRAINT "profiles_boostCredits_nonnegative_check" CHECK ("boostCredits" >= 0);
ALTER TABLE "groups"
  ADD CONSTRAINT "groups_name_length_check" CHECK (char_length(btrim("name")) BETWEEN 1 AND 100),
  ADD CONSTRAINT "groups_xp_nonnegative_check" CHECK ("xp" >= 0),
  ADD CONSTRAINT "groups_level_positive_check" CHECK ("level" >= 1);
ALTER TABLE "group_members"
  ADD CONSTRAINT "group_members_counters_nonnegative_check" CHECK ("streak" >= 0 AND "xp" >= 0);
ALTER TABLE "prompts"
  ADD CONSTRAINT "prompts_translations_object_check" CHECK (jsonb_typeof("translations") = 'object');
ALTER TABLE "group_member_xp_events"
  ADD CONSTRAINT "group_member_xp_events_amount_nonzero_check" CHECK ("amount" <> 0);
ALTER TABLE "daily_assignments"
  ADD CONSTRAINT "daily_assignments_promptSkips_check" CHECK ("promptSkips" BETWEEN 0 AND 3);
ALTER TABLE "friendships"
  ADD CONSTRAINT "friendships_distinct_users_check" CHECK ("requesterId" <> "addresseeId");
ALTER TABLE "clips"
  ADD CONSTRAINT "clips_transcodeAttempts_nonnegative_check" CHECK ("transcodeAttempts" >= 0);
ALTER TABLE "feedback_reports"
  ADD CONSTRAINT "feedback_reports_screenshot_consistency_check"
  CHECK (NOT "includedScreenshot" OR "screenshotPath" IS NOT NULL);
ALTER TABLE "backend_incidents"
  ADD CONSTRAINT "backend_incidents_status_check" CHECK ("status" IS NULL OR "status" BETWEEN 100 AND 599),
  ADD CONSTRAINT "backend_incidents_duration_check" CHECK ("durationMs" IS NULL OR "durationMs" >= 0),
  ADD CONSTRAINT "backend_incidents_retry_check" CHECK ("retryNumber" IS NULL OR "retryNumber" >= 0);
ALTER TABLE "incident_breadcrumbs"
  ADD CONSTRAINT "incident_breadcrumbs_sequence_check" CHECK ("sequence" >= 0),
  ADD CONSTRAINT "incident_breadcrumbs_status_check" CHECK ("status" IS NULL OR "status" BETWEEN 100 AND 599),
  ADD CONSTRAINT "incident_breadcrumbs_duration_check" CHECK ("durationMs" IS NULL OR "durationMs" >= 0);
ALTER TABLE "media_upload_grants"
  ADD CONSTRAINT "media_upload_grants_maxBytes_positive_check" CHECK ("maxBytes" > 0);
ALTER TABLE "photo_responses"
  ADD CONSTRAINT "photo_responses_transcodeAttempts_nonnegative_check" CHECK ("transcodeAttempts" >= 0);
ALTER TABLE "reactions"
  ADD CONSTRAINT "reactions_supported_emoji_check" CHECK ("emoji" IN ('❤️'));
ALTER TABLE "active_uploads"
  ADD CONSTRAINT "active_uploads_expectedChunks_check" CHECK ("expectedChunks" BETWEEN 1 AND 50),
  ADD CONSTRAINT "active_uploads_expectedBytes_positive_check" CHECK ("expectedBytes" > 0);
ALTER TABLE "rate_limit_buckets"
  ADD CONSTRAINT "rate_limit_buckets_count_nonnegative_check" CHECK ("count" >= 0);

COMMIT;

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

-- Firebase UIDs are external identity keys. Preserve them in firebaseUid and
-- give every profile a separate internal UUID. ON UPDATE CASCADE propagates
-- these three legacy key replacements to all current relational references.
UPDATE profiles
SET id = gen_random_uuid()::text
WHERE NOT pg_input_is_valid(id, 'uuid');

-- Keep non-relational diagnostic correlation fields useful after the remap.
UPDATE backend_incidents AS incident
SET "userId" = profile.id
FROM profiles AS profile
WHERE incident."userId" = profile."firebaseUid"
  AND incident."userId" <> profile.id;

DO $$
DECLARE
  target RECORD;
  invalid_count BIGINT;
BEGIN
  FOR target IN
    SELECT *
    FROM (VALUES
      ('accounts', 'id'), ('accounts', 'userId'),
      ('active_uploads', 'id'), ('active_uploads', 'groupId'),
      ('active_uploads', 'assignmentId'), ('active_uploads', 'userId'),
      ('active_uploads', 'clipId'),
      ('agreement_acceptances', 'id'), ('agreement_acceptances', 'userId'),
      ('backend_incidents', 'id'),
      ('beta_applications', 'id'),
      ('boost_purchases', 'id'), ('boost_purchases', 'userId'),
      ('clips', 'id'), ('clips', 'assignmentId'), ('clips', 'userId'),
      ('clips', 'groupId'), ('clips', 'promptId'),
      ('comments', 'id'), ('comments', 'clipId'), ('comments', 'userId'),
      ('comments', 'parentId'),
      ('daily_assignments', 'id'), ('daily_assignments', 'groupId'),
      ('daily_assignments', 'userId'), ('daily_assignments', 'activePromptId'),
      ('daily_assignments', 'passedByUserId'),
      ('feedback_reports', 'id'), ('feedback_reports', 'userId'),
      ('friendships', 'id'), ('friendships', 'requesterId'),
      ('friendships', 'addresseeId'),
      ('group_boosts', 'id'), ('group_boosts', 'groupId'),
      ('group_boosts', 'userId'),
      ('group_member_xp_events', 'id'), ('group_member_xp_events', 'groupId'),
      ('group_member_xp_events', 'groupMemberId'),
      ('group_members', 'id'), ('group_members', 'groupId'),
      ('group_members', 'userId'),
      ('groups', 'id'),
      ('incident_breadcrumbs', 'id'), ('incident_breadcrumbs', 'incidentId'),
      ('media_upload_grants', 'id'), ('media_upload_grants', 'userId'),
      ('media_upload_grants', 'clipId'),
      ('photo_responses', 'id'), ('photo_responses', 'clipId'),
      ('photo_responses', 'userId'),
      ('pokes', 'id'), ('pokes', 'assignmentId'), ('pokes', 'pokerId'),
      ('profiles', 'id'),
      ('prompts', 'id'),
      ('PushSubscription', 'id'), ('PushSubscription', 'userId'),
      ('reactions', 'id'), ('reactions', 'clipId'), ('reactions', 'userId'),
      ('transcoder_webhook_events', 'id'),
      ('unlocked_achievements', 'id'), ('unlocked_achievements', 'userId'),
      ('verification_tokens', 'id'),
      ('views', 'id'), ('views', 'clipId'), ('views', 'userId'),
      ('volunteers', 'id'), ('volunteers', 'groupId'), ('volunteers', 'userId')
    ) AS columns_to_check(table_name, column_name)
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM %I WHERE %I IS NOT NULL AND NOT pg_input_is_valid(%I, ''uuid'')',
      target.table_name,
      target.column_name,
      target.column_name
    ) INTO invalid_count;
    IF invalid_count > 0 THEN
      RAISE EXCEPTION 'Cannot convert %.% to UUID: % invalid value(s)',
        target.table_name, target.column_name, invalid_count;
    END IF;
  END LOOP;
END
$$;

CREATE TEMP TABLE migration_rebuild_constraints ON COMMIT DROP AS
SELECT
  conrelid::regclass::text AS table_name,
  conname AS constraint_name,
  pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE contype IN ('f', 'c')
  AND connamespace = 'public'::regnamespace;

DO $$
DECLARE
  saved_constraint RECORD;
BEGIN
  FOR saved_constraint IN SELECT * FROM migration_rebuild_constraints
  LOOP
    EXECUTE format(
      'ALTER TABLE %s DROP CONSTRAINT %I',
      saved_constraint.table_name,
      saved_constraint.constraint_name
    );
  END LOOP;
END
$$;

DROP INDEX friendships_canonical_pair_key;
DROP INDEX "unlocked_achievements_userId_achievementId_groupId_key";
ALTER TABLE unlocked_achievements
  ALTER COLUMN "groupId" DROP DEFAULT,
  ALTER COLUMN "groupId" DROP NOT NULL;
UPDATE unlocked_achievements SET "groupId" = NULL WHERE "groupId" = 'global';

DO $$
DECLARE
  target RECORD;
BEGIN
  FOR target IN
    SELECT *
    FROM (VALUES
      ('accounts', 'id'), ('accounts', 'userId'),
      ('active_uploads', 'id'), ('active_uploads', 'groupId'),
      ('active_uploads', 'assignmentId'), ('active_uploads', 'userId'),
      ('active_uploads', 'clipId'),
      ('agreement_acceptances', 'id'), ('agreement_acceptances', 'userId'),
      ('backend_incidents', 'id'),
      ('beta_applications', 'id'),
      ('boost_purchases', 'id'), ('boost_purchases', 'userId'),
      ('clips', 'id'), ('clips', 'assignmentId'), ('clips', 'userId'),
      ('clips', 'groupId'), ('clips', 'promptId'),
      ('comments', 'id'), ('comments', 'clipId'), ('comments', 'userId'),
      ('comments', 'parentId'),
      ('daily_assignments', 'id'), ('daily_assignments', 'groupId'),
      ('daily_assignments', 'userId'), ('daily_assignments', 'activePromptId'),
      ('daily_assignments', 'passedByUserId'),
      ('feedback_reports', 'id'), ('feedback_reports', 'userId'),
      ('friendships', 'id'), ('friendships', 'requesterId'),
      ('friendships', 'addresseeId'),
      ('group_boosts', 'id'), ('group_boosts', 'groupId'),
      ('group_boosts', 'userId'),
      ('group_member_xp_events', 'id'), ('group_member_xp_events', 'groupId'),
      ('group_member_xp_events', 'groupMemberId'),
      ('group_members', 'id'), ('group_members', 'groupId'),
      ('group_members', 'userId'),
      ('groups', 'id'),
      ('incident_breadcrumbs', 'id'), ('incident_breadcrumbs', 'incidentId'),
      ('media_upload_grants', 'id'), ('media_upload_grants', 'userId'),
      ('media_upload_grants', 'clipId'),
      ('photo_responses', 'id'), ('photo_responses', 'clipId'),
      ('photo_responses', 'userId'),
      ('pokes', 'id'), ('pokes', 'assignmentId'), ('pokes', 'pokerId'),
      ('profiles', 'id'),
      ('prompts', 'id'),
      ('PushSubscription', 'id'), ('PushSubscription', 'userId'),
      ('reactions', 'id'), ('reactions', 'clipId'), ('reactions', 'userId'),
      ('transcoder_webhook_events', 'id'),
      ('unlocked_achievements', 'id'), ('unlocked_achievements', 'userId'),
      ('unlocked_achievements', 'groupId'),
      ('verification_tokens', 'id'),
      ('views', 'id'), ('views', 'clipId'), ('views', 'userId'),
      ('volunteers', 'id'), ('volunteers', 'groupId'), ('volunteers', 'userId')
    ) AS columns_to_convert(table_name, column_name)
  LOOP
    EXECUTE format(
      'ALTER TABLE %I ALTER COLUMN %I DROP DEFAULT',
      target.table_name,
      target.column_name
    );
    EXECUTE format(
      'ALTER TABLE %I ALTER COLUMN %I TYPE UUID USING %I::uuid',
      target.table_name,
      target.column_name,
      target.column_name
    );
  END LOOP;
END
$$;

DO $$
DECLARE
  target_table TEXT;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'accounts', 'active_uploads', 'agreement_acceptances', 'beta_applications',
    'boost_purchases', 'clips', 'comments', 'daily_assignments',
    'feedback_reports', 'friendships', 'group_boosts',
    'group_member_xp_events', 'group_members', 'groups',
    'incident_breadcrumbs', 'media_upload_grants', 'photo_responses', 'pokes',
    'profiles', 'prompts', 'PushSubscription', 'reactions',
    'unlocked_achievements', 'verification_tokens', 'views', 'volunteers'
  ]
  LOOP
    EXECUTE format(
      'ALTER TABLE %I ALTER COLUMN id SET DEFAULT gen_random_uuid()',
      target_table
    );
  END LOOP;
END
$$;

DO $$
DECLARE
  saved_constraint RECORD;
BEGIN
  FOR saved_constraint IN SELECT * FROM migration_rebuild_constraints
  LOOP
    EXECUTE format(
      'ALTER TABLE %s ADD CONSTRAINT %I %s',
      saved_constraint.table_name,
      saved_constraint.constraint_name,
      saved_constraint.definition
    );
  END LOOP;
END
$$;

ALTER TABLE unlocked_achievements
  ADD CONSTRAINT "unlocked_achievements_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES groups(id)
  ON UPDATE CASCADE ON DELETE CASCADE;

CREATE UNIQUE INDEX "unlocked_achievements_scope_key"
  ON unlocked_achievements (
    "userId",
    "achievementId",
    COALESCE("groupId", '00000000-0000-0000-0000-000000000000'::uuid)
  );
CREATE INDEX "unlocked_achievements_groupId_idx"
  ON unlocked_achievements ("groupId");
CREATE UNIQUE INDEX friendships_canonical_pair_key
  ON friendships (
    LEAST("requesterId", "addresseeId"),
    GREATEST("requesterId", "addresseeId")
  );

COMMIT;

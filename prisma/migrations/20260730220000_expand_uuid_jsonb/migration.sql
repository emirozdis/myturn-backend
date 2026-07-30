BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM clips
    WHERE metadata IS NOT NULL
      AND NOT pg_input_is_valid(metadata, 'jsonb')
  ) OR EXISTS (
    SELECT 1 FROM active_uploads
    WHERE metadata IS NOT NULL
      AND NOT pg_input_is_valid(metadata, 'jsonb')
  ) THEN
    RAISE EXCEPTION 'Metadata contains values that cannot be converted to JSONB';
  END IF;
END
$$;

ALTER TABLE profiles ADD COLUMN "firebaseUid" TEXT;
UPDATE profiles SET "firebaseUid" = id;
ALTER TABLE profiles ALTER COLUMN "firebaseUid" SET NOT NULL;
ALTER TABLE profiles ADD CONSTRAINT "profiles_firebaseUid_key" UNIQUE ("firebaseUid");

ALTER TABLE clips ADD COLUMN metadata_json JSONB;
UPDATE clips
SET metadata_json = metadata::jsonb
WHERE metadata IS NOT NULL;

ALTER TABLE active_uploads ADD COLUMN metadata_json JSONB;
UPDATE active_uploads
SET metadata_json = metadata::jsonb
WHERE metadata IS NOT NULL;

-- Old servers explicitly write "global"; the compatible backend writes NULL.
-- Allow both representations during the rolling UUID migration.
ALTER TABLE unlocked_achievements
  ALTER COLUMN "groupId" DROP DEFAULT,
  ALTER COLUMN "groupId" DROP NOT NULL;

COMMIT;

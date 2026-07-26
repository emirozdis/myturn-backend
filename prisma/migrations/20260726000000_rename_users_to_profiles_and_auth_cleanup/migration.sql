-- The row remains the application's relational profile. Firebase Authentication
-- is the only credential and session authority.
ALTER TABLE "users" RENAME TO "profiles";
ALTER INDEX IF EXISTS "users_pkey" RENAME TO "profiles_pkey";
ALTER INDEX IF EXISTS "users_email_key" RENAME TO "profiles_email_key";
ALTER INDEX IF EXISTS "users_handle_key" RENAME TO "profiles_handle_key";

DROP TABLE IF EXISTS "sessions";

ALTER TABLE "profiles"
  DROP COLUMN IF EXISTS "password",
  DROP COLUMN IF EXISTS "sessionVersion";

ALTER TABLE "accounts"
  DROP COLUMN IF EXISTS "refresh_token",
  DROP COLUMN IF EXISTS "access_token",
  DROP COLUMN IF EXISTS "expires_at",
  DROP COLUMN IF EXISTS "token_type",
  DROP COLUMN IF EXISTS "scope",
  DROP COLUMN IF EXISTS "id_token",
  DROP COLUMN IF EXISTS "session_state";

CREATE TABLE "rate_limit_buckets" (
  "key" TEXT NOT NULL,
  "count" INTEGER NOT NULL,
  "resetAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "rate_limit_buckets_resetAt_idx"
ON "rate_limit_buckets"("resetAt");

# Database schema hardening deployment

This runbook covers `20260730213000_harden_relational_schema`.

## Safety properties

- The migration is transactional.
- It contains no `DELETE`, `TRUNCATE`, or destructive column replacement.
- Closed-domain text values are converted with `ALTER COLUMN ... TYPE ... USING`.
- Timestamp values are explicitly interpreted as UTC while moving to
  `TIMESTAMPTZ(3)`.
- A preflight block raises an exception before schema changes if production
  contains unsupported enum values, nulls, or broken relational data.
- The prompt text remains as a historical snapshot; `activePromptId` is an
  additive reference.
- Existing metadata and achievement storage remain unchanged for rolling
  deployment compatibility.

## Required deployment order

1. Take a provider-managed database snapshot.
2. Confirm `DIRECT_URL` targets the production direct/session connection.
3. Run `npm run db:migrate:status`.
4. Run `npm run db:migrate:deploy`.
5. Run `npm run db:migrate:verify`.
6. Verify that migration `20260730213000_harden_relational_schema` has a
   non-null `finished_at` and no logs in `_prisma_migrations`.
7. Deploy the backend generated from the updated Prisma schema.
8. Deploy the mobile app independently; it accepts both legacy string metadata
   and future JSON-object metadata.

Do not deploy the new backend before the migration because it selects
`daily_assignments.activePromptId`. The old backend remains compatible after
the migration, which makes migration-first deployment safe.

## Post-deployment checks

- Create/read a daily assignment and skip one prompt.
- Initiate, finalize, and publish one upload.
- Create a comment reply and verify it belongs to the same clip.
- Send and accept a friendship request.
- Register/unregister an FCM token.
- Confirm the archival and stranded-upload cron queries complete.

If the migration preflight or lock timeout fails, do not mark it resolved or
manually edit `_prisma_migrations`. Inspect the reported invariant, correct the
data deliberately, and rerun the unchanged migration.

# Native UUID and JSONB deployment

This runbook covers:

- `20260730220000_expand_uuid_jsonb`
- `20260730223000_native_uuid_keys`

## Compatibility design

- `profiles.firebaseUid` preserves the external Firebase identity while
  `profiles.id` becomes an internal UUID.
- `clips.metadata_json` and `active_uploads.metadata_json` are canonical JSONB
  copies. The legacy text columns remain temporarily for old backend instances.
- External identifiers such as Firebase UIDs, OAuth account IDs, R2 upload IDs,
  transcoder job IDs, request IDs, and rate-limit keys remain text.
- The backend reads JSONB first and falls back to legacy text, and writes both
  during the compatibility window.

## Required order

1. Take a provider snapshot and a verified logical backup.
2. Apply `20260730220000_expand_uuid_jsonb`.
3. Deploy the compatible backend and verify authentication.
4. Apply `20260730223000_native_uuid_keys`.
5. Run `npm run db:migrate:status` and `npm run db:migrate:verify`.
6. Verify every relational identifier column is `uuid`, JSONB backfills match,
   all constraints are validated, and row counts are unchanged.

Do not apply the native UUID migration before the compatible backend is active.
The three legacy Firebase UID profile keys are replaced with internal UUIDs,
while `firebaseUid` retains the value used to authenticate those users.

The legacy metadata text columns can be removed in a later contract migration
after the compatibility backend has been active long enough to rule out older
backend deployments.

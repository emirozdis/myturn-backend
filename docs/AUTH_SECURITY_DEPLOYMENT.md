# Authentication security deployment

This release changes the authentication contract and includes a physical
PostgreSQL table rename. Do not deploy it as an uncoordinated code-only change.

## Before deployment

1. Back up PostgreSQL and verify a restore.
2. Audit every active credential profile in the current `users` table (renamed
   to `profiles` by this migration):
   - `users.id` must equal the Firebase UID.
   - The normalized PostgreSQL and Firebase emails must agree.
   - Credential users must have Firebase's `password` provider.
3. Resolve any UID/email conflicts before enabling the exact-UID resolver.
4. Reset the passwords of accounts exposed in the deleted `migrate-fba.js`
   script and remove that file from Git history. Deleting it in the latest
   commit does not remove historical copies.
5. Add these production secrets:
   - `APP_BASE_URL`
   - `AUTH_STATE_SECRET` (at least 32 random bytes)
   - `AUTH_CODE_SECRET` (a separate value of at least 32 random bytes)
   - `CRON_SECRET`
6. Expect all outstanding verification, reset, and deletion codes to become
   invalid because code hashes are now purpose/account-bound HMACs.

## Firebase and Google configuration

1. Enable only the authentication providers the app actually supports.
2. Confirm the exact iOS bundle ID and Android package are registered.
3. Verify App Attest with DeviceCheck fallback and Play Integrity registrations.
4. Review App Check metrics, then enforce App Check for Firebase Authentication.
5. Ensure the Admin service account can verify and consume App Check tokens.
6. Keep debug tokens out of preview and production and revoke stale debug tokens.
7. Add `${APP_BASE_URL}/api/auth/mobile/google/callback` to the Google web
   client's authorized redirect URIs.
8. Confirm the service account can mint Firebase custom tokens for Google
   browser handoffs.

## Safe rollout order

1. Release the mobile build first. It requests limited-use App Check tokens for
   password reset/change and boost purchase; the previous backend can verify
   these as ordinary valid App Check tokens.
2. Schedule a short API maintenance window.
3. Apply
   `20260726000000_rename_users_to_profiles_and_auth_cleanup`.
4. Deploy the API immediately after the migration. The old API expects `users`;
   the new API expects `profiles` and `rate_limit_buckets`.
5. Run smoke tests before ending maintenance:
   - new email registration and custom verification;
   - rejection before verification;
   - credential login after verification;
   - password change with wrong and correct current password;
   - password reset and revocation of an older session;
   - new and existing Google login;
   - account deletion followed by attempted token reuse;
   - consolidated cron tick authentication and incident cleanup;
   - missing, invalid, valid, and replayed App Check tokens.

## Post-deployment monitoring

- Monitor Firebase Auth and App Check rejection metrics.
- Alert on `NO_APPCHECK_TOKEN`, `INVALID_APPCHECK_TOKEN`, failed custom-token
  minting, UID/email conflicts, and rate-limit persistence failures.
- Confirm the externally triggered `POST /api/cron/tick` runs and persists its
  job results; incident cleanup is selected at its next daily schedule.
- Check for profiles with no corresponding Firebase identity; do not
  auto-provision them from request middleware.
- Remove any temporary maintenance compatibility measures after all instances
  run the new release.

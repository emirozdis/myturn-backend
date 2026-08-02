# MyTurn admin control center

The admin control center lives at `/admin` and uses a dedicated authentication
boundary. It does not accept Firebase tokens or app-user credentials.

## Configure access

1. Choose a unique admin email and a password that are not used by any MyTurn
   app account.
2. Run `npm run admin:hash-password` and enter the password at the hidden prompt.
3. Configure the printed hash and the following values on the Next.js host:

   - `ADMIN_EMAIL`
   - `ADMIN_PASSWORD_HASH`
   - `ADMIN_SESSION_SECRET` (an independent random value of at least 32 characters)

   Admin sign-in also requires the transactional email values documented in
   `.env.example`: `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, and optionally
   `BREVO_SENDER_NAME`. A fresh six-digit code is sent to `ADMIN_EMAIL` after
   every successful password check.

The generated hash uses colon separators so Next.js cannot reinterpret any
part of it as an environment-variable reference in local `.env` files.

4. Deploy the database migration before enabling the dashboard:
   `npm run db:migrate:deploy`.

Rotating `ADMIN_SESSION_SECRET` immediately invalidates all admin sessions.
Rotating `ADMIN_PASSWORD_HASH` changes the login password without changing any
app-user authentication data.

## Access controls

- Every console page and every mutation verifies the signed, HTTP-only admin
  session on the server.
- Sessions last eight hours, use `SameSite=Strict`, and are marked `Secure` in
  production.
- Every login requires a single-use email verification code. Challenges expire
  after ten minutes and are stored as keyed hashes rather than plaintext.
- Password, verification-code, and resend attempts are independently
  database-rate-limited by IP address.
- Admin pages are non-indexable, non-cacheable, and cannot be framed.
- Verification delivery, successful and failed sign-ins, user freezes, user restores, feedback
  changes, survey changes and deletions, and sign-outs are written to `admin_audit_logs`.
- Suspending a user is enforced by the shared backend session verifier and the
  mobile login endpoints. Firebase is disabled and its refresh tokens are
  revoked when the Firebase service is reachable.

## Dashboard data

- User totals and 30-day active-user count
- Exact Cloudflare R2 object count and byte total, cached for five minutes
- Total and daily vlog uploads
- Service health for the database/API, transcoder, object storage, and error
  budget
- Persisted server/client incidents, feedback reports, surveys, and responses
- Survey creation, editing, revision-safe question changes, and confirmed deletion
- User search, filtering, suspension, and restoration
- iOS and Android minimum-version, native-build, and update-URL controls for
  development, preview, and production release channels
- Administrator audit trail

## App version requirements

The **App versions** page edits the same `app_version_requirements` records used
by `GET /api/app/version`. Each platform and release channel has an independent
minimum semantic version, minimum native build number, and HTTPS update URL.
Both minimums are enforced, and the API fails closed if a required policy row is
missing or invalid. Saving from the dashboard requires an explicit review and
confirmation and immediately invalidates the server-side policy cache.

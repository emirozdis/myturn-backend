# MyTurn Backend

This directory contains the backend used by the `myturn-app` Expo application.
It is a Next.js API service; it does not contain the Expo client or a web/PWA
frontend.

## Responsibilities

- Authentication and account lifecycle
- Group, social, profile, streak, achievement, and vlog APIs
- PostgreSQL schema and migrations through Prisma
- Media upload, authorization, signing, transcoding, hot storage, and archiving
- Firebase App Check and push notifications
- Transactional verification and password-reset email
- Scheduled assignment, notification, upload, and archive jobs
- Legal agreement and privacy-policy API payloads

## Local development

1. Copy `.env.example` to `.env` and fill in the backend credentials.
2. Install dependencies with `npm install`.
3. Generate Prisma Client with `npm run postinstall`.
4. Apply the Prisma migrations with `npm run db:migrate:deploy`.
5. Start the API with `npm run dev`.

The Expo application should point its API base URL at this service. Static app
assets, screens, UI components, and client SDK initialization belong in
`../myturn-app`, not in this directory.

See `BACKEND_CLEANUP.md` for the backend-only audit and removed items.

## Database deployment

The migration history begins with `20260710000000_baseline`. It represents the
application schema immediately before the dated incremental migrations that
follow it. A new PostgreSQL database can therefore be created entirely from
source:

```sh
npm ci
npm run db:migrate:deploy
npm run db:migrate:verify
```

`db:migrate:verify` exits successfully only when the deployed database matches
`prisma/schema.prisma`. Production deployments must use `prisma migrate deploy`;
do not use `prisma db push` against shared, staging, or production databases.

For a database that existed before the baseline was committed, take and verify
a backup first. If its `_prisma_migrations` table already contains the dated
incremental migrations, record the new baseline without executing its table
creation SQL, then deploy normally:

```sh
npx prisma migrate resolve --applied 20260710000000_baseline
npm run db:migrate:deploy
npm run db:migrate:verify
```

Do not run `migrate resolve` blindly on a database without migration history.
First compare that database with the intended schema and reconcile any drift;
marking an unknown schema as migrated can hide missing constraints or columns.
Backups, point-in-time recovery, retention, and restore drills are configured at
the PostgreSQL provider and must be verified separately for each environment.

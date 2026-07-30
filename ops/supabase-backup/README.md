# Supabase backup worker for Coolify

This directory builds a small PostgreSQL backup worker for a Coolify-managed
VDS. Coolify keeps the container running and invokes its backup command on a
schedule. Backups are stored in a persistent volume mounted at `/backups`.

The dump is PostgreSQL's compressed custom format. Every completed dump is
checked with `pg_restore --list` and accompanied by a SHA-256 checksum. Files
older than `BACKUP_RETENTION_DAYS` are removed after a successful backup.

## Deploy in Coolify

1. Create a new **Application** using **Dockerfile without Git** and paste the
   contents of this directory's `Dockerfile`.
2. Set **Base Directory** to:

   ```text
   /
   ```

   The Dockerfile is already supplied in Coolify's Dockerfile editor. Base
   Directory must be a directory, not `/Dockerfile` or
   `/ops/supabase-backup/Dockerfile`.
3. Do not configure a domain or exposed port, and disable the HTTP health
   check. This is a worker, not a web application.
4. Add these runtime environment variables:

   ```text
   SUPABASE_DB_URL=postgresql://.../postgres?sslmode=require
   BACKUP_RETENTION_DAYS=30
   TZ=Europe/Istanbul
   ```

   Mark `SUPABASE_DB_URL` as secret. Use the direct or session-mode URI from
   Supabase **Connect**; do not use the transaction pooler on port 6543.

5. Add persistent storage in Coolify and mount it at `/backups`. A named Docker
   volume is sufficient. Make sure the VDS has enough free disk space for the
   chosen retention period.
6. Deploy the application.

Alternatively, when deploying from the Git repository, choose the Dockerfile
build pack, use `/ops/supabase-backup` as the base directory, and leave
Dockerfile Location at `/Dockerfile`.

## Schedule it

In the application's **Scheduled Tasks** section, create:

```text
Name: Supabase nightly backup
Command: /usr/local/bin/backup-supabase
Cron: 0 3 * * *
```

The cron value above means 03:00 in the Coolify server's configured timezone.
Set that server timezone to `Europe/Istanbul`. If your Coolify instance is
intentionally configured to schedule in UTC, use `0 0 * * *` instead.

Use **Run now** once after deployment. A successful execution ends with
`Backup completed and verified`. Also enable Coolify's scheduled-task failure
notifications.

## Inspect and restore

Open the worker's terminal in Coolify:

```sh
ls -lh /backups
cd /backups
sha256sum -c supabase-YYYY-MM-DDTHH-MM-SS+0300.dump.sha256
pg_restore --list supabase-YYYY-MM-DDTHH-MM-SS+0300.dump
```

Always test restoration against a new disposable Supabase project:

```sh
pg_restore \
  --verbose \
  --clean \
  --if-exists \
  --no-owner \
  --no-acl \
  --dbname="$RESTORE_DB_URL" \
  /backups/supabase-YYYY-MM-DDTHH-MM-SS+0300.dump
```

Supabase-managed schemas can produce harmless "already exists" or ownership
warnings when restoring into another hosted project. Review all errors and
validate important row counts and application flows before relying on the
backup.

## Scope and resilience

The dump contains PostgreSQL data, including Auth and Storage metadata held in
the database. It does not copy the actual objects from Supabase Storage,
Cloudflare R2, or Backblaze B2.

A persistent VDS volume protects against Supabase-side data loss, but not
against total VDS or disk loss. Add a VDS snapshot or copy `/backups` to a
separate S3-compatible bucket for a stronger disaster-recovery setup.

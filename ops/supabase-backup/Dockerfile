FROM postgres:17-alpine

RUN apk add --no-cache bash ca-certificates coreutils tzdata

COPY <<'BACKUP_SCRIPT' /usr/local/bin/backup-supabase
#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL is required}"

backup_dir="${BACKUP_DIR:-/backups}"
retention_days="${BACKUP_RETENTION_DAYS:-30}"

if [[ -z "$backup_dir" || "$backup_dir" == "/" ]]; then
  echo "Refusing unsafe BACKUP_DIR: '$backup_dir'" >&2
  exit 1
fi

if [[ ! "$retention_days" =~ ^[0-9]+$ ]] || (( retention_days < 1 )); then
  echo "BACKUP_RETENTION_DAYS must be a positive integer" >&2
  exit 1
fi

mkdir -p "$backup_dir"

timestamp="$(date +'%Y-%m-%dT%H-%M-%S%z')"
backup_name="supabase-${timestamp}.dump"
backup_path="${backup_dir}/${backup_name}"
temporary_path="${backup_dir}/.${backup_name}.in-progress"

cleanup() {
  rm -f -- "$temporary_path"
}
trap cleanup EXIT

echo "Starting Supabase database backup: ${backup_name}"

pg_dump \
  --dbname="$SUPABASE_DB_URL" \
  --format=custom \
  --compress=6 \
  --no-owner \
  --no-acl \
  --file="$temporary_path"

pg_restore --list "$temporary_path" >/dev/null

mv -- "$temporary_path" "$backup_path"
(
  cd "$backup_dir"
  sha256sum "$backup_name" > "${backup_name}.sha256"
)

find "$backup_dir" \
  -maxdepth 1 \
  -type f \
  \( -name 'supabase-*.dump' -o -name 'supabase-*.dump.sha256' \) \
  -mtime "+${retention_days}" \
  -delete

backup_size="$(du -h "$backup_path" | cut -f1)"
echo "Backup completed and verified: ${backup_path} (${backup_size})"
BACKUP_SCRIPT

RUN chmod 0755 /usr/local/bin/backup-supabase

ENV BACKUP_DIR=/backups \
    BACKUP_RETENTION_DAYS=30 \
    TZ=Europe/Istanbul

VOLUME ["/backups"]

# Coolify starts this container continuously and executes backup-supabase as a
# scheduled task inside it.
CMD ["tail", "-f", "/dev/null"]

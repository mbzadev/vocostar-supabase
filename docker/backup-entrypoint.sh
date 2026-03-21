#!/bin/sh
# backup-entrypoint.sh — WAL-G automated backup for vocostar PostgreSQL
# Runs inside the vocostar-backup container
# Performs: full backup at 03:00, cleanup of old backups, then sleeps until next day

set -e

echo "[WAL-G] Starting backup service — $(date)"
echo "[WAL-G] Target: ${WALG_S3_PREFIX}"

# Function: perform a full backup
do_backup() {
  echo "[WAL-G] ─── Full backup started — $(date) ───"
  wal-g backup-push /var/lib/postgresql/data
  echo "[WAL-G] Backup completed — $(date)"

  echo "[WAL-G] Cleaning backups older than ${WALG_RETENTION_FULL_BACKUPS:-7} days..."
  wal-g delete retain FULL "${WALG_RETENTION_FULL_BACKUPS:-7}" --confirm
  echo "[WAL-G] Cleanup done"

  echo "[WAL-G] Current backup list:"
  wal-g backup-list
}

# First backup on startup (if none exists)
echo "[WAL-G] Checking for existing backups..."
if ! wal-g backup-list 2>/dev/null | grep -q "base_"; then
  echo "[WAL-G] No existing backup found — running initial backup..."
  do_backup
else
  echo "[WAL-G] Existing backups found — skipping initial backup"
  wal-g backup-list
fi

# Daily backup loop at 03:00
while true; do
  # Calculate seconds until next 03:00
  NOW=$(date +%s)
  NEXT_03H=$(date -d "tomorrow 03:00" +%s 2>/dev/null || date -v+1d -v3H -v0M -v0S +%s)
  SLEEP_SECONDS=$((NEXT_03H - NOW))

  echo "[WAL-G] Next backup in ${SLEEP_SECONDS}s (at 03:00 tomorrow)"
  sleep "${SLEEP_SECONDS}"

  do_backup
done

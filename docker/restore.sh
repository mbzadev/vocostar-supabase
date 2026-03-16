#!/bin/bash
# restore.sh — Restore PostgreSQL backup from Cloudflare R2 via WAL-G
# Usage: ./docker/restore.sh [BACKUP_NAME]
# Example: ./docker/restore.sh LATEST
#          ./docker/restore.sh base_000000010000000000000003

set -euo pipefail

BACKUP_NAME="${1:-LATEST}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# Load env
if [ -f "$ROOT_DIR/.env.local" ]; then
  export $(grep -v '^#' "$ROOT_DIR/.env.local" | xargs)
fi

echo "╔══════════════════════════════════════════════════╗"
echo "║          VOCOSTAR PostgreSQL RESTORE             ║"
echo "╠══════════════════════════════════════════════════╣"
echo "║  Backup:   $BACKUP_NAME"
echo "║  Source:   $WALG_S3_PREFIX"
echo "╚══════════════════════════════════════════════════╝"
echo ""
echo "⚠️  WARNING: This will OVERWRITE the current database!"
echo ""
read -p "Type 'RESTORE' to confirm: " CONFIRM
if [ "$CONFIRM" != "RESTORE" ]; then
  echo "Aborted."
  exit 1
fi

echo ""
echo "1. Stopping Studio and API services..."
docker compose -f docker-compose.yml stop studio kong auth rest

echo "2. Listing available backups..."
docker exec vocostar-backup wal-g backup-list || true

echo "3. Restoring backup: $BACKUP_NAME..."
docker run --rm \
  --network=supabase_network_vocostar \
  -v vocostar-supabase_db-data:/var/lib/postgresql/data \
  -e WALG_S3_PREFIX="$WALG_S3_PREFIX" \
  -e AWS_ACCESS_KEY_ID="$AWS_ACCESS_KEY_ID" \
  -e AWS_SECRET_ACCESS_KEY="$AWS_SECRET_ACCESS_KEY" \
  -e AWS_ENDPOINT_URL="$WALG_S3_ENDPOINT" \
  -e AWS_REGION="${WALG_S3_REGION:-auto}" \
  -e AWS_S3_FORCE_PATH_STYLE=true \
  wal-g/wal-g:v3.0.5-pg15 \
  wal-g backup-fetch /var/lib/postgresql/data "$BACKUP_NAME"

echo "4. Restarting services..."
docker compose -f docker-compose.yml up -d

echo ""
echo "✅ Restore complete! Check logs with:"
echo "   docker compose -f docker-compose.yml logs db"

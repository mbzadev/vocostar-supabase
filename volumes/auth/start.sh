#!/bin/sh
# Custom GoTrue entrypoint — applies .env.gotrue override before starting

OVERRIDE_FILE="/etc/gotrue-data/.env.gotrue"

if [ -f "$OVERRIDE_FILE" ]; then
  echo "[auth-start] Applying config overrides from $OVERRIDE_FILE"
  while IFS='=' read -r key value; do
    # Skip empty lines and comments
    case "$key" in
      ''|\#*) continue ;;
    esac
    # Strip inline comments from value
    value="${value%%#*}"
    # Strip leading/trailing whitespace from value
    value=$(printf '%s' "$value" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    export "$key=$value"
    echo "[auth-start]   $key=***"
  done < "$OVERRIDE_FILE"
else
  echo "[auth-start] No override file found at $OVERRIDE_FILE, using defaults"
fi

exec gotrue

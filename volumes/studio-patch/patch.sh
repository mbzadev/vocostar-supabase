#!/bin/sh
set -e

echo "=== Applying Supabase Studio Edge Functions Patch ==="

CHUNKS_DIR="/app/apps/studio/.next/static/chunks"

if [ ! -d "$CHUNKS_DIR" ]; then
    echo "ERROR: chunks dir not found at $CHUNKS_DIR"
    exit 1
fi

# -------------------------------------------------------
# STEP 1: Patch constants module
# Force IS_PLATFORM=true (enables the Deploy button and other platform features)
# Keep API_URL="/api" (necessary for self-hosted - no Supabase Platform API)
# -------------------------------------------------------
echo "Step 1: Patching constants module..."
for file in $(grep -rl '"IS_PLATFORM",0,' "$CHUNKS_DIR"); do
    echo "  Found constants chunk: $file"
    python3 - "$file" << 'PYEOF'
import sys, re
filepath = sys.argv[1]
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()
before = content

# Force IS_PLATFORM=true: "true"===env.NEXT_PUBLIC_IS_PLATFORM -> true
content = re.sub(
    r'"true"===([a-zA-Z_$]+\.default\.env\.NEXT_PUBLIC_IS_PLATFORM)',
    r'true',
    content
)

# Keep API_URL="/api": X=Y?env.NEXT_PUBLIC_API_URL:"/api" -> X="/api"
content = re.sub(
    r'([a-z])=([a-z])\?([a-zA-Z_$]+\.default\.env\.NEXT_PUBLIC_API_URL):"\/api"',
    r'\1="/api"',
    content
)

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

if content != before:
    print("  Constants patched: IS_PLATFORM=true, API_URL=/api")
else:
    print("  No changes (pattern may differ in this version)")
PYEOF
done

# -------------------------------------------------------
# STEP 2: Patch UI chunk - handle remaining IS_PLATFORM&& conditions
# -------------------------------------------------------
echo "Step 2: Patching UI (Deploy button) chunk..."
for file in $(grep -rl "Deploy a new function" "$CHUNKS_DIR"); do
    echo "  Found UI chunk: $file"
    python3 - "$file" << 'PYEOF'
import sys, re
filepath = sys.argv[1]
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

n1 = len(re.findall(r'[A-Za-z_$]+\.IS_PLATFORM&&', content))
n2 = len(re.findall(r'![A-Za-z_$]+\.IS_PLATFORM&&', content))
print(f"  IS_PLATFORM&& : {n1}, !IS_PLATFORM&& : {n2}")

# X.IS_PLATFORM&& -> true&&  (show platform-only elements)
content = re.sub(r'([A-Za-z_$]+)\.IS_PLATFORM&&', r'true&&', content)
# !X.IS_PLATFORM&& -> false&&  (hide self-hosted fallbacks)
content = re.sub(r'!([A-Za-z_$]+)\.IS_PLATFORM&&', r'false&&', content)

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)
print("  UI chunk patched")
PYEOF
done

echo "=== Patch complete. Starting Studio... ==="
exec docker-entrypoint.sh node apps/studio/server.js

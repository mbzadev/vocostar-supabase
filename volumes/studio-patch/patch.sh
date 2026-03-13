#!/bin/sh
set -e

echo "=== Applying Supabase Studio Edge Functions Patch ==="

CHUNKS_DIR="/app/apps/studio/.next/static/chunks"

if [ ! -d "$CHUNKS_DIR" ]; then
    echo "ERROR: chunks dir not found at $CHUNKS_DIR"
    exit 1
fi

PATCHED=0
for file in $(grep -rl "Deploy a new function" "$CHUNKS_DIR"); do
    echo "Found Edge Functions chunk: $file"

    # The JS file contains literal && (0x26 0x26 bytes)
    # We need to replace X.IS_PLATFORM&&  with true&&
    # and !X.IS_PLATFORM&&  with false&&
    # Using Python for reliable cross-platform string replacement
    python3 - "$file" << 'PYEOF'
import sys
import re

filepath = sys.argv[1]
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# Count matches before
before = len(re.findall(r'[A-Za-z_$]+\.IS_PLATFORM&&', content))
print(f"  IS_PLATFORM&& occurrences: {before}")

# Replace X.IS_PLATFORM&& -> true&&  (show IS_PLATFORM=true elements)
content = re.sub(r'([A-Za-z_$]+)\.IS_PLATFORM&&', r'true&&', content)
# Replace !X.IS_PLATFORM&& -> false&&  (hide IS_PLATFORM=false elements)  
content = re.sub(r'!([A-Za-z_$]+)\.IS_PLATFORM&&', r'false&&', content)

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

after = len(re.findall(r'[A-Za-z_$]+\.IS_PLATFORM&&', content))
print(f"  IS_PLATFORM&& occurrences after: {after}")
print(f"  Replacements made: {before - after}")
PYEOF

    PATCHED=$((PATCHED + 1))
    echo "Patched: $file"
done

echo "=== Patch applied to $PATCHED chunk(s). Starting Studio... ==="
exec docker-entrypoint.sh node apps/studio/server.js

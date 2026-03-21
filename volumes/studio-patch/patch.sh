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

# -------------------------------------------------------
# STEP 3: Patch entitlements check — unlock all features in local mode
# Makes useCheckEntitlements return hasAccess=true and all hook keys
# This is needed because useSelectedOrganizationQuery returns undefined
# from /project/* URL context, preventing entitlements from being fetched.
# -------------------------------------------------------
echo "Step 3: Patching entitlements check..."
for file in $(grep -rl 'getEntitlementSetValues' "$CHUNKS_DIR"); do
    echo "  Found entitlements chunk: $file"
    python3 - "$file" << 'PYEOF'
import sys, re
filepath = sys.argv[1]
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()
before = content

# Always return hasAccess=true for all entitlements (local mode — all features unlocked)
content = content.replace(
    'hasAccess:!a.IS_PLATFORM||(b?.hasAccess??!1)',
    'hasAccess:!0'
)

# Always return full set of hook entitlement keys (bypasses org subscription check)
content = content.replace(
    'getEntitlementSetValues:()=>{let e;return(e=b?.config)&&b.type&&"set"===b.type?e.set:[]}',
    'getEntitlementSetValues:()=>["HOOK_SEND_SMS","HOOK_SEND_EMAIL","HOOK_CUSTOM_ACCESS_TOKEN","HOOK_MFA_VERIFICATION_ATTEMPT","HOOK_PASSWORD_VERIFICATION_ATTEMPT","HOOK_BEFORE_USER_CREATED"]'
)

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

if content != before:
    print("  Entitlements patched: hasAccess=true, full hook set enabled")
else:
    print("  No changes (pattern may differ in this version)")
PYEOF
done


# -------------------------------------------------------
# STEP 4: Neutralize sign-in redirect loops caused by GoTrue session checks
# IS_PLATFORM=true enables auth checks that redirect to /sign-in when
# the GoTrue session expires or is missing. We disable these redirects.
# -------------------------------------------------------
echo "Step 4: Fixing auth redirect loops..."
python3 - "$CHUNKS_DIR" << 'PYEOF'
import sys, re, glob, os

chunks_dir = sys.argv[1]
patched = 0

for filepath in glob.glob(os.path.join(chunks_dir, '*.js')):
    try:
        with open(filepath, 'rb') as f:
            content = f.read()
        original = content

        # Pattern 1: w?.code===401 && v().then(()=>g.push("/sign-in"))
        # Triggered when profile query returns 401 — disables auto signout+redirect
        content = re.sub(
            rb'[A-Za-z_$]+\?\.code===401&&[A-Za-z_$]+\(\)\.then\(\(\)=>[A-Za-z_$]+\.push\("/sign-in"\)\)',
            b'false',
            content
        )

        # Pattern 2: l().finally(()=>{o.push(`/sign-in?${t.toString()}`)})
        # Triggered by session expiry signOut — replaced with a no-op
        content = re.sub(
            rb'[a-z]\(\)\.finally\(\(\)=>\{[a-z]\.push\(`/sign-in\?\$\{[a-z]\.toString\(\)\}`\)\}\)',
            b'Promise.resolve()',
            content
        )

        if content != original:
            with open(filepath, 'wb') as f:
                f.write(content)
            patched += 1
            print(f"  Auth redirect fixed: {os.path.basename(filepath)}")

    except Exception as e:
        print(f"  Error: {filepath}: {e}")

print(f"  Auth redirect patch: {patched} file(s) modified")
PYEOF

echo "=== Patch complete. Starting Studio... ==="
exec docker-entrypoint.sh node apps/studio/server.js


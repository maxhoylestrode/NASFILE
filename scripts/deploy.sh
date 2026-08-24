#!/usr/bin/env bash
# drive-clone deploy script — homelab, single Proxmox host, run directly
# on the box (not in a container). Idempotent-ish: safe to re-run after
# fixing something it flagged.
#
# What it does NOT do, on purpose: doesn't touch Postgres/MinIO
# themselves (assumed already running per your homelab stack decisions),
# doesn't touch Nginx Proxy Manager, doesn't require root unless you opt
# into the systemd step at the end.
#
# Usage: bash scripts/deploy.sh   (from the repo root)
set -euo pipefail
cd "$(dirname "$0")/.."
REPO_ROOT="$(pwd)"

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
warn() { printf '\033[33m! %s\033[0m\n' "$1"; }
ok()   { printf '\033[32m✓ %s\033[0m\n' "$1"; }
die()  { printf '\033[31m✗ %s\033[0m\n' "$1"; exit 1; }

bold "== drive-clone deploy =="

# --- 1. prerequisites -------------------------------------------------
command -v node >/dev/null || die "node not found on PATH — install Node.js 20+ first"
command -v npm  >/dev/null || die "npm not found on PATH"
NODE_MAJOR=$(node -e "console.log(process.versions.node.split('.')[0])")
[ "$NODE_MAJOR" -ge 20 ] || warn "Node $(node -v) detected — this was built/tested against Node 20+, older may work but isn't verified"
ok "Node $(node -v), npm $(npm -v)"

# --- 2. .env setup ------------------------------------------------------
if [ ! -f .env ]; then
  warn ".env not found — creating one from .env.example"
  cp .env.example .env
fi

# Auto-generate JWT secrets if they're still the placeholder from
# .env.example — no reason to make you do this by hand.
gen_secret() { openssl rand -hex 32 2>/dev/null || node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"; }

for VAR in JWT_ACCESS_SECRET JWT_REFRESH_SECRET; do
  CURRENT=$(grep -E "^${VAR}=" .env | cut -d= -f2- || true)
  if [[ "$CURRENT" == changeme* || -z "$CURRENT" ]]; then
    NEW=$(gen_secret)
    if grep -qE "^${VAR}=" .env; then
      sed -i.bak "s|^${VAR}=.*|${VAR}=${NEW}|" .env && rm -f .env.bak
    else
      echo "${VAR}=${NEW}" >> .env
    fi
    ok "Generated a random ${VAR}"
  fi
done

# Flag anything that's still an obvious placeholder — these need real
# values from your actual homelab (Postgres, MinIO, the public MinIO
# subdomain). Doesn't block; you might be re-running after only fixing
# some of them.
PLACEHOLDER_VARS=()
check_placeholder() {
  local var="$1" bad_pattern="$2"
  local val
  val=$(grep -E "^${var}=" .env | cut -d= -f2- || true)
  if [[ "$val" == *"$bad_pattern"* || -z "$val" ]]; then
    PLACEHOLDER_VARS+=("$var")
  fi
}
check_placeholder DATABASE_URL changeme
check_placeholder MINIO_ACCESS_KEY changeme
check_placeholder MINIO_SECRET_KEY changeme
check_placeholder MINIO_PUBLIC_URL yourdomain

if [ ${#PLACEHOLDER_VARS[@]} -gt 0 ]; then
  warn "These still look like placeholders in .env — fill in real values, then re-run this script:"
  for v in "${PLACEHOLDER_VARS[@]}"; do echo "    - $v"; done
  die "Stopping here so nothing runs against fake config."
fi
ok ".env looks filled in"

# --- 3. install + build ------------------------------------------------
bold "Installing and building backend..."
npm install
npm run build

bold "Installing and building frontend..."
npm run build:frontend

ok "Build complete"

# --- 4. migrate ----------------------------------------------------------
bold "Running migrations..."
npm run migrate

# --- 5. admin account ----------------------------------------------------
read -r -p "Create an admin account now? [y/N] " CREATE_ADMIN
if [[ "$CREATE_ADMIN" =~ ^[Yy]$ ]]; then
  read -r -p "  Admin email: " ADMIN_EMAIL
  read -r -s -p "  Admin password (min 10 chars): " ADMIN_PASSWORD
  echo
  npm run create-admin -- --email "$ADMIN_EMAIL" --password "$ADMIN_PASSWORD"
else
  warn "Skipped — run this yourself later: npm run create-admin -- --email you@yourdomain.com --password '...'"
fi

# --- 6. systemd (optional, prints commands rather than running as root) --
read -r -p "Generate a systemd service file so this runs on boot / restarts on crash? [y/N] " WANT_SYSTEMD
if [[ "$WANT_SYSTEMD" =~ ^[Yy]$ ]]; then
  NODE_BIN=$(command -v node)
  RUN_AS_USER=$(whoami)
  mkdir -p deploy
  cat > deploy/drive-clone.service << EOF
[Unit]
Description=drive-clone
After=network.target

[Service]
Type=simple
User=${RUN_AS_USER}
WorkingDirectory=${REPO_ROOT}
EnvironmentFile=${REPO_ROOT}/.env
ExecStart=${NODE_BIN} ${REPO_ROOT}/dist/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
  ok "Wrote deploy/drive-clone.service"
  bold "Run these yourself (needs sudo, this script won't do it for you):"
  echo "    sudo cp ${REPO_ROOT}/deploy/drive-clone.service /etc/systemd/system/drive-clone.service"
  echo "    sudo systemctl daemon-reload"
  echo "    sudo systemctl enable --now drive-clone"
  echo "    sudo systemctl status drive-clone   # confirm it's running"
  echo "    journalctl -u drive-clone -f        # tail logs"
else
  warn "Skipped — start it yourself with: npm start (or re-run this script and say yes here later)"
fi

echo
bold "== Still to do, outside this script =="
cat << 'EOF'
1. Nginx Proxy Manager — TWO proxy hosts needed:
   - one for this app itself (whatever port it's running on, PORT in .env)
   - one for MinIO's public subdomain (MINIO_PUBLIC_URL) — see README.md
     "Exposing MinIO for direct browser upload/download" for the exact
     body-size-limit / timeout / Host-header config it needs.
2. Once both are live, run through docs/session-4-qa-checklist.md for
   real — especially the kill-tab-mid-upload-and-resume check, which is
   the one thing that's never been tested outside this sandbox.
EOF

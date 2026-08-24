#!/usr/bin/env bash
# One-shot bootstrap for a FRESH Debian/Ubuntu server: installs Node.js,
# real PostgreSQL, real MinIO, creates a dedicated non-root user to run
# the app under, writes real generated credentials into .env, then hands
# off to scripts/deploy.sh for the app itself (build/migrate/admin/
# systemd).
#
# Everything here is idempotent-checked (skips what's already installed)
# so it's safe to re-run if something fails partway through.
#
# Does NOT touch a reverse proxy — assumes Nginx Proxy Manager (or
# whatever you use) runs elsewhere on your network and just needs an
# IP:port to point at, which this script prints at the end.
#
# Run as root: sudo bash scripts/provision-server.sh
set -euo pipefail
cd "$(dirname "$0")/.."
REPO_ROOT="$(pwd)"
APP_USER="drive-clone"

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
warn() { printf '\033[33m! %s\033[0m\n' "$1"; }
ok()   { printf '\033[32m✓ %s\033[0m\n' "$1"; }
die()  { printf '\033[31m✗ %s\033[0m\n' "$1"; exit 1; }
gen_secret() { openssl rand -hex "$1" 2>/dev/null || node -e "console.log(require('crypto').randomBytes($1).toString('hex'))"; }

[ "$(id -u)" -eq 0 ] || die "Run this as root (sudo bash scripts/provision-server.sh) — it installs system packages and creates a system user."
command -v apt-get >/dev/null || die "This script only supports Debian/Ubuntu (apt-get not found). Everything past this point assumes apt."

bold "== drive-clone server provisioning =="
LAN_IP=$(hostname -I | awk '{print $1}')
ok "Detected LAN IP: ${LAN_IP:-<unknown, check manually>}"

apt-get update -qq

# Some minimal cloud/container base images ship without curl at all —
# NodeSource's setup script and the MinIO download both need it, so make
# sure it (and a couple of other things those two commonly assume) exist
# before anything tries to use them.
apt-get install -y -qq curl ca-certificates gnupg lsb-release

# .env is set up here, early, and every section below writes its own
# credential into it the moment that credential is generated — not
# batched at the end. A previous version of this script batched all the
# .env writes into one late section; if something failed in between (as
# happened on a real run — a typo'd storage path died the script after
# the Postgres role/password were already created but before either got
# saved), the generated password was lost forever while the role that
# used it still existed, requiring a manual ALTER ROLE to recover. This
# way a crash anywhere only ever strands work that hasn't been persisted
# yet, never a credential that was already generated.
if [ ! -f .env ]; then
  cp .env.example .env
fi

set_env() {
  local var="$1" val="$2"
  if grep -qE "^${var}=" .env; then
    sed -i "s|^${var}=.*|${var}=${val}|" .env
  else
    echo "${var}=${val}" >> .env
  fi
}

# --- 1. Node.js ----------------------------------------------------------
if command -v node >/dev/null && [ "$(node -e 'console.log(process.versions.node.split(".")[0])')" -ge 20 ]; then
  ok "Node.js $(node -v) already installed"
else
  bold "Installing Node.js 20.x (NodeSource)..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
  ok "Node.js $(node -v) installed"
fi

# --- 2. PostgreSQL ---------------------------------------------------------
if command -v psql >/dev/null; then
  ok "PostgreSQL already installed"
else
  bold "Installing PostgreSQL..."
  apt-get install -y postgresql postgresql-contrib
  systemctl enable --now postgresql
  ok "PostgreSQL installed and running"
fi

PG_ROLE_EXISTS=$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='drive_clone'" 2>/dev/null || echo "")
if [ "$PG_ROLE_EXISTS" = "1" ]; then
  warn "Postgres role 'drive_clone' already exists — leaving it alone. Make sure DATABASE_URL in .env has the RIGHT password for it (this script can't recover a password it didn't just generate)."
  DB_ALREADY_EXISTED=1
else
  PG_PASSWORD=$(gen_secret 16)
  sudo -u postgres psql -c "CREATE ROLE drive_clone WITH LOGIN PASSWORD '${PG_PASSWORD}';" >/dev/null
  sudo -u postgres psql -c "CREATE DATABASE drive_clone OWNER drive_clone;" >/dev/null
  set_env DATABASE_URL "postgres://drive_clone:${PG_PASSWORD}@localhost:5432/drive_clone"
  ok "Created Postgres role + database 'drive_clone', saved to .env"
  DB_ALREADY_EXISTED=0
fi

# --- 3. MinIO ---------------------------------------------------------------
if [ -x /usr/local/bin/minio ]; then
  ok "MinIO binary already installed"
else
  bold "Downloading MinIO server..."
  curl -fsSL -o /usr/local/bin/minio https://dl.min.io/server/minio/release/linux-amd64/minio
  chmod +x /usr/local/bin/minio
  ok "MinIO binary installed"
fi

id -u minio-user >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin minio-user

if [ -z "${MINIO_STORAGE_PATH:-}" ]; then
  echo
  df -h | grep -vE '^tmpfs|^udev|^overlay' || true
  read -r -p "Where should MinIO store files? (the mount point for your 1TB storage, e.g. /mnt/storage) " MINIO_STORAGE_PATH
fi
[ -d "$MINIO_STORAGE_PATH" ] || die "Path '$MINIO_STORAGE_PATH' doesn't exist — create/mount it first, then re-run."
MINIO_DATA_DIR="${MINIO_STORAGE_PATH%/}/minio-data"
mkdir -p "$MINIO_DATA_DIR"
chown -R minio-user:minio-user "$MINIO_DATA_DIR"
ok "MinIO data directory: $MINIO_DATA_DIR"

if [ -f /etc/default/minio ]; then
  warn "/etc/default/minio already exists — leaving credentials alone. Delete it and re-run if you want fresh ones."
  MINIO_ROOT_USER=$(grep -oP '^MINIO_ROOT_USER=\K.*' /etc/default/minio | tr -d '"')
  MINIO_ROOT_PASSWORD=$(grep -oP '^MINIO_ROOT_PASSWORD=\K.*' /etc/default/minio | tr -d '"')
else
  MINIO_ROOT_USER="drive-clone-$(gen_secret 4)"
  MINIO_ROOT_PASSWORD=$(gen_secret 20)
  cat > /etc/default/minio << EOF
MINIO_VOLUMES="${MINIO_DATA_DIR}"
MINIO_OPTS="--address :9000 --console-address :9001"
MINIO_ROOT_USER=${MINIO_ROOT_USER}
MINIO_ROOT_PASSWORD=${MINIO_ROOT_PASSWORD}
EOF
  ok "Wrote /etc/default/minio with fresh generated credentials"
fi
set_env MINIO_ENDPOINT "localhost"
set_env MINIO_PORT "9000"
set_env MINIO_USE_SSL "false"
set_env MINIO_ACCESS_KEY "$MINIO_ROOT_USER"
set_env MINIO_SECRET_KEY "$MINIO_ROOT_PASSWORD"
ok "MinIO credentials saved to .env"

if [ ! -f /etc/systemd/system/minio.service ]; then
  # Standard unit shape from MinIO's own documentation.
  cat > /etc/systemd/system/minio.service << 'EOF'
[Unit]
Description=MinIO
Documentation=https://min.io/docs/minio/linux/index.html
Wants=network-online.target
After=network-online.target
AssertFileIsExecutable=/usr/local/bin/minio

[Service]
WorkingDirectory=/usr/local
User=minio-user
Group=minio-user
ProtectProc=invisible
EnvironmentFile=-/etc/default/minio
ExecStartPre=/bin/bash -c "if [ -z \"${MINIO_VOLUMES}\" ]; then echo \"Variable MINIO_VOLUMES not set in /etc/default/minio\"; exit 1; fi"
ExecStart=/usr/local/bin/minio server $MINIO_OPTS $MINIO_VOLUMES
Restart=always
LimitNOFILE=1048576
TasksMax=infinity
TimeoutStopSec=infinity
SendSIGKILL=no

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
fi
systemctl enable --now minio
sleep 2
systemctl is-active --quiet minio && ok "MinIO running on :9000 (console :9001)" || warn "MinIO service didn't come up cleanly — check: journalctl -u minio -n 50"

# --- 4. Dedicated app user ---------------------------------------------------
if id -u "$APP_USER" >/dev/null 2>&1; then
  ok "User '$APP_USER' already exists"
else
  useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"
  ok "Created system user '$APP_USER' (the app runs as this, not root)"
fi
chown -R "$APP_USER:$APP_USER" "$REPO_ROOT"

# --- 5. Public domains (just prompts — the credentials above are
#        already saved) -------------------------------------------------
echo
echo "MinIO needs a public hostname for presigned URLs to work in a browser"
echo "(the app server and MinIO can be on this same box, but the browser has"
echo "to reach MinIO directly — see README 'Exposing MinIO' section)."
read -r -p "What domain will MinIO be reachable at once your reverse proxy is set up? (e.g. s3.yourdomain.com — DNS doesn't need to be live yet) " S3_DOMAIN
if [ -n "$S3_DOMAIN" ]; then
  set_env MINIO_PUBLIC_URL "https://${S3_DOMAIN}"
fi
read -r -p "What domain will the APP itself be reachable at? (e.g. drive.yourdomain.com — just for the summary at the end, not stored anywhere) " APP_DOMAIN

# --- 6. Hand off to deploy.sh as the app user --------------------------------
bold "Handing off to scripts/deploy.sh as user '$APP_USER'..."
sudo -u "$APP_USER" -H bash "$REPO_ROOT/scripts/deploy.sh"

# --- 7. Install the systemd unit deploy.sh generated (we have root, it doesn't) --
if [ -f "$REPO_ROOT/deploy/drive-clone.service" ]; then
  read -r -p "Install and start the drive-clone systemd service now? [y/N] " INSTALL_SERVICE
  if [[ "$INSTALL_SERVICE" =~ ^[Yy]$ ]]; then
    cp "$REPO_ROOT/deploy/drive-clone.service" /etc/systemd/system/drive-clone.service
    systemctl daemon-reload
    systemctl enable --now drive-clone
    sleep 2
    systemctl is-active --quiet drive-clone && ok "drive-clone service running" || warn "Service didn't come up cleanly — check: journalctl -u drive-clone -n 50"
  fi
fi

# --- 8. Firewall (opt-in, never silent) --------------------------------------
echo
read -r -p "Configure ufw now? This is the one step that can lock you out if done wrong, so it's fully opt-in. [y/N] " DO_FIREWALL
if [[ "$DO_FIREWALL" =~ ^[Yy]$ ]]; then
  SSH_PORT=$(grep -oP '^Port \K\d+' /etc/ssh/sshd_config 2>/dev/null || echo 22)
  bold "About to allow: SSH on port ${SSH_PORT}, app on 3000, MinIO on 9000 — then enable ufw."
  warn "If your SSH port is something other than ${SSH_PORT}, STOP NOW and check /etc/ssh/sshd_config first."
  read -r -p "Confirm and proceed? [y/N] " CONFIRM_FW
  if [[ "$CONFIRM_FW" =~ ^[Yy]$ ]]; then
    ufw allow "${SSH_PORT}/tcp" comment "SSH"
    ufw allow 3000/tcp comment "drive-clone app"
    ufw allow 9000/tcp comment "MinIO S3 API"
    ufw --force enable
    ok "ufw enabled: SSH(${SSH_PORT}), 3000, 9000 allowed"
    warn "9000 and 3000 are open to anything that can reach this box's network interface. If your NPM box has a fixed IP, consider tightening: ufw delete allow 3000/tcp && ufw allow from <npm-ip> to any port 3000 proto tcp (same for 9000)."
  else
    warn "Firewall not touched."
  fi
else
  warn "Firewall not touched — ports 3000/9000 are only as protected as whatever's already configured on this box."
fi

echo
bold "== Done — here's what goes into Nginx Proxy Manager (on the other box) =="
cat << EOF
Proxy host 1 — the app:
  Domain:              ${APP_DOMAIN:-<you didn't give me one, use whatever you land on>}
  Forward to:           ${LAN_IP}:3000

Proxy host 2 — MinIO:
  Domain:              ${S3_DOMAIN:-<you didn't give me one, use whatever you land on>}
  Forward to:           ${LAN_IP}:9000
  Advanced config (required, see README "Exposing MinIO"):
    client_max_body_size 0;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
  Do NOT let NPM rewrite the Host header on this one — presigned URLs are
  signed against the exact hostname above, a changed Host header breaks
  every upload/download with SignatureDoesNotMatch.

If you skipped naming domains just now: edit MINIO_PUBLIC_URL in .env
once you've picked one, then \`sudo systemctl restart drive-clone\`.
EOF

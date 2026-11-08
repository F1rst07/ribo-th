#!/usr/bin/env bash
# Push the Next.js dashboard to Arduino UNO Q over Wi-Fi (no USB).
# Mac must be on the same LAN as the board (e.g. Tuangthong Mansion_5G).
#
# Usage:
#   export RIBO_UNOQ_SSH_PASSWORD='your-ssh-password'
#   ./scripts/deploy-dashboard-wifi.sh [board-ip]
#
# Optional: install sshpass for non-interactive SSH (brew install hudochenkov/sshpass/sshpass)

set -euo pipefail

BOARD_IP="${1:-192.168.100.15}"
SSH_USER="${RIBO_UNOQ_SSH_USER:-arduino}"
REMOTE_WEB="${RIBO_REMOTE_WEB_DIR:-/home/arduino/ribo-stack/current/web}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! ping -c 1 -W 2 "$BOARD_IP" >/dev/null 2>&1; then
  echo "Cannot reach $BOARD_IP — connect this Mac to the same Wi-Fi as the board." >&2
  exit 1
fi

echo "Building dashboard (RIBO_DEVICE_MODE=true)…"
export RIBO_DEVICE_MODE=true
npm run build

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

echo "Staging standalone bundle…"
cp -a .next/standalone/. "$STAGE/"
mkdir -p "$STAGE/.next"
cp -a .next/static "$STAGE/.next/"
if [[ -d public ]]; then
  cp -a public "$STAGE/"
fi

SSH_OPTS=(-o "StrictHostKeyChecking=accept-new" -o "ConnectTimeout=12")
RSYNC_SSH="ssh ${SSH_OPTS[*]}"

rsync_to_board() {
  if command -v sshpass >/dev/null 2>&1 && [[ -n "${RIBO_UNOQ_SSH_PASSWORD:-}" ]]; then
    SSHPASS="$RIBO_UNOQ_SSH_PASSWORD" sshpass -e rsync -az --delete -e "$RSYNC_SSH" "$@"
  else
    rsync -az --delete -e "$RSYNC_SSH" "$@"
  fi
}

ssh_board() {
  if command -v sshpass >/dev/null 2>&1 && [[ -n "${RIBO_UNOQ_SSH_PASSWORD:-}" ]]; then
    SSHPASS="$RIBO_UNOQ_SSH_PASSWORD" sshpass -e ssh "${SSH_OPTS[@]}" "${SSH_USER}@${BOARD_IP}" "$@"
  else
    ssh "${SSH_OPTS[@]}" "${SSH_USER}@${BOARD_IP}" "$@"
  fi
}

echo "Stopping ribo-dashboard on board…"
ssh_board "systemctl is-active ribo-dashboard.service 2>/dev/null && sudo -n systemctl stop ribo-dashboard.service || true"

echo "Uploading web bundle to ${REMOTE_WEB}…"
rsync_to_board "$STAGE/" "${SSH_USER}@${BOARD_IP}:${REMOTE_WEB}/"

echo "Starting ribo-dashboard…"
ssh_board "sudo -n systemctl start ribo-dashboard.service && sleep 2 && systemctl is-active ribo-dashboard.service"

echo "Verifying CORS preflight…"
curl -sS -m 8 -D - -o /dev/null -X OPTIONS \
  -H 'Origin: https://ribo-th.vercel.app' \
  -H 'Access-Control-Request-Method: GET' \
  "http://${BOARD_IP}:3000/api/arduino/status" | rg -i 'access-control-allow-origin|access-control-allow-private-network' || true

echo "Done. Open http://${BOARD_IP}:3000/ on phone (same Wi-Fi)."

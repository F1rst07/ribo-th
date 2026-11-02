#!/bin/bash
# Run on UNO Q as arduino. The release must already be copied and verified.
set -euo pipefail
release=${1:?Usage: install-device.sh /absolute/release/stack}
test -f "$release/ai-backend/device_server.py"
test -f "$release/web/server.js"
test -f "$release/models/manifest.json"
state=/home/arduino/ribo-stack
backup="$state/backups/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$backup"
if [ -L "$state/current" ]; then readlink "$state/current" > "$backup/previous-release"; fi
for unit in ribo-vision.service ribo-ai-device.service ribo-dashboard.service; do
    systemctl is-enabled "$unit" > "$backup/$unit.enabled" 2>/dev/null || true
    if [ -f "/etc/systemd/system/$unit" ]; then cp "/etc/systemd/system/$unit" "$backup/$unit"; fi
done
sudo systemctl stop ribo-vision.service
sudo systemctl disable ribo-vision.service
ln -sfn "$release" "$state/current"
sudo install -m 644 "$release/ai-backend/deploy/ribo-ai-device.service" /etc/systemd/system/
sudo install -m 644 "$release/ai-backend/deploy/ribo-dashboard.service" /etc/systemd/system/
# Preserve the old unit above, then make its historical name an alias. Tools
# starting ribo-vision now start this same release instead of an older model.
sudo ln -sfn /etc/systemd/system/ribo-ai-device.service /etc/systemd/system/ribo-vision.service
sudo systemctl daemon-reload
sudo systemctl enable --now ribo-ai-device.service ribo-dashboard.service
printf 'Backup: %s\n' "$backup"

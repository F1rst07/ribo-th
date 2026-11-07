#!/usr/bin/env bash
# Connect Arduino UNO Q to Wi-Fi via ADB (USB). Usage:
#   ./scripts/unoq-wifi-connect.sh "Tuangthong Mansion_5G"
#   ./scripts/unoq-wifi-connect.sh "MySSID" "password"

set -euo pipefail

SSID="${1:-}"
PASSWORD="${2:-}"

if [[ -z "$SSID" ]]; then
  echo "Usage: $0 <SSID> [password]" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ADB="${ADB_PATH:-$HOME/Library/Android/sdk/platform-tools/adb}"

if [[ ! -x "$ADB" ]]; then
  ADB="$(command -v adb || true)"
fi

if [[ -z "$ADB" ]]; then
  echo "adb not found. Install Android platform-tools or set ADB_PATH." >&2
  exit 1
fi

"$ADB" wait-for-device

if [[ -n "$PASSWORD" ]]; then
  "$ADB" shell "sudo -n nmcli device wifi connect '$SSID' password '$PASSWORD'"
else
  "$ADB" shell "sudo -n nmcli device wifi connect '$SSID'"
fi

sleep 2
IP="$("$ADB" shell "ip -4 -o addr show wlan0 2>/dev/null | awk '{print \$4}' | cut -d/ -f1 | head -1" | tr -d '\r')"
echo "Board wlan0 IP: ${IP:-unknown}"

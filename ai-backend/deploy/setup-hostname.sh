#!/bin/bash
# Stable mDNS name so DHCP IP changes do not break the dashboard URL.
set -euo pipefail
HOST_NAME="${1:-ribo-th}"

if command -v hostnamectl >/dev/null 2>&1; then
  sudo hostnamectl set-hostname "$HOST_NAME"
else
  echo "$HOST_NAME" | sudo tee /etc/hostname >/dev/null
  sudo hostname "$HOST_NAME"
fi

if grep -qE '[[:space:]]ribo-th(\s|$)' /etc/hosts; then
  sudo sed -i 's/^127\.0\.1\.1.*/127.0.1.1 ribo-th/' /etc/hosts
else
  echo "127.0.1.1 ribo-th" | sudo tee -a /etc/hosts >/dev/null
fi

if ! dpkg -s avahi-daemon >/dev/null 2>&1; then
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y avahi-daemon
fi

sudo tee /etc/avahi/avahi-daemon.conf >/dev/null <<'EOF'
[server]
host-name=ribo-th
domain-name=local
use-ipv4=yes
use-ipv6=no
allow-interfaces=wlan0
deny-interfaces=docker0,lo
enable-dbus=yes

[wide-area]
enable-wide-area=no

[publish]
publish-addresses=yes
publish-hinfo=no
publish-workstation=yes
publish-domain=yes

[reflector]
enable-reflector=no
EOF

sudo mkdir -p /etc/avahi/services
sudo tee /etc/avahi/services/ribo-th.service >/dev/null <<'EOF'
<?xml version="1.0" standalone="no"?>
<!DOCTYPE service-group SYSTEM "avahi-service.dtd">
<service-group>
  <name replace-wildcards="yes">RIBO-TH %h</name>
  <service>
    <type>_http._tcp</type>
    <port>3000</port>
  </service>
</service-group>
EOF

sudo systemctl enable avahi-daemon
sudo systemctl restart avahi-daemon
sleep 1
printf 'hostname=%s mdns=ribo-th.local\n' "$HOST_NAME"

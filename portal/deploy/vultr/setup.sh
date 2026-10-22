#!/usr/bin/env bash
# One-time setup of a fresh Vultr server (Ubuntu 24.04 LTS, Sydney) for the
# Lakeba Investor Portal. Run as root:
#
#   DEPLOY_PUBKEY="ssh-ed25519 AAAA… github-actions" bash setup.sh
#
# Installs Node 24 LTS and Caddy (automatic HTTPS), turns on the firewall and
# automatic security updates, creates the service user ("portal") and the
# deploy user ("deploy", used only by GitHub Actions to install releases).
# Safe to run again.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Run as root."; exit 1; }
[[ -n "${DEPLOY_PUBKEY:-}" ]] || { echo "Set DEPLOY_PUBKEY to the public half of the GitHub Actions deploy key."; exit 1; }
HERE="$(cd "$(dirname "$0")" && pwd)"

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get -y upgrade
apt-get -y install ca-certificates curl gnupg ufw unattended-upgrades debian-keyring debian-archive-keyring apt-transport-https

# Automatic security updates (reboots are left to an admin).
dpkg-reconfigure -f noninteractive unattended-upgrades

# Firewall: SSH and the web only. The portal itself listens on 127.0.0.1.
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# SSH: keys only.
sed -i -E 's/^#?PasswordAuthentication .*/PasswordAuthentication no/; s/^#?PermitRootLogin .*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
systemctl reload ssh

# Node.js 24 LTS from NodeSource's signed apt repository.
install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
# Caddy from its official signed apt repository.
curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
apt-get update
apt-get -y install nodejs caddy

# Users and folders.
id portal >/dev/null 2>&1 || useradd --system --home /srv/lakeba-portal --shell /usr/sbin/nologin portal
id deploy >/dev/null 2>&1 || useradd --create-home --shell /bin/bash deploy
install -d -o portal -g portal -m 0755 /srv/lakeba-portal /srv/lakeba-portal/releases
install -d -o root -g portal -m 0750 /etc/lakeba-portal
install -d -o deploy -g deploy -m 0700 /home/deploy/.ssh
echo "$DEPLOY_PUBKEY" > /home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys && chmod 600 /home/deploy/.ssh/authorized_keys

# Secrets: filled in by an admin, readable only by root and the service.
if [[ ! -f /etc/lakeba-portal/portal.env ]]; then
  install -o root -g portal -m 0640 "$HERE/portal.env.example" /etc/lakeba-portal/portal.env
  echo ">> Fill in /etc/lakeba-portal/portal.env before the first deploy."
fi

# Release installer: the deploy user may run this one command as root, nothing else.
install -o root -g root -m 0755 "$HERE/activate.sh" /usr/local/bin/lakeba-portal-activate
echo 'deploy ALL=(root) NOPASSWD: /usr/local/bin/lakeba-portal-activate' > /etc/sudoers.d/lakeba-portal
chmod 440 /etc/sudoers.d/lakeba-portal
visudo -c >/dev/null

install -o root -g root -m 0644 "$HERE/lakeba-portal.service" /etc/systemd/system/lakeba-portal.service
install -o root -g root -m 0644 "$HERE/Caddyfile" /etc/caddy/Caddyfile
systemctl daemon-reload
systemctl enable lakeba-portal
systemctl reload caddy || systemctl restart caddy

echo ">> Done. Point investors.lakeba.com at this server's IP, fill in portal.env, then run the GitHub 'Deploy portal' workflow."

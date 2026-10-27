#!/usr/bin/env bash
# Creates the key that encrypts integration secrets (webhook signing secrets,
# HubSpot and Xero tokens) and writes it to /etc/lakeba-portal/portal.env
# (root-only), then restarts the portal. The key never leaves the server and
# is not printed. Back it up with the server's backups: without it, stored
# webhook secrets and HubSpot/Xero connections can't be read (companies would
# make new webhooks and connect again).
#
#   ssh root@<server> lakeba-set-integrations-key
#
# Safe to run again: an existing key is kept.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Run as root."; exit 1; }
ENV=/etc/lakeba-portal/portal.env
if grep -q '^INTEGRATIONS_KEY=.\+' "$ENV"; then
  echo "The integrations key is already set; nothing changed."
  exit 0
fi
KEY=$(openssl rand -base64 32)
python3 - "$ENV" "$KEY" <<'PY'
import os, sys
path, key = sys.argv[1], sys.argv[2]
lines = [l for l in open(path).read().split('\n') if not l.startswith('INTEGRATIONS_KEY=')]
while lines and lines[-1] == '': lines.pop()
lines += ['# Integrations: encrypts webhook secrets and HubSpot/Xero tokens (lakeba-set-integrations-key)', f'INTEGRATIONS_KEY={key}']
st = os.stat(path); tmp = path + '.new'
with open(tmp, 'w') as f: f.write('\n'.join(lines) + '\n')
os.chmod(tmp, st.st_mode & 0o777); os.chown(tmp, st.st_uid, st.st_gid); os.replace(tmp, path)
PY
systemctl restart lakeba-portal
echo "Integrations key set; portal restarted ($(systemctl is-active lakeba-portal))."

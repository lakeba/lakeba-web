#!/usr/bin/env bash
# Creates the server's Web Push (VAPID) keys for browser notifications and
# writes them to /etc/lakeba-portal/portal.env (root-only), then restarts the
# portal. The keys never leave the server and are not printed.
#
#   ssh root@<server> lakeba-set-push-keys
#
# Safe to run again: existing keys are kept (new keys would turn off every
# device that already said yes). Use --rotate to replace them on purpose.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Run as root."; exit 1; }
ENV=/etc/lakeba-portal/portal.env
if grep -q '^VAPID_PRIVATE_KEY=.\+' "$ENV" && [[ "${1:-}" != "--rotate" ]]; then
  echo "Push keys are already set. (Run with --rotate to replace them; devices would need to turn notifications on again.)"
  exit 0
fi
NODE_PATH=/opt/lakeba-portal/current/node_modules node - "$ENV" <<'JS'
const fs = require('fs');
const { generateVAPIDKeys } = require('web-push');
const path = process.argv[2];
const keys = generateVAPIDKeys();
const set = { VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: 'mailto:info@lakeba.com' };
let lines = fs.readFileSync(path, 'utf8').split('\n').filter((l) => !/^VAPID_(PUBLIC_KEY|PRIVATE_KEY|SUBJECT)=/.test(l));
while (lines.length && lines[lines.length - 1] === '') lines.pop();
lines.push('# Browser notifications (Web Push), created by lakeba-set-push-keys', ...Object.entries(set).map(([k, v]) => `${k}=${v}`));
const st = fs.statSync(path), tmp = path + '.new';
fs.writeFileSync(tmp, lines.join('\n') + '\n', { mode: st.mode & 0o777 });
fs.chownSync(tmp, st.uid, st.gid);
fs.renameSync(tmp, path);
JS
systemctl restart lakeba-portal
echo "Push keys set; portal restarted ($(systemctl is-active lakeba-portal))."

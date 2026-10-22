#!/usr/bin/env bash
# Sets the Claude API key that turns on AI answers in Ask Lakeba. Run it
# yourself, as root, so the key is typed (or piped) only here:
#
#   ssh -t root@<server> lakeba-set-anthropic-key
#   … | ssh root@<server> lakeba-set-anthropic-key        (key on stdin)
#
# Checks the key with Anthropic first (listing models costs nothing; nothing
# changes if it fails), then writes ANTHROPIC_API_KEY to
# /etc/lakeba-portal/portal.env (root-only) and restarts the portal.
# An empty key turns AI answers off again.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Run as root."; exit 1; }
read -rs -p "Claude API key (empty = turn AI answers off): " KEY; echo
export KEY

if [[ -n "$KEY" ]]; then
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 https://api.anthropic.com/v1/models \
    -H "x-api-key: $KEY" -H 'anthropic-version: 2023-06-01') || code=000
  [[ "$code" == 200 ]] || { echo "Anthropic did not accept that key (HTTP $code). Nothing changed."; exit 1; }
  echo "Anthropic accepted the key."
fi

python3 - <<'PY'
import os, re
path = '/etc/lakeba-portal/portal.env'
key = os.environ['KEY']
lines = open(path).read().splitlines()
done = False
for i, line in enumerate(lines):
    if re.match(r'^ANTHROPIC_API_KEY=', line):
        lines[i] = f'ANTHROPIC_API_KEY={key}'; done = True
if not done: lines.append(f'ANTHROPIC_API_KEY={key}')
st = os.stat(path); tmp = path + '.new'
with open(tmp, 'w') as f: f.write('\n'.join(lines) + '\n')
os.chown(tmp, st.st_uid, st.st_gid); os.chmod(tmp, st.st_mode & 0o777); os.replace(tmp, path)
PY
unset KEY
systemctl restart lakeba-portal
echo "Portal restarted ($(systemctl is-active lakeba-portal)). AI answers are $( grep -q '^ANTHROPIC_API_KEY=.\+' /etc/lakeba-portal/portal.env && echo on || echo off )."

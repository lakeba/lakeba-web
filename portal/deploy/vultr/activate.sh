#!/usr/bin/env bash
# Installs a portal release uploaded by the deploy user and switches to it.
# Called by GitHub Actions as: sudo lakeba-portal-activate <release-id>
# The bundle must be at /home/deploy/releases/<release-id>.tgz.
set -euo pipefail
ID="${1:-}"
[[ "$ID" =~ ^[A-Za-z0-9._-]{6,64}$ ]] || { echo "Bad release id"; exit 2; }
BUNDLE="/home/deploy/releases/$ID.tgz"
[[ -f "$BUNDLE" ]] || { echo "No bundle at $BUNDLE"; exit 2; }
ROOT=/srv/lakeba-portal
DEST="$ROOT/releases/$ID"

rm -rf "$DEST"
install -d -o portal -g portal -m 0755 "$DEST"
tar -xzf "$BUNDLE" -C "$DEST" --no-same-owner
chown -R portal:portal "$DEST"
# Production dependencies only, exactly as locked.
sudo -u portal -H bash -c "cd '$DEST' && npm ci --omit=dev --no-audit --no-fund"

PREVIOUS="$(readlink -f "$ROOT/current" || true)"
ln -sfn "$DEST" "$ROOT/current.new" && mv -Tf "$ROOT/current.new" "$ROOT/current"
systemctl restart lakeba-portal

# Health check; roll back if the new release doesn't answer.
for _ in $(seq 1 20); do
  if curl -fsS -o /dev/null http://127.0.0.1:4321/login; then
    echo "Release $ID is live."
    rm -f "$BUNDLE"
    # Keep the five most recent releases.
    ls -1dt "$ROOT"/releases/*/ | tail -n +6 | xargs -r rm -rf
    exit 0
  fi
  sleep 1
done
echo "Release $ID did not start; rolling back." >&2
if [[ -n "$PREVIOUS" && -d "$PREVIOUS" ]]; then
  ln -sfn "$PREVIOUS" "$ROOT/current.new" && mv -Tf "$ROOT/current.new" "$ROOT/current"
  systemctl restart lakeba-portal
fi
journalctl -u lakeba-portal -n 40 --no-pager >&2 || true
exit 1

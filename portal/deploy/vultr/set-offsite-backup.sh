#!/usr/bin/env bash
# Sets up the off-server copy of the nightly backup to Backblaze B2. Run it
# yourself, as root, so the key is typed only here:
#
#   ssh -t root@<server> lakeba-set-offsite-backup
#
# Asks for the B2 application key (keyID + applicationKey, limited to one
# bucket) and the bucket name, creates an encryption passphrase and shows it
# ONCE: save it in your password manager. Without it, the copies can't be
# restored if this server is lost. Then installs rclone if needed and copies,
# downloads and decrypts the latest backup as a test.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Run as root."; exit 1; }
CONF=/etc/lakeba-backup
install -d -m 700 "$CONF"
command -v rclone >/dev/null || { echo "Installing rclone…"; apt-get update -qq && apt-get install -y -qq rclone >/dev/null; }

read -r -p "B2 keyID: " KEY_ID
read -rs -p "B2 applicationKey: " APP_KEY; echo
read -r -p "B2 bucket name: " BUCKET
[[ -n "$KEY_ID" && -n "$APP_KEY" && -n "$BUCKET" ]] || { echo "All three are needed. Nothing changed."; exit 1; }
export RCLONE_CONFIG_B2_TYPE=b2 RCLONE_CONFIG_B2_ACCOUNT="$KEY_ID" RCLONE_CONFIG_B2_KEY="$APP_KEY"
rclone lsd "b2:$BUCKET" >/dev/null 2>&1 || rclone lsf "b2:$BUCKET" --max-depth 1 >/dev/null || { echo "Backblaze didn't accept that key for bucket $BUCKET. Nothing changed."; exit 1; }
echo "Backblaze accepted the key."

if [[ ! -s "$CONF/passphrase" ]]; then
  umask 077
  openssl rand -base64 32 | tr -d '\n' > "$CONF/passphrase"
  echo
  echo "================ SAVE THIS IN YOUR PASSWORD MANAGER ================"
  echo "Backup encryption passphrase: $(cat "$CONF/passphrase")"
  echo "Without it the off-server copies cannot be restored."
  echo "===================================================================="
  echo
  read -r -p "Type 'saved' once it's in your password manager: " ok
  [[ "$ok" == saved ]] || { rm -f "$CONF/passphrase"; echo "Not saved; nothing changed."; exit 1; }
else
  echo "Keeping the existing encryption passphrase."
fi

umask 077
printf 'B2_KEY_ID=%q\nB2_APP_KEY=%q\nB2_BUCKET=%q\nREMOTE_KEEP_DAYS=35\n' "$KEY_ID" "$APP_KEY" "$BUCKET" > "$CONF/offsite.env"
unset APP_KEY

echo "Running a backup now with the off-server copy…"
/usr/local/bin/lakeba-backup
latest="$(rclone lsf "b2:$BUCKET/lakeba" | sort | tail -1)"
tmp="$(mktemp -d)"
rclone copyto "b2:$BUCKET/lakeba/$latest" "$tmp/b.gpg"
gpg --batch --quiet --decrypt --passphrase-file "$CONF/passphrase" "$tmp/b.gpg" | tar -C "$tmp" -xf -
( cd "$tmp"/*/ && sha256sum --quiet -c SHA256SUMS ) && echo "Test restore of $latest from Backblaze: OK (decrypted, checksums match)."
rm -rf "$tmp"

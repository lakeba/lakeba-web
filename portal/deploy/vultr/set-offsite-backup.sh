#!/usr/bin/env bash
# Sets up the off-server copy of the nightly backup to Azure Blob Storage
# (a storage account of its own, in Australia East). Run it yourself, as root,
# so the key is typed only here:
#
#   ssh -t root@<server> lakeba-set-offsite-backup
#
# Asks for the storage account name, one of its access keys and the container,
# creates an encryption passphrase and shows it ONCE: save it in your password
# manager. Without it, the copies can't be restored if this server is lost.
# Then installs rclone if needed and copies, downloads and decrypts the latest
# backup as a test.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Run as root."; exit 1; }
CONF=/etc/lakeba-backup
install -d -m 700 "$CONF"
# Ubuntu's own rclone package is too old for Azure; use rclone's current release.
if ! rclone version 2>/dev/null | head -1 | grep -qE 'v1\.(6[5-9]|[7-9][0-9])'; then
  echo "Installing the current rclone…"
  deb="$(mktemp --suffix=.deb)"
  curl -fsSL "https://downloads.rclone.org/rclone-current-linux-$(dpkg --print-architecture).deb" -o "$deb"
  dpkg -i "$deb" >/dev/null && rm -f "$deb"
fi

read -r -p "Azure storage account name: " ACCOUNT
read -rs -p "Access key (key1 or key2): " KEY; echo
read -r -p "Container name [lakeba-backups]: " CONTAINER
CONTAINER="${CONTAINER:-lakeba-backups}"
[[ -n "$ACCOUNT" && -n "$KEY" ]] || { echo "The account name and key are needed. Nothing changed."; exit 1; }
export RCLONE_CONFIG_AZ_TYPE=azureblob RCLONE_CONFIG_AZ_ACCOUNT="$ACCOUNT" RCLONE_CONFIG_AZ_KEY="$KEY"
rclone lsf "az:$CONTAINER" --max-depth 1 >/dev/null || { echo "Azure didn't accept that key, or container $CONTAINER doesn't exist. Nothing changed."; exit 1; }
echo "Azure accepted the key."

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
printf 'AZ_ACCOUNT=%q\nAZ_KEY=%q\nAZ_CONTAINER=%q\nREMOTE_KEEP_DAYS=35\n' "$ACCOUNT" "$KEY" "$CONTAINER" > "$CONF/offsite.env"
unset KEY

echo "Running a backup now with the off-server copy…"
/usr/local/bin/lakeba-backup
latest="$(rclone lsf "az:$CONTAINER/lakeba" | sort | tail -1)"
tmp="$(mktemp -d)"
rclone copyto "az:$CONTAINER/lakeba/$latest" "$tmp/b.gpg"
gpg --batch --quiet --decrypt --passphrase-file "$CONF/passphrase" "$tmp/b.gpg" | tar -C "$tmp" -xf -
( cd "$tmp"/*/ && sha256sum --quiet -c SHA256SUMS ) && echo "Test restore of $latest from Azure: OK (decrypted, checksums match)."
rm -rf "$tmp"

#!/usr/bin/env bash
# Nightly backup of the portal's data on this server (run by
# lakeba-backup.timer): the whole Supabase database (custom format), the
# stored document files, and Supabase's settings and secrets (needed to
# restore). Kept in /var/backups/lakeba for 14 days, root-only.
# Off-server copy: when /etc/lakeba-backup/offsite.env exists (set up by
# lakeba-set-offsite-backup), each backup is encrypted on this server (GnuPG,
# AES-256, passphrase kept root-only here and by you in a password manager)
# and copied to Azure Blob Storage (Australia East); copies older than
# REMOTE_KEEP_DAYS are deleted there.
set -euo pipefail
DEST=/var/backups/lakeba
KEEP_DAYS=14
stamp="$(date -u +%Y%m%d-%H%M%S)"
dir="$DEST/$stamp"
umask 077
install -d -m 700 "$DEST" "$dir"

docker exec supabase-db pg_dump -U supabase_admin -d postgres -Fc > "$dir/database.dump"
tar -C /opt/supabase/volumes -czf "$dir/storage.tgz" storage
tar -C /opt/supabase -czf "$dir/supabase-config.tgz" .env docker-compose.lakeba.yml .supabase-version
cp /etc/lakeba-portal/portal.env "$dir/portal.env"
( cd "$dir" && sha256sum database.dump storage.tgz supabase-config.tgz portal.env > SHA256SUMS )

# The dump must be readable, or it isn't a backup.
docker exec -i supabase-db pg_restore --list < "$dir/database.dump" > /dev/null

find "$DEST" -mindepth 1 -maxdepth 1 -type d -mtime +"$KEEP_DAYS" -exec rm -rf {} +
echo "Backup $stamp: $(du -sh "$dir" | cut -f1)"

OFFSITE=/etc/lakeba-backup/offsite.env
if [[ -f "$OFFSITE" ]]; then
  # shellcheck disable=SC1090
  source "$OFFSITE"
  export RCLONE_CONFIG_AZ_TYPE=azureblob RCLONE_CONFIG_AZ_ACCOUNT="$AZ_ACCOUNT" RCLONE_CONFIG_AZ_KEY="$AZ_KEY"
  enc="$(mktemp -p /var/tmp lakeba-backup.XXXXXX)"
  tar -C "$DEST" -cf - "$stamp" | gpg --batch --yes --symmetric --cipher-algo AES256 --passphrase-file /etc/lakeba-backup/passphrase -o "$enc"
  rclone copyto "$enc" "az:$AZ_CONTAINER/lakeba/$stamp.tar.gpg"
  rm -f "$enc"
  rclone delete "az:$AZ_CONTAINER/lakeba" --min-age "${REMOTE_KEEP_DAYS:-35}d"
  echo "Off-server copy: az:$AZ_CONTAINER/lakeba/$stamp.tar.gpg"
fi

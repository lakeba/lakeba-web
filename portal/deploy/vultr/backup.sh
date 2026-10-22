#!/usr/bin/env bash
# Nightly backup of the portal's data on this server (run by
# lakeba-backup.timer): the whole Supabase database (custom format), the
# stored document files, and Supabase's settings and secrets (needed to
# restore). Kept in /var/backups/lakeba for 14 days, root-only.
# Off-server copies: see BACKUP_REMOTE below (set when a destination exists).
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

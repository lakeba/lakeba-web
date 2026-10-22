#!/usr/bin/env bash
# Applies the portal's database migrations to the self-hosted Supabase on this
# server, in order, each in one transaction, and records them in
# supabase_migrations.schema_migrations (as the Supabase CLI does), so each
# runs once. Usage, as root on the server:
#   bash migrate.sh /path/to/portal/supabase/migrations
set -euo pipefail
DIR="${1:?migrations folder}"
psql() { docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -X -q -U postgres -d postgres "$@"; }

psql <<'SQL'
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);
SQL

applied="$(psql -At -c 'select version from supabase_migrations.schema_migrations')"
count=0
for f in "$DIR"/*.sql; do
  base="$(basename "$f" .sql)"; version="${base%%_*}"; name="${base#*_}"
  grep -qx "$version" <<<"$applied" && continue
  echo "Applying $base"
  { echo 'begin;'; cat "$f"; echo; echo "insert into supabase_migrations.schema_migrations (version, name) values ('$version', '$name');"; echo 'commit;'; } | psql
  count=$((count + 1))
done
echo "$count migration(s) applied."

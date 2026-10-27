#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
backup_dir=${1:?Uso: scripts/restore.sh backups/FECHA --replace-data}
if [[ ${2:-} != --replace-data ]]; then
    echo 'La restauración reemplaza la base actual. Agregá --replace-data para continuar.' >&2
    exit 1
fi
test -s "$backup_dir/database.dump"
test -s "$backup_dir/uploads.tar.gz"
docker compose stop app
# On failure leave the app stopped for inspection.
docker compose exec -T db sh -c 'pg_restore --clean --if-exists --no-owner --no-acl -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$backup_dir/database.dump"
docker compose run --rm --no-deps -T --user root --entrypoint sh app -c 'find /app/static/uploads -type f -delete; tar -xzf - -C /app/static/uploads; chown -R bun:bun /app/static/uploads' < "$backup_dir/uploads.tar.gz"
docker compose start app

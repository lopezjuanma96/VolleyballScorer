#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
stamp=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p backups
backup_dir=$(mktemp -d "backups/$stamp-XXXXXX")
app_was_running=$(docker compose ps --status running --services app)
# Stop writes so SQL and logos represent the same point in time.
docker compose stop app
trap 'if [[ $app_was_running == app ]]; then docker compose start app >/dev/null; fi' EXIT
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$backup_dir/database.dump"
docker compose run --rm --no-deps -T --user root --entrypoint tar app -C /app/static/uploads -czf - . > "$backup_dir/uploads.tar.gz"
printf '%s\n' "Backup creado en $backup_dir. Copialo fuera de este servidor."

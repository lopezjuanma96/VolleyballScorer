#!/usr/bin/env bash
# Deploys one commit of main on this server. GitHub Actions calls it over SSH:
#   deploy.sh <sha>   (or, with a forced command in authorized_keys, via SSH_ORIGINAL_COMMAND)
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.bun/bin:$PATH"
sha=${1:-${SSH_ORIGINAL_COMMAND:-}}
sha=${sha##* }
[[ $sha =~ ^[0-9a-f]{40}$ ]] || { echo "Uso: deploy.sh <sha de 40 caracteres>" >&2; exit 2; }
exec 9>/tmp/volleyball-deploy.lock
flock -n 9 || { echo "Ya hay un despliegue en curso." >&2; exit 1; }

git fetch --quiet origin main
git merge-base --is-ancestor "$sha" origin/main || { echo "$sha no pertenece a origin/main." >&2; exit 1; }
# Backup before migrations; the app pauses a few seconds while it runs.
if docker compose ps --status running --services | grep -qx app; then scripts/backup.sh; fi
git checkout --quiet --detach "$sha"
scripts/stack.sh up -d --build --remove-orphans

status=starting
for _ in $(seq 1 45); do
    status=$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q app)" 2>/dev/null || echo missing)
    [[ $status == healthy ]] && break
    sleep 4
done
if [[ $status != healthy ]]; then
    docker compose logs --tail 80 app >&2
    echo "La app no quedó saludable ($status). El backup previo está en backups/." >&2
    exit 1
fi
docker image prune -f >/dev/null
echo "Desplegado $(git rev-parse --short HEAD)."

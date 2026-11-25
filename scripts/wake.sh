#!/usr/bin/env bash
# Wakes up an install that scripts/hibernate.sh put to sleep. On the VPS, as deploy,
# with the commit to run checked out (usually origin/main):  scripts/wake.sh --yes
#   1. Builds and starts the stack (migrations run at start-up) and waits for healthy.
#   2. Puts back the GitHub Actions deploy key and the cron lines that hibernate
#      saved in ~/hibernate/<folder>/, without duplicating lines already there.
# Then, outside the VPS: the site in vps-ops and DEPLOY_ENABLED=true
# (docs/operations.md#apagar-y-reactivar).
set -euo pipefail
cd "$(dirname "$0")/.."
here=$PWD
folder=$(basename "$here")
saved="$HOME/hibernate/$folder"
keys="$HOME/.ssh/authorized_keys"

if [[ ${1:-} != --yes ]]; then
    echo "Levanta la app de $here (build, migraciones) y devuelve la clave de despliegue y el cron" >&2
    echo "guardados en $saved. Agregá --yes para continuar." >&2
    exit 1
fi

scripts/stack.sh up -d --build --remove-orphans
status=starting
for _ in $(seq 1 45); do
    status=$(docker inspect -f '{{.State.Health.Status}}' "$(scripts/stack.sh ps -q app)" 2> /dev/null || echo missing)
    [[ $status == healthy ]] && break
    sleep 4
done
if [[ $status != healthy ]]; then
    scripts/stack.sh logs --tail 80 app >&2
    echo "La app no quedó saludable ($status). La clave y el cron siguen guardados en $saved." >&2
    exit 1
fi

if [[ -s $saved/authorized_keys ]]; then
    touch "$keys" && chmod 600 "$keys"
    while IFS= read -r line; do
        if [[ -n $line ]] && ! grep -qxF "$line" "$keys"; then printf '%s\n' "$line" >> "$keys"; fi
    done < "$saved/authorized_keys"
    rm "$saved/authorized_keys"
    echo "Clave de despliegue de GitHub restaurada."
fi
if [[ -s $saved/crontab ]]; then
    current=$(crontab -l 2> /dev/null || true)
    {
        if [[ -n $current ]]; then printf '%s\n' "$current"; fi
        grep -vxF -f <(printf '%s\n' "$current") "$saved/crontab" || true
    } | crontab -
    rm "$saved/crontab"
    echo "Cron restaurado."
fi
rmdir "$saved" 2> /dev/null || true
docker image prune -f > /dev/null

cat << EOF2

Listo: $folder funciona otra vez ($(git rev-parse --short HEAD)).
Falta, fuera de la VPS:
- vps-ops: devolver conf/sites/voley.caddy al reverse_proxy (revert del commit que lo apagó).
- GitHub: gh variable set DEPLOY_ENABLED --body true
EOF2

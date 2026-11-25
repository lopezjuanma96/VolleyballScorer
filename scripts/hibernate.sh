#!/usr/bin/env bash
# Puts this install to sleep on its server, keeping what is needed to wake it up.
# On the VPS, as deploy:  scripts/hibernate.sh --yes
#   1. Final backup (database + logos) in backups/, checked to be readable.
#   2. Removes the containers and the locally built image. The volumes (database,
#      logos), .env and this folder stay, so waking up is one "stack.sh up".
#   3. Disables what would start the app again on its own: the forced-command key
#      GitHub Actions deploys with, and cron lines that mention this folder. The
#      removed lines are kept in ~/hibernate/<folder>/ to put them back.
#   4. When the shared edge Caddy is in use, deletes the volumes of the bundled
#      Caddy left over from cloud mode (edge has its own certificates).
# Waking up again, or deleting everything: docs/operations.md#apagar-y-reactivar
set -euo pipefail
cd "$(dirname "$0")/.."
here=$PWD
folder=$(basename "$here")
saved="$HOME/hibernate/$folder"
keys="$HOME/.ssh/authorized_keys"

if [[ ${1:-} != --yes ]]; then
    echo "Apaga la app de $here: backup final, borra contenedores e imagen (conserva volúmenes y .env)" >&2
    echo "y desactiva la clave de despliegue de GitHub y el cron. Agregá --yes para continuar." >&2
    exit 1
fi
project=$(scripts/stack.sh config 2>/dev/null | sed -n 's/^name: //p' | head -1)
[[ -n $project ]] || { echo "No pude leer la configuración de Compose (¿falta .env?)." >&2; exit 1; }
umask 077
mkdir -p "$saved"

# 1. Backup. pg_dump needs the database up; "up db" does nothing if it already is.
scripts/stack.sh up -d db
scripts/backup.sh
latest=$(find backups -mindepth 1 -maxdepth 1 -type d | sort | tail -1)
[[ -s $latest/database.dump && -s $latest/uploads.tar.gz ]] \
    || { echo "El backup $latest está incompleto; no apagué nada." >&2; exit 1; }
scripts/stack.sh exec -T db pg_restore --list < "$latest/database.dump" > /dev/null \
    || { echo "El dump de $latest no se puede leer; no apagué nada." >&2; exit 1; }
tar -tzf "$latest/uploads.tar.gz" > /dev/null \
    || { echo "Los logos de $latest no se pueden leer; no apagué nada." >&2; exit 1; }

# 2. Containers and the image built here go; named volumes stay (no -v).
scripts/stack.sh down --rmi local --remove-orphans

# 3a. The GitHub Actions key: its forced command is this folder's deploy.sh.
deploy_cmd="$here/scripts/deploy.sh\""
if [[ -f $keys ]] && grep -qF "$deploy_cmd" "$keys"; then
    remaining=$(grep -vF "$deploy_cmd" "$keys" || true)
    # Never leave the file without a key that opens a shell (yours, with no command=).
    grep -qE '^(ssh-|ecdsa-|sk-)' <<< "$remaining" \
        || { echo "Sin esa línea, authorized_keys quedaría sin tu clave personal; no lo toqué." >&2; exit 1; }
    grep -F "$deploy_cmd" "$keys" >> "$saved/authorized_keys"
    printf '%s\n' "$remaining" > "$keys"   # same file, so owner and mode 600 stay
    echo "Clave de despliegue de GitHub desactivada (guardada en $saved/authorized_keys)."
fi

# 3b. Cron lines that run something from this folder (backups, for example).
if current=$(crontab -l 2> /dev/null) && grep -qF -e "$here" -e "~/$folder" <<< "$current"; then
    grep -F -e "$here" -e "~/$folder" <<< "$current" >> "$saved/crontab"
    { grep -vF -e "$here" -e "~/$folder" <<< "$current" || true; } | crontab -
    echo "Cron desactivado (guardado en $saved/crontab)."
fi

# 4. Leftovers of cloud mode's own Caddy, only when edge runs the certificates now.
if docker volume inspect edge_caddy_data > /dev/null 2>&1; then
    for volume in "${project}_caddy_data" "${project}_caddy_config"; do
        if docker volume inspect "$volume" > /dev/null 2>&1; then docker volume rm "$volume" > /dev/null && echo "Volumen viejo $volume borrado."; fi
    done
fi

ip=$({ hostname -I 2> /dev/null || true; } | awk '{print $1}')
cat << EOF

Listo: $folder está apagado.
- Se conservan los volúmenes (base y logos), .env y $here.
- Backup final: $here/$latest
  Copialo fuera de la VPS, desde tu computadora:
    scp -r deploy@${ip:-IP-DE-LA-VPS}:$here/$latest ~/Backups/$folder/
- Para reactivar: docs/operations.md#apagar-y-reactivar
EOF

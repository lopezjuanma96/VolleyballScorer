# Puesta en marcha en Hostinger

Guía para hacer una sola vez. Resultado: VPS con Docker, app + PostgreSQL + Caddy (HTTPS automático), despliegue automático desde GitHub después de que pasa CI, y backups fuera del servidor. Escrita el 29/10/2026; verificá precios y pantallas de hPanel al momento de comprar.

Lo que hacés vos: comprar, crear credenciales, cargar secretos. Lo que puede hacer Claude con el conector de Hostinger: revisar el estado de la VPS, firewall, snapshots y métricas, y ayudarte a diagnosticar. Nunca se contratan servicios sin un pedido explícito.

## 1. Comprar y elegir sistema

1. Plan **KVM 1** (1 vCPU, 4 GB RAM) alcanza para el torneo según la [prueba de carga](load-testing.md); KVM 2 si vas a alojar otros proyectos. Revisá total y precio de renovación ([comparación](hosting.md)).
2. Ubicación: la más cercana a Córdoba que ofrezca el plan (São Paulo, si está disponible).
3. Sistema: plantilla **Ubuntu 24.04 with Docker**.
4. En el asistente cargá tu **clave SSH pública** (si no tenés: `ssh-keygen -t ed25519 -C "tu-mail"` en tu computadora y copiá `~/.ssh/id_ed25519.pub`). Poné igual una contraseña root larga; no la vas a usar para entrar.
5. Anotá la IP pública.

## 2. Conectar Hostinger con Claude Code (opcional, recomendado)

Opción simple, sin tokens en archivos (OAuth en el navegador):

```bash
claude mcp add --transport http hostinger https://mcp.hostinger.com
```

Alternativa: hPanel → Integraciones → «Hostinger Connector». Si preferís el servidor local, hace falta Node 24+, `npm install -g @hostinger/mcp` y un token de API de hPanel con vencimiento corto en la variable `API_TOKEN` (nunca en el repo). Después de conectarlo, pedime «revisá la VPS» y verifico estado, firewall y recursos.

## 3. Preparar el servidor

Entrá como root una sola vez y creá el usuario que va a operar la app:

```bash
ssh root@IP
adduser --disabled-password --gecos "" deploy
usermod -aG docker deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
cp ~/.ssh/authorized_keys /home/deploy/.ssh/ && chown deploy:deploy /home/deploy/.ssh/authorized_keys
# Actualizaciones de seguridad automáticas y firewall.
apt update && apt -y upgrade && apt -y install unattended-upgrades ufw git
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable
```

Probá en otra terminal que `ssh deploy@IP` funciona **antes** de cerrar el acceso por contraseña y de root:

```bash
sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/; s/^#\?PermitRootLogin .*/PermitRootLogin no/' /etc/ssh/sshd_config
systemctl reload ssh
```

En hPanel → VPS → Firewall, replicá las mismas reglas (22, 80, 443). Docker publica puertos por fuera de UFW: el Compose sólo expone 80/443 (Caddy) y la app queda en `127.0.0.1:3000`; no cambies `APP_BIND`.

## 4. Dominio

En tu proveedor DNS creá un registro **A** `voley.tudominio.com → IP` (y AAAA si la VPS tiene IPv6). Esperá a que `dig +short voley.tudominio.com` devuelva la IP; Caddy necesita eso para emitir el certificado.

## 5. Instalar la app

Como `deploy`:

```bash
ssh deploy@IP
curl -fsSL https://bun.sh/install | bash -s "bun-v1.4.0"
exec $SHELL -l
git clone https://github.com/lopezjuanma96/VolleyballScorer.git ~/volleyball-scorer
cd ~/volleyball-scorer
bun scripts/setup.ts          # genera .env con secretos aleatorios (no los imprime)
nano .env                     # DEPLOY_MODE=cloud, PUBLIC_URL=https://voley.tudominio.com, DOMAIN=voley.tudominio.com
scripts/stack.sh up -d --build
curl -fsS https://voley.tudominio.com/healthz
```

Entrá a `https://voley.tudominio.com/manager/` con `manager` y la contraseña de `MANAGER_PASSWORD` (`grep MANAGER_PASSWORD .env`, sólo en tu terminal). Desde **Usuarios** creá una cuenta de Organización para cada admin y una de Planillero por cancha o persona; el usuario `manager` queda como acceso de emergencia.

Si migrás datos desde tu instalación local: hacé `scripts/backup.sh` en local, copiá la carpeta con `scp -r backups/<fecha> deploy@IP:~/volleyball-scorer/backups/` y seguí [restauración](operations.md#backup-y-restauración).

## 6. Despliegue automático desde GitHub

El flujo `.github/workflows/deploy.yml` corre cuando **Check** termina bien en un push a `main` (o a mano desde Actions). Entra por SSH con una clave que sólo puede ejecutar `scripts/deploy.sh`: backup, checkout del commit probado, build, migraciones y espera a que la app esté saludable.

1. En tu computadora, una clave exclusiva para despliegues (sin passphrase):
   ```bash
   ssh-keygen -t ed25519 -N "" -C "github-deploy" -f ./github-deploy
   ```
2. En la VPS, como `deploy`, agregá la pública a `~/.ssh/authorized_keys` en **una línea** con comando forzado:
   ```
   command="/home/deploy/volleyball-scorer/scripts/deploy.sh",no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty ssh-ed25519 AAAA… github-deploy
   ```
3. En GitHub → Settings → Environments, creá `production` (podés exigir aprobación manual). Cargá:
   - Secrets: `DEPLOY_SSH_KEY` = contenido de `./github-deploy` (privada). `DEPLOY_KNOWN_HOSTS` = salida de `ssh-keyscan -t ed25519 IP`.
   - Variables: `DEPLOY_HOST` = IP, `DEPLOY_USER` = `deploy`, `PUBLIC_URL` = `https://voley.tudominio.com`.
   - Variable de repositorio (Settings → Variables → Actions): `DEPLOY_ENABLED` = `true`.
4. Borrá `./github-deploy` de tu computadora. Probá con Actions → Deploy → Run workflow.

Un deploy pausa la app unos segundos (backup y reinicio). El día del torneo no hagas merges a `main`, o quitá `DEPLOY_ENABLED` hasta terminar.

## 7. Backups fuera de la VPS

Un volumen o snapshot en la misma VPS no reemplaza una copia externa.

- Activá los backups semanales de Hostinger y tomá un snapshot manual antes del torneo.
- Diario, con cron de `deploy` (`crontab -e`), y copia a otro lugar con [rclone](https://rclone.org/) (Google Drive, Backblaze B2, etc.) configurado con `rclone config`:
  ```
  30 4 * * * cd ~/volleyball-scorer && scripts/backup.sh >/dev/null && rclone copy backups remoto:voley-backups --max-age 2d
  ```
- Ensayá una restauración completa en local al menos una vez ([cómo](operations.md#backup-y-restauración)).

## 8. Antes del torneo

- Repetí la [prueba de carga](load-testing.md) contra la VPS (desde tu computadora, no desde la VPS).
- Probá anotar desde la sede con los celulares y la red reales.
- Snapshot manual, `DEPLOY_ENABLED` en `false` y backups verificados.

# Puesta en marcha en Hostinger

Guía para hacer una sola vez. Resultado: VPS con Docker, app + PostgreSQL + Caddy (HTTPS automático), despliegue automático desde GitHub después de que pasa CI, y backups fuera del servidor. Escrita el 29/10/2026; verificá precios y pantallas de hPanel al momento de comprar.

**Estado actual (25/11/2026):** apagada después del torneo, lista para reactivar ([cómo](operations.md#apagar-y-reactivar)). Estuvo en <https://voley.zagador123.cloud> del 02/11 al 25/11/2026 con despliegue automático, ingreso con Google y, desde el 19/11, en `DEPLOY_MODE=edge` detrás del Caddy compartido. Donde esta guía dice `voley.tudominio.com`, en producción es `voley.zagador123.cloud`.

Lo que hacés vos: comprar, crear credenciales, cargar secretos. Lo que puede hacer Claude: revisar la VPS con el conector de Hostinger (estado, firewall, snapshots, métricas) y con el acceso restringido que describe vps-edge (`docs/access.md`), y ayudarte a diagnosticar. Nunca se contratan servicios sin un pedido explícito.

## 1–4. Servidor, acceso y dominio

Comprar la VPS, el usuario `deploy`, el endurecimiento de SSH, los dos firewalls (UFW y hPanel), el conector de Hostinger para Claude Code, el DNS y el Caddy compartido son de la VPS, no de esta app. Por eso viven en el repositorio privado [vps-edge](https://github.com/lopezjuanma96/vps-edge) (`docs/server.md` y `docs/access.md`), junto con lo aprendido en esta VPS (`docs/lessons.md`).

Lo que esta app necesita del servidor: Docker con Compose, el usuario `deploy` en el grupo `docker`, 80/443 abiertos, un registro **A** (y AAAA) `voley.tudominio.com → IP` y, en una VPS con varias apps, la red `edge` con su sitio en vps-edge ([§10](#edge)). La app nunca publica más que `127.0.0.1:3000`; no cambies `APP_BIND`.

## 5. Instalar la app

Como `deploy`:

```bash
# Entrar como deploy (ya no como root).
ssh deploy@IP

# Instalar Bun (el runtime de JavaScript del proyecto) en ~/.bun, fijando la versión para
# que coincida con la que usa el proyecto. Sólo se usa para los scripts de ayuda;
# la app en sí corre dentro de Docker.
curl -fsSL https://bun.sh/install | bash -s "bun-v1.4.0"

# Reiniciar la shell como "login shell" para que tome el PATH nuevo y encuentre "bun".
exec $SHELL -l

# Descargar el código en ~/volleyball-scorer y entrar a la carpeta.
git clone https://github.com/lopezjuanma96/VolleyballScorer.git ~/volleyball-scorer
cd ~/volleyball-scorer

bun scripts/setup.ts          # genera .env con secretos aleatorios (no los imprime)

# Editar la configuración (Ctrl+O guarda, Ctrl+X sale):
#   DEPLOY_MODE=cloud: levanta Caddy (HTTPS) en lugar de ngrok.
#   DOMAIN: el nombre al que Caddy responde y para el que pide el certificado.
#   PUBLIC_URL: la dirección pública completa. La app sólo acepta formularios y escrituras
#     que vengan de ese origen (protección CSRF). Su host tiene que ser igual a DOMAIN.
nano .env                     # DEPLOY_MODE=cloud, PUBLIC_URL=https://voley.tudominio.com, DOMAIN=voley.tudominio.com

# Construir las imágenes y levantar todo (app, PostgreSQL, Caddy) en segundo plano (-d).
# stack.sh es un envoltorio de "docker compose": lee DEPLOY_MODE de .env, revisa que
# PUBLIC_URL y DOMAIN estén bien y activa los servicios de ese modo (en cloud, Caddy).
# La primera vez tarda unos minutos y Caddy pide el certificado HTTPS.
scripts/stack.sh up -d --build

# Probar desde afuera que la app responde por HTTPS. -f falla si el código no es 2xx,
# -sS no muestra la barra de progreso pero sí los errores.
curl -fsS https://voley.tudominio.com/healthz
```

Entrá a `https://voley.tudominio.com/manager_login` (ninguna página la enlaza; escribila a mano) con `manager` y la contraseña de `MANAGER_PASSWORD` (`grep MANAGER_PASSWORD .env`, sólo en tu terminal). Configurá el [ingreso con Google](#google) y después, desde **Usuarios**, cargá el email de Google de cada persona con su rol (Organización o Planillero). Sólo `manager` puede gestionar usuarios.

Si migrás datos desde tu instalación local: hacé `scripts/backup.sh` en local, copiá la carpeta con `scp -r backups/<fecha> deploy@IP:~/volleyball-scorer/backups/` y seguí [restauración](operations.md#backup-y-restauración).

## 6. Despliegue automático desde GitHub

El flujo `.github/workflows/deploy.yml` corre cuando **Check** termina bien en un push a `main` (o a mano desde Actions). Entra por SSH con una clave que sólo puede ejecutar `scripts/deploy.sh`: backup, checkout del commit probado, build, migraciones y espera a que la app esté saludable.

1. En tu computadora, una clave exclusiva para despliegues (sin passphrase):
   ```bash
   # -t ed25519: tipo de clave moderno, corto y seguro.
   # -N "": sin passphrase, porque GitHub Actions la usa sin nadie que la escriba.
   # -C: comentario para reconocerla en authorized_keys.
   # -f: crea ./github-deploy (privada, va a GitHub) y ./github-deploy.pub (pública, va a la VPS).
   ssh-keygen -t ed25519 -N "" -C "github-deploy" -f ./github-deploy
   ```
2. En la VPS, como `deploy`, agregá la pública a `~/.ssh/authorized_keys` en **una línea** con comando forzado:
   ```
   # Clave de GitHub Actions. Aunque alguien la robe, sólo puede desplegar:
   #   command="…": cualquier comando que pida esta clave se reemplaza por deploy.sh.
   #   no-port-forwarding, no-agent-forwarding, no-X11-forwarding: no puede usar el servidor
   #     como túnel hacia otros lugares ni reenviar claves o ventanas.
   #   no-pty: no obtiene una terminal interactiva.
   command="/home/deploy/volleyball-scorer/scripts/deploy.sh",no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty ssh-ed25519 AAAA… github-deploy
   ```

   Las líneas que empiezan con `#` son comentarios válidos en `authorized_keys`; la clave en sí tiene que quedar en una sola línea.
3. En GitHub → Settings → Environments, creá `production` (podés exigir aprobación manual). Cargá:
   - Secrets: `DEPLOY_SSH_KEY` = contenido de `./github-deploy` (privada). `DEPLOY_KNOWN_HOSTS` = salida de `ssh-keyscan -t ed25519 IP`.
   - Variables: `DEPLOY_HOST` = IP, `DEPLOY_USER` = `deploy`, `PUBLIC_URL` = `https://voley.tudominio.com`.
   - Variable de repositorio (Settings → Variables → Actions): `DEPLOY_ENABLED` = `true`.
4. Borrá `./github-deploy` de tu computadora. Probá con Actions → Deploy → Run workflow.

Un deploy pausa la app unos segundos (backup y reinicio). El día del torneo no hagas merges a `main`, o quitá `DEPLOY_ENABLED` hasta terminar.

## 7. Backups fuera de la VPS

Un volumen o snapshot en la misma VPS no reemplaza una copia externa.

- Activá los backups semanales de Hostinger y tomá un snapshot manual antes del torneo.
- Diario, con cron de `deploy` (`crontab -e`), y copia a otro lugar con [rclone](https://rclone.org/) (Google Drive, Backblaze B2, etc.; se instala con `sudo apt install rclone`) configurado con `rclone config`:
  ```
  # Formato de cron: minuto hora día-del-mes mes día-de-la-semana comando.
  # "30 4 * * *" = todos los días a las 04:30 (hora del servidor).
  #   scripts/backup.sh: pausa la app unos segundos, vuelca la base y los logos subidos
  #     a backups/<fecha>-… y vuelve a arrancarla (>/dev/null descarta el mensaje de éxito).
  #     Los errores no se avisan solos: revisá cada tanto que haya carpetas nuevas.
  #   rclone copy … --max-age 2d: sube a la nube sólo lo de los últimos 2 días, sin borrar
  #     nada del destino. "remoto" es el nombre que le pusiste en "rclone config".
  # Cada && hace que el paso siguiente corra sólo si el anterior salió bien.
  30 4 * * * cd ~/volleyball-scorer && scripts/backup.sh >/dev/null && rclone copy backups remoto:voley-backups --max-age 2d
  ```
- Ensayá una restauración completa en local al menos una vez ([cómo](operations.md#backup-y-restauración)).

## 8. Antes del torneo

- Repetí la [prueba de carga](load-testing.md) contra la VPS (desde tu computadora, no desde la VPS).
- Probá anotar desde la sede con los celulares y la red reales.
- Snapshot manual, `DEPLOY_ENABLED` en `false` y backups verificados.

<a id="google"></a>
## 9. Ingreso con Google

Organización y planilleros entran con su cuenta de Google; no hay contraseñas que repartir. Es gratis y no requiere verificación de Google porque sólo se piden nombre y email.

1. Entrá a <https://console.cloud.google.com/> con tu cuenta y creá un proyecto (por ejemplo «Voley»).
2. **Google Auth Platform → Branding** (antes «Pantalla de consentimiento OAuth»): nombre de la app, email de soporte, página principal `https://voley.zagador123.cloud` y política de privacidad `https://voley.zagador123.cloud/privacy_policy` (todas las páginas públicas la enlazan al pie). Tipo de usuario **Externo**. Opcional: `CONTACT_EMAIL=…` en el `.env` para que la política muestre a quién escribir.
3. **Audience**: tocá **Publish app** para pasarla a «In production». En modo «Testing» sólo entran los usuarios de prueba y las sesiones de Google vencen a los 7 días.
4. **Clients → Create client**: tipo **Web application**.
   - Authorized JavaScript origins: `https://voley.zagador123.cloud`
   - Authorized redirect URIs: `https://voley.zagador123.cloud/api/auth/google/callback`
   - Para probar en local, agregá también `http://localhost:3000` y `http://localhost:3000/api/auth/google/callback`.
5. Copiá el Client ID y el Client secret. En la VPS, como `deploy`:
   ```bash
   cd ~/volleyball-scorer
   # Agrega (o completa) estas dos líneas en .env. El secret no va nunca al repositorio.
   nano .env        # GOOGLE_CLIENT_ID=…apps.googleusercontent.com y GOOGLE_CLIENT_SECRET=…
   # Recrea sólo la app para que lea el .env nuevo (no hace falta rebuild).
   scripts/stack.sh up -d --force-recreate app
   ```
6. Entrá por `/manager_login`, abrí **Usuarios** y cargá los emails. Probá con uno de ellos en `/login.html` → «Ingresar con Google», y con otro email que no esté para ver «No sos parte de la organización».

Orden al desplegar este cambio: cargá primero las variables en el `.env` de la VPS (el código viejo las ignora) y después hacé el merge. La migración `0005_google_members` desactiva las cuentas con contraseña existentes; aparecen en **Usuarios** como «Sin email» para cargarles el email o eliminarlas.

Si Google no está configurado, el botón muestra «El ingreso con Google todavía no está configurado» y sólo entra `manager`.

<a id="edge"></a>
## 10. Otra app en la misma VPS (modo edge)

En `cloud` el Caddy que publica 80/443 está dentro de este stack, así que ninguna otra app de la VPS puede usar HTTPS. Para alojar más de una (por ejemplo `metamorfosis.zagador123.cloud`), el proxy sale a un stack aparte y compartido: el repositorio [vps-edge](https://github.com/lopezjuanma96/vps-edge), clonado en `~/edge` como `deploy`. Ese Caddy reparte cada dominio por la red Docker `edge`, y el vóley pasa a `DEPLOY_MODE=edge`: app + PostgreSQL sin Caddy propio, unidos a esa red con el nombre `voley` ([detalles](operations.md#edge-caddy-compartido-en-vps)).

```bash
# Una sola vez por VPS: la red por la que el Caddy compartido llega a cada app.
docker network create edge
```

La VPS de Hostinger pasó a edge el 19/11/2026. El orden completo (red, copiar los certificados, corte de segundos y vuelta atrás) quedó en vps-edge (`docs/caddy.md`, «Migración desde un Caddy propio»), para rehacerlo en otra VPS. Hacelo fuera de días de torneo. El despliegue automático no cambia, porque `scripts/deploy.sh` lee el modo del `.env`. Los dominios se agregan en vps-edge, no acá.

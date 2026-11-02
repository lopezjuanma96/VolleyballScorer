# Puesta en marcha en Hostinger

Guía para hacer una sola vez. Resultado: VPS con Docker, app + PostgreSQL + Caddy (HTTPS automático), despliegue automático desde GitHub después de que pasa CI, y backups fuera del servidor. Escrita el 29/10/2026; verificá precios y pantallas de hPanel al momento de comprar.

**Estado actual (02/11/2026):** hecho. La app está en <https://voley.zagador123.cloud> (registro A apuntando a la VPS de Hostinger) y el despliegue automático está activo (`DEPLOY_ENABLED=true`): cada merge a `main` que pasa **Check** se publica solo. Donde esta guía dice `voley.tudominio.com`, en producción es `voley.zagador123.cloud`. Pendiente: [ingreso con Google](#google).

Lo que hacés vos: comprar, crear credenciales, cargar secretos. Lo que puede hacer Claude con el conector de Hostinger: revisar el estado de la VPS, firewall, snapshots y métricas, y ayudarte a diagnosticar. Nunca se contratan servicios sin un pedido explícito.

## 1. Comprar y elegir sistema

1. Plan **KVM 1** (1 vCPU, 4 GB RAM) alcanza para el torneo según la [prueba de carga](load-testing.md); KVM 2 si vas a alojar otros proyectos. Revisá total y precio de renovación ([comparación](hosting.md)).
2. Ubicación: la más cercana a Córdoba que ofrezca el plan (São Paulo, si está disponible).
3. Sistema: plantilla **Ubuntu 24.04 with Docker** (en hPanel suele estar en la pestaña de aplicaciones, no en la de sistemas operativos; soporte hasta 2029). Alternativa válida: **Ubuntu 26.04** plano (soporte hasta 2031) e instalar Docker a mano, ver abajo. Todo corre en contenedores, así que la versión de Ubuntu casi no cambia nada.
4. En el asistente cargá tu **clave SSH pública** (si no tenés: `ssh-keygen -t ed25519 -C "tu-mail"` en tu computadora y copiá `~/.ssh/id_ed25519.pub`). Poné igual una contraseña root larga; no la vas a usar para entrar.
5. Anotá la IP pública.

## 2. Conectar Hostinger con Claude Code (opcional, recomendado)

Opción simple, sin tokens en archivos (OAuth en el navegador):

```bash
# Registra el servidor MCP remoto de Hostinger en Claude Code. La primera vez que se usa
# abre el navegador para autorizar (OAuth), así que no queda ningún token guardado en archivos.
claude mcp add --transport http hostinger https://mcp.hostinger.com
```

Alternativa: hPanel → Integraciones → «Hostinger Connector». Si preferís el servidor local, hace falta Node 24+, `npm install -g @hostinger/mcp` y un token de API de hPanel con vencimiento corto en la variable `API_TOKEN` (nunca en el repo). Después de conectarlo, pedime «revisá la VPS» y verifico estado, firewall y recursos.

## 3. Preparar el servidor

Entrá como root una sola vez y creá el usuario que va a operar la app:

```bash
# Conectarse a la VPS como root usando tu clave SSH (la que cargaste en el asistente).
ssh root@IP

# Sólo si elegiste Ubuntu plano (sin la plantilla de Docker): el script oficial de Docker
# agrega su repositorio de paquetes e instala Docker Engine y el plugin de Compose.
#   curl -fsSL https://get.docker.com | sh
docker compose version        # comprueba que Docker y Compose estén instalados; tiene que responder

# Crear el usuario "deploy", que va a operar la app. Trabajar como root todos los días es
# riesgoso: un error o un acceso robado tiene control total del servidor.
#   --disabled-password: el usuario no tiene contraseña; sólo puede entrar con clave SSH.
#   --gecos "": salta las preguntas de nombre completo, teléfono, etc.
adduser --disabled-password --gecos "" deploy

# Agregarlo al grupo "docker" para que pueda manejar contenedores sin sudo.
# (Ojo: el grupo docker equivale en la práctica a root; por eso sólo lo tiene este usuario.)
usermod -aG docker deploy

# Darle sudo para tareas de administración (instalar paquetes, reiniciar), porque después
# del endurecimiento root ya no puede entrar por SSH. La contraseña sólo sirve para sudo:
# SSH no acepta contraseñas. Guardala en tu gestor de contraseñas.
passwd deploy
usermod -aG sudo deploy

# Crear /home/deploy/.ssh con permisos 700 (sólo el dueño puede entrar). SSH rechaza
# claves guardadas en carpetas con permisos más abiertos.
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh

# Copiar a deploy las claves públicas autorizadas de root (o sea, tu clave), y hacer
# a deploy dueño del archivo. Así entrás como deploy con la misma clave.
cp ~/.ssh/authorized_keys /home/deploy/.ssh/ && chown deploy:deploy /home/deploy/.ssh/authorized_keys

# Actualizaciones de seguridad automáticas y firewall.
#   apt update: refresca la lista de paquetes disponibles.
#   apt -y upgrade: instala las actualizaciones pendientes (-y responde "sí" solo).
#   unattended-upgrades: instala parches de seguridad todos los días sin intervención.
#   ufw: firewall simple ("uncomplicated firewall"). git: para clonar el repositorio.
#   unzip: lo necesita el instalador de Bun (paso 5).
apt update && apt -y upgrade && apt -y install unattended-upgrades ufw git unzip

# Firewall: bloquear todo lo entrante salvo SSH (22), HTTP (80) y HTTPS (443).
# OpenSSH va primero para no cortarte el acceso al activar. --force evita la confirmación.
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable
```

Probá en otra terminal que `ssh deploy@IP` funciona **antes** de cerrar el acceso por contraseña y de root:

```bash
# Endurecer SSH: después de esto sólo se entra con clave y nunca como root.
#   PasswordAuthentication no: no acepta contraseñas (frena los ataques de fuerza bruta,
#     que en una IP pública empiezan a los pocos minutos).
#   KbdInteractiveAuthentication no: cierra la otra vía por la que se pueden pedir contraseñas.
#   PermitRootLogin no: root no puede entrar por SSH; se entra como deploy.
# Va en un archivo propio: las imágenes de Ubuntu traen sshd_config.d/50-cloud-init.conf
# y SSH usa el primer valor que encuentra, así que editar sshd_config no alcanza.
# El prefijo "00-" hace que este archivo se lea antes que "50-cloud-init.conf".
printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin no\n' > /etc/ssh/sshd_config.d/00-hardening.conf

# sshd -t valida la configuración; sólo si está bien (&&) recarga SSH. Recargar no corta
# la sesión abierta, así que si algo falla todavía podés corregirlo desde esta terminal.
sshd -t && systemctl reload ssh

# sshd -T muestra la configuración efectiva final, después de combinar todos los archivos.
sshd -T | grep -Ei '^(passwordauthentication|permitrootlogin)'   # tiene que decir "no" en ambas
```

En hPanel → VPS → Firewall, replicá las mismas reglas (22, 80, 443). Docker publica puertos por fuera de UFW: el Compose sólo expone 80/443 (Caddy) y la app queda en `127.0.0.1:3000`; no cambies `APP_BIND`.

## 4. Dominio

En tu proveedor DNS creá un registro **A** `voley.tudominio.com → IP` (y AAAA si la VPS tiene IPv6). Esperá a que `dig +short voley.tudominio.com` devuelva la IP; Caddy necesita eso para emitir el certificado.

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


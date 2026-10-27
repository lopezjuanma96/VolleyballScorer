# Operación

Todos los comandos se ejecutan desde la raíz, salvo que se indique otra cosa. Requiere Bun 1.4.0 y Docker Compose.

## Configuración

`bun scripts/setup.ts` crea un `.env` privado con credenciales aleatorias. Si ya existe, no lo toca. Nunca se versiona.

| Variable | Función |
| --- | --- |
| `DEPLOY_MODE` | `local`, `onprem`, `cloud`; `scripts/stack.sh` selecciona el perfil Compose |
| `APP_PORT`, `APP_BIND` | Puerto y dirección publicados por Docker; defaults `3000`, `127.0.0.1` |
| `PORT` | Puerto interno para plataformas; Compose lo fija en 3000 |
| `PUBLIC_URL` | Origen que se permite para escrituras del navegador; HTTPS obligatorio fuera de local |
| `DOMAIN` | Host de Caddy en cloud; debe coincidir con `PUBLIC_URL` |
| `DATABASE_URL` | PostgreSQL administrado; tiene prioridad sobre `PSQL_*` en el backend |
| `PSQL_HOST/PORT/DATABASE/USER/PASSWORD` | Conexión PostgreSQL tradicional; Compose fija host `db` y puerto 5432 |
| `PSQL_ADMIN_USER/PASSWORD` | Opcional, sólo migraciones sobre instalaciones anteriores con roles separados |
| `AUTO_MIGRATE` | `true` por defecto; `false` exige aplicar migraciones antes del arranque |
| `MANAGER_USER/PASSWORD` | Acceso de organización; contraseña mínima de 12 caracteres |
| `SESSION_SECRET` | Firma de sesión; mínimo 32 caracteres; cambiarlo invalida sesiones anteriores |
| `COOKIE_SECURE` | Automático: false en local, true en onprem/cloud. No puede desactivarse en público |
| `UPLOAD_DIR` | Carpeta persistente para logos; default `./static/uploads` |
| `NGROK_AUTHTOKEN` | Token del túnel, sólo onprem |
| `TOURNAMENT_NAME/SUBTITLE/ACCENT/TIMEZONE` | Identidad pública y zona horaria |

No copies los defaults de `PSQL_*` a `DATABASE_URL`: usá una forma u otra. El Compose base siempre incluye PostgreSQL local. Para cloud administrado se usa directamente el Dockerfile, no todo el Compose.

### Uso en red local

`APP_BIND=0.0.0.0` expone la app a la LAN. Ajustá `PUBLIC_URL=http://IP-DEL-SERVIDOR:3000` y usá ese mismo origen en el dispositivo del anotador. El default sólo escucha en loopback para desarrollo. En ese modo HTTP local las cookies no llevan Secure.

### Onprem con ngrok

Poné en `.env`: `DEPLOY_MODE=onprem`, el token y `PUBLIC_URL=https://EL-DOMINIO-ASIGNADO.ngrok-free.app` (visible en la cuenta ngrok). `scripts/stack.sh up -d --build` inicia app, DB y túnel. `http://localhost:4040` es el inspector; su puerto no está expuesto públicamente. El dominio de `PUBLIC_URL` se pasa explícitamente a ngrok.

Accedé a organización por la URL pública HTTPS; sus cookies Secure no se envían por `http://localhost`. Para volver al desarrollo HTTP cambiá el modo a local. No dejes `COOKIE_SECURE=false` en onprem.

### Cloud en VPS

1. VPS Linux con Docker y Bun; clonar este repositorio.
2. Configurar `.env`, `DEPLOY_MODE=cloud`, `DOMAIN` y `PUBLIC_URL` HTTPS.
3. Apuntar DNS A al IPv4 del VPS (y AAAA sólo si funciona IPv6). Permitir TCP 80/443 y el acceso SSH necesario.
4. `scripts/stack.sh up -d --build`. Caddy gestiona TLS. La DB no publica un puerto; la app queda en loopback para diagnóstico.
5. Configurar backups fuera del servidor y ensayar una restauración antes del torneo.

### Cloud con plataforma administrada

Railway: un servicio app y un servicio PostgreSQL. Misma aplicación y misma rama.

- Root directory del servicio app: `backend/`. Dockerfile `Dockerfile`. La configuración opcional está en `/deploy/railway.toml` (ruta desde la raíz del repo).
- Variables de app: `DEPLOY_MODE=cloud`, `DATABASE_URL` de la conexión privada a PostgreSQL, usuario/password/secret, `PUBLIC_URL` HTTPS del dominio de la plataforma y las variables visuales. Railway define `PORT`.
- Montá un volumen persistente en `/app/static/uploads`. La imagen usa usuario `bun` (UID 1000): asegurá que el volumen sea escribible por ese usuario. Si el proveedor lo monta como root, ajustá su propiedad una vez desde su consola. No cambies el proceso a root por comodidad.
- Una réplica de la app; no habilites suspensión mientras haya un torneo. Healthcheck `/healthz`, timeout inicial 120 segundos. La app aplica migraciones antes de aceptar conexiones.
- La plataforma termina HTTPS: no agregues Caddy ni ngrok. Usá conexión privada a la DB; si la base exige TLS, conservá la opción de su URL.
- Habilitá y verificá backups de base y volumen. Nuestros scripts Compose se usan para Compose; en Railway hay que exportar/importar con su conexión y herramientas del proveedor.

Render: mismo Dockerfile, `DATABASE_URL`, variables, una réplica y disco persistente en la misma carpeta. Usá servicios pagos; su PostgreSQL gratuito vence. Elegir plan o crear recursos requiere una decisión de despliegue, no es parte de la limpieza del código.

## Logs, actualización y apagado

```bash
scripts/stack.sh ps
scripts/stack.sh logs --tail=100 -f app
curl -f http://localhost:3000/healthz
scripts/backup.sh
scripts/stack.sh up -d --build --remove-orphans
scripts/stack.sh down
```

`down` conserva volúmenes. `down -v` borra la base, logos y certificados: no usar para actualizar. Volver a una imagen anterior no revierte automáticamente cambios de esquema; conservá un backup previo. Antes de instalar una versión nueva verificá CI y las migraciones.

## Backup y restauración

```bash
scripts/backup.sh
# Especificar el directorio real creado por el backup:
scripts/restore.sh backups/AAAAMMDDTHHMMSSZ --replace-data
```

El backup detiene brevemente **la app**, obtiene un `pg_dump -Fc` y un tar de logos, y vuelve a iniciar la app incluso si falla. Si ya estaba detenida, permanece apagada. Conserva archivos privados en `backups/`. Copiá el directorio fuera de la máquina; un backup en el mismo disco no cubre la pérdida del VPS.

La restauración requiere el flag explícito porque reemplaza datos. Importa DB y reemplaza logos, corrige propietario y arranca la app. Si falla, deja la app apagada para inspección. Restaurá en una instalación de ensayo y verificá equipos, puntos y logos antes de tocar datos reales.

## Migrar la instalación anterior

El nuevo Compose crea volúmenes propios; **no** conecta ni borra automáticamente el bind mount histórico `db/db_data/`. No lo elimines hasta verificar el resultado. El Docker anterior usaba `postgres` sin versión fija: identificá primero la versión del servidor que creó ese directorio. No montes esos datos directamente en PostgreSQL 17.

1. Con el stack anterior todavía operativo, detené la app anterior para congelar escrituras. Guardá su `.env` y el archivo Compose fuera de Git.
2. Exportá su DB: `docker exec volleyball_scorer_db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > old-database.dump`.
3. Guardá los logos del contenedor anterior: `docker cp volleyball_scorer_app:/app/static/uploads ./old-uploads`. Si usabas otra ruta, corregila. La configuración anterior no les daba persistencia: no recrees ese contenedor antes de copiarlos.
4. Apagá el stack anterior sin borrar datos. Creá el nuevo `.env` usando `.env.example`; conservá credenciales o generá otras y documentá el cambio. `NGROK_TOKEN` pasa a `NGROK_AUTHTOKEN`; las variables admin son opcionales para el nuevo stack.
5. Iniciá sólo la DB nueva: `scripts/stack.sh up -d db`. Importá: `docker compose exec -T db sh -c 'pg_restore --no-owner --no-acl -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < old-database.dump`. Hacer esto sobre una base nueva/vacía.
6. Copiá los logos al volumen nuevo usando un contenedor temporal de la app o un tar, conservando los nombres que figuran en `clubs.logo`. Se aceptan rutas históricas con nombres simples; si hay espacios, renombrá archivos a UUID y actualizá `clubs.logo` antes de habilitar el torneo. Los uploads nuevos siempre son UUID. SVG no se acepta.
7. Revisá duplicados de sets antes del índice nuevo: `SELECT match_id, set_number, COUNT(*) FROM sets GROUP BY match_id, set_number HAVING COUNT(*) > 1;`. Si existen, resolvelos preservando puntos y números antes de iniciar la app. La migración falla y el servidor no atiende si hay datos incompatibles.
8. `scripts/stack.sh up -d --build`; aplica el índice nuevo. Verificá login, fixture, logos, detalle y un partido de ensayo. Una nueva sesión es necesaria porque cambió el formato de cookies.

Si conservás la DB anterior con roles separados, usá `PSQL_ADMIN_*` para migraciones y otorgá DML sobre tablas/secuencias al usuario de aplicación desde tu cliente DB; no publiques credenciales ni comandos con contraseñas en el historial. El stack nuevo usa el mismo rol para evitar ese paso manual.

La rama Firebase queda archivada para consulta. Convertir un torneo guardado en Firestore requiere un export y un mapeo explícito de identificadores; no hay migrador automático y no se tocó ningún proyecto GCP.

## Pruebas

```bash
cd backend
bun install --frozen-lockfile
bun run check
bun run css
bun test
bun audit
```

Sin `RUN_DB_TESTS` se ejecutan sólo las pruebas de configuración. Para integración con el stack local:

```bash
# Desde la raíz; crear una vez esta base dedicada:
docker compose exec -T db sh -c 'createdb -U "$POSTGRES_USER" scorer_test'
docker compose run --rm --no-deps -T \
  -e PSQL_DATABASE=scorer_test -e RUN_DB_TESTS=true \
  -e UPLOAD_DIR=/tmp/volleyball-test-uploads \
  -v "$PWD/backend/tests:/app/tests:ro" app bun test
```

La imagen debe estar actualizada (`scripts/stack.sh build app`). La suite rechaza bases cuyo nombre no termina en `_test` y elimina sólo sus fixtures, nunca hace `TRUNCATE`. Si tu `.env` define `DATABASE_URL`, reemplazala también por la URL de la base de prueba: tiene prioridad sobre `PSQL_DATABASE`. No uses las credenciales ni la URL del torneo en CI.

La suite verifica concurrencia de puntos, undo, cierre duplicado, cancelaciones, validación, referencias, sesiones vencidas, protección por origen, uploads y canal SSE. No es una prueba de capacidad del torneo completo. Antes del evento conviene un ensayo con el número esperado de espectadores y la conexión real de la sede.

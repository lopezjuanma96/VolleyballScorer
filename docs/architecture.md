# Una aplicación, tres entornos

La base vigente es la reescritura Bun/Hono de `main`. No se fusionó el servidor Python/Firebase: implicaría conservar dos modelos de datos, dos autenticaciones y dos infraestructuras para una misma funcionalidad. Cloud es un destino del contenedor actual, no otro backend.

## Componentes

- Hono sirve API y HTML/CSS/JS desde el mismo origen. No hay frontend server separado, Redis, bucket obligatorio ni balanceador.
- PostgreSQL guarda clubes, categorías, equipos, partidos, sets y snapshots de puntos.
- Volumen de logos junto a la aplicación: se conserva al reconstruir el contenedor.
- SSE avisa cambios a los espectadores; cada pantalla solicita datos actualizados. La conexión se cierra cuando la pestaña queda oculta y se recupera al volver. Un fallo conserva los últimos datos visibles.
- Compose agrega ngrok o Caddy según `DEPLOY_MODE`; las plataformas administradas pueden ejecutar el mismo Dockerfile.

El runtime valida secretos, puertos, tema y zona horaria. En onprem/cloud exige URL HTTPS y cookies seguras. `DATABASE_URL` tiene prioridad sobre `PSQL_*`, útil para bases administradas. El endpoint `/api/config` sólo publica identidad visual y zona horaria.

## Correcciones respecto de la base anterior

- Migraciones automáticas e idempotentes antes del servidor, con healthcheck real de PostgreSQL.
- Configuración Docker reproducible, instalación con lockfile, imagen sin herramientas de desarrollo y proceso sin privilegios.
- JSON coherente para errores de API, validación de nombres, referencias, estados y puntajes; errores de referencias y duplicados devuelven 409.
- Sesiones firmadas con vencimiento de 12 horas; el secreto ya no se envía como cookie. Límite por cliente de 30 intentos de login por minuto, con política de proxies configurable y validación de origen para escrituras desde navegador.
- Bloqueos transaccionales de partido/set: dos anotadores no pierden puntos. Finalizar dos veces no crea sets extra. Sólo se deshace el último punto del set activo.
- Cerrar o cancelar un set exige el último punto conocido por el cliente; un marcador desactualizado devuelve 409 y requiere revisión antes de registrar una corrección manual.
- La vista pública distingue el ganador adjudicado del conteo de sets.
- Cancelar un set crea un reemplazo. Terminar/cancelar un partido cancela el set pendiente; reabrirlo crea otro si corresponde. Los sets ya finalizados se conservan.
- El listado consulta sólo el último punto por set; el detalle trae el historial. Índices sobre puntos por set, sets por partido y fixture por categoría/fecha.
- Logos con nombres UUID y comprobación de tipo por bytes; no se aceptan SVG/HTML. Se limpian archivos de operaciones fallidas y logos reemplazados/eliminados, conservando los que tienen otras referencias.
- Textos escapados antes de insertar HTML; nombres con comillas pasan a handlers por atributos de datos.
- Estados vacíos, recuperación de conexión, navegación común, controles táctiles y estilos responsivos.
- Dependencias de runtime actualizadas a versiones corregidas después de `bun audit`. Override de esbuild 0.25.12 para la dependencia de desarrollo de drizzle-kit; generación de migraciones verificada con esa versión. Auditoría final sin hallazgos.

## Historial de ramas al iniciar la limpieza

| Rama anterior | Commit | Tratamiento |
| --- | --- | --- |
| `main` | `8a69951` | Base Bun/Hono vigente; integra `redone` |
| `redone` | `bb08849` | Reescritura ya incorporada en `main` |
| `python-gcp-firebase` | `f76b270` | Prototipo cloud anterior; código histórico conservado |
| `v0.4` | `3eddba8` | Desarrollo Python/Firebase y CSV; importador reimplementado para la API actual |
| `v02` | `a6f5258` | Versión histórica ya alcanzable desde el historial |

`scripts/archive-branches.sh` muestra el plan y, con `--apply`, conserva los tips exactos en etiquetas `archive/AAAA-MM-DD/<rama>` antes de retirar las ramas antiguas de origin. El push es atómico y las eliminaciones tienen una condición sobre el SHA original: falla si alguien avanzó una rama. Hay un bundle completo local en `backups/`.

Consultar una versión: `git show archive/2026-10-26/python-gcp-firebase:README.md`. Recuperar una rama si hace falta: `git switch -c recuperar-gcp archive/2026-10-26/python-gcp-firebase`. Las etiquetas no son ramas que requieran mantenimiento.

## Límites deliberados

Una sola réplica de la app: el canal SSE y el limitador de acceso viven en memoria. La corrección de los puntajes está en PostgreSQL; para emitir eventos desde varias réplicas haría falta un mecanismo compartido. El canal permite hasta 500 conexiones por proceso, un límite defensivo que **no** es una capacidad validada con carga real.

No hay modo offline para anotar: si falta internet en cloud, la operación debe reintentarse después de verificar el marcador. No se reenvían escrituras automáticamente para evitar duplicar puntos tras una respuesta perdida.

El usuario DB del Compose simplificado también aplica migraciones: se eliminó la separación de roles que causaba permisos inconsistentes. Para una base existente se conservan las variables `PSQL_ADMIN_*`; en instalaciones más exigentes se pueden separar las migraciones con `AUTO_MIGRATE=false` y un paso previo. La base sigue dentro de la red privada de Docker.

Se mantienen las dos canchas del modelo original. No se agregaron ranking, playoffs, reglas automáticas de ganador ni la identidad específica del próximo torneo. PostgreSQL guarda fechas como UTC en el esquema histórico; la interfaz muestra `TOURNAMENT_TIMEZONE`. El selector de creación convierte la hora local del dispositivo a un instante ISO UTC; quien programa el fixture debe usar un dispositivo con la zona horaria correcta.

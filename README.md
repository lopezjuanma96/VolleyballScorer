# VolleyballScorer

Fixture y marcador en vivo para torneos de vóley amateur. Una sola aplicación, una rama activa (`main`) y tres despliegues elegidos por configuración.

- Público, sin cuenta: fixture, resultados, punto a punto, rotación en vivo y tabla de posiciones; actualización automática con SSE.
- Planilleros: inician partidos, anotan puntos, deshacen, cargan saque inicial, formación y cambios, o el resultado final de un set.
- Organización (admin): además categorías con sus reglas, clubes con logos, equipos, fixture, usuarios y decisiones administrativas con historial.
- Reglas por categoría (mejor de 1/3/5/7, puntos por set, desempate, diferencia mínima y tope opcional), copiadas a cada partido. Los sets y el partido se cierran solos al cumplirse; deshacer el último punto los reabre.
- Tabla automática: el ganador suma *sets del formato − sets perdidos* y el perdedor *sets ganados* (mejor de 3: 3/0 o 2/1; mejor de 5: 5/0, 4/1 o 3/2).

Bun · Hono · TypeScript · Drizzle · PostgreSQL · Tailwind · Docker Compose.

## Inicio local

Necesitás Docker con Compose y Bun 1.4.0.

```bash
bun scripts/setup.ts
scripts/stack.sh up -d --build
```

Abrí <http://localhost:3000>. La organización entra por `/manager/`; usuario `manager` (administrador principal), contraseña aleatoria en `MANAGER_PASSWORD` del `.env` local. Desde **Usuarios** se crean las cuentas personales de organización y planilleros. El script genera secretos y no los imprime. Si ya tenés `.env`, no lo sobrescribe: comparalo con `.env.example` y seguí la [migración](docs/operations.md#migrar-la-instalación-anterior).

Las migraciones se aplican antes de aceptar tráfico. PostgreSQL y los logos usan volúmenes persistentes. El puerto de la base no se publica.

## Elegir despliegue

Editá `.env` y usá siempre el mismo comando `scripts/stack.sh up -d --build`. El script selecciona el perfil de Compose a partir de `DEPLOY_MODE`.

| Modo | Configuración | Servicios |
| --- | --- | --- |
| `local` | `DEPLOY_MODE=local`, `PUBLIC_URL=http://localhost:3000` | app + PostgreSQL |
| `onprem` | `DEPLOY_MODE=onprem`, `PUBLIC_URL=https://tu-dominio.ngrok-free.app`, `NGROK_AUTHTOKEN` | app + PostgreSQL + ngrok |
| `cloud` | `DEPLOY_MODE=cloud`, `PUBLIC_URL=https://voley.tudominio.com`, `DOMAIN=voley.tudominio.com` | app + PostgreSQL + Caddy |

Onprem usa el dominio asignado en tu cuenta ngrok y no requiere abrir puertos del router. El inspector sólo se publica en `127.0.0.1:4040`. Cloud funciona en cualquier VPS con Docker: apuntá el DNS al servidor y permití TCP 80/443. Caddy emite y renueva HTTPS. Al cambiar de modo, retirás el servicio anterior con `scripts/stack.sh up -d --build --remove-orphans`.

En Railway/Render se despliega la misma imagen con `DATABASE_URL` y un volumen para logos; la plataforma provee HTTPS. [Guía completa](docs/operations.md#cloud-con-plataforma-administrada).

## Identidad del torneo

Variables en `.env`: `TOURNAMENT_NAME`, `TOURNAMENT_SUBTITLE`, `TOURNAMENT_ACCENT` (hexadecimal entre comillas) y `TOURNAMENT_TIMEZONE`. No se necesita rebuild para cambiarlas: `scripts/stack.sh up -d --force-recreate app`. El diseño base no descarga imágenes ni fuentes de terceros.

## Preparar el fixture

1. Entrá a `/manager/` y creá en **Usuarios** una cuenta por persona (Organización o Planillero).
2. Creá categorías con sus reglas, y clubes; logos PNG/JPG/WebP de hasta 2 MB.
3. Creá equipos y partidos, o importá equipos por CSV. Cada partido copia las reglas de su categoría; podés cambiarlas para un partido puntual.
4. El planillero abre el partido, toca «Iniciar partido», carga (opcional) quién saca y las formaciones, y anota punto a punto o el resultado final de cada set.
5. Sets y partido se cierran solos según las reglas; la tabla se actualiza al instante.

La rotación se recalcula en cada punto: un equipo rota cuando recupera el saque. Los cambios reemplazan al jugador en su posición (el líbero no se registra). Desde «Editar» la organización cambia horario, cancha o reglas. La programación muestra la zona del dispositivo y su equivalencia en la zona del torneo. La organización puede corregir sets cerrados con motivo, adjudicar un partido (walkover, abandono), cancelar sets y recuperar el último set cancelado; todo queda en el historial con el usuario que lo hizo.

Importación CSV opcional con Python 3, sin paquetes externos:

```bash
# Valida sin modificar datos.
bun scripts/import-teams.ts docs/teams.example.csv
# Crea categorías, clubes y equipos faltantes; salta equipos existentes.
bun scripts/import-teams.ts equipos.csv --apply
```

Columnas: `Categoria,Club,Nombre del Equipo`. La contraseña se toma del entorno cargado por Bun desde `.env`; no se pasa en argumentos. `--url https://...` permite apuntar a otro despliegue con las credenciales correspondientes. La importación es secuencial: si se interrumpe, puede repetirse sin duplicar los equipos ya importados. No convierte automáticamente datos de Firestore.

## Desarrollo y verificación

```bash
cd backend
bun install --frozen-lockfile
bun run check
bun run css
bun test
```

Para ejecutar el backend fuera de Docker usá una base PostgreSQL accesible y `DATABASE_URL`; desde la raíz: `bun --env-file .env --cwd backend run dev`. No publiques el PostgreSQL de producción para desarrollar. Las [pruebas de integración](docs/operations.md#pruebas) usan otra base, nunca datos del torneo. GitHub Actions comprueba tipos, CSS, migraciones, tests y build Docker.

## Operación y decisiones

- [Puesta en marcha en Hostinger y despliegue desde GitHub](docs/hostinger.md)
- [TODO](TODO.md)
- [Backup, restauración, migración y despliegues](docs/operations.md)
- [Arquitectura, ramas y límites](docs/architecture.md)
- [Revisión independiente y mejoras pendientes](docs/independent-review.md)
- [Prueba de carga local y resultados](docs/load-testing.md)
- [Hosting: costos y recomendación, investigado el 26/10/2026](docs/hosting.md)

Los backups y secretos quedan fuera de Git. Un volumen persistente no reemplaza una copia fuera del servidor.

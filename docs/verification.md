# Verificación de la limpieza — 26/10/2026

Ejecutado en el workspace local, con PostgreSQL 17 en Docker y una base independiente `scorer_test`. Los datos de demostración del navegador se crearon en `scorer_preview`, separados de la base vacía destinada al torneo.

- TypeScript: `bun run check`, sin errores.
- CSS: compilación minificada con Tailwind, correcta.
- Docker: imagen completa y runtime sin dependencias de desarrollo, build correcto.
- Migraciones: creación desde base vacía y reaplicación sin cambios, correctas. Generación Drizzle funciona con el override de esbuild.
- Suite completa: **11 pruebas, 78 verificaciones, 0 fallos**, incluida concurrencia real de 20 puntos contra PostgreSQL.
- Dependencias: `bun audit`, **0 vulnerabilidades reportadas** para el lockfile final. Esto es un resultado del registro consultado, no una garantía sobre fallas todavía desconocidas.
- Navegador: fixture vacío y con datos, filtros, login/redirect de organización, suma y undo de un punto, detalle con historial y actualización por SSE al cambiar un puntaje desde otro cliente.
- Entrada HTML: un nombre con apóstrofe, comillas y etiqueta de imagen se muestra como texto y puede editarse; no crea una imagen ni ejecuta el handler incluido en el texto.
- Móvil: fixture, administración y detalle comprobados a 320 y 375 px; se corrigió el desborde de navegación de administración.
- Acceso estático: rutas de manager normales, codificadas y con doble slash no exponen páginas de administración sin sesión.
- Backup/restauración: se creó un registro y un archivo de prueba, se exportaron, se eliminaron, se restauraron y se verificó su contenido; después se retiraron los fixtures de prueba de la base del torneo.
- Caddy: configuración validada; proxy HTTPS probado localmente con certificado interno contra `/healthz` y `/api/matches`.
- Ngrok: imagen descargada y configuración v3 validada; perfil Compose resuelve los tres servicios. No se abrió un túnel público porque no se proporcionó un token.
- Perfiles: local resuelve app/DB, onprem agrega ngrok, cloud agrega Caddy.
- CSV: validación previa, importación en la base de demostración y segunda importación sin duplicados, correctas.
- Historial Git: bundle previo verificado, archivado mediante etiquetas con SHA exacto y limpieza de ramas antiguas.

No se contrató ni desplegó ningún servicio cloud. No se midió la capacidad con cientos de espectadores ni la latencia de una región remota; esas pruebas dependen de la audiencia y la sede del torneo. El límite SSE de 500 conexiones es defensivo y no implica un benchmark de capacidad.

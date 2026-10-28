# Verificación de la limpieza — 26/10/2026

Ejecutado en el workspace local, con PostgreSQL 17 en Docker y una base independiente `scorer_test`. Los datos de demostración del navegador se crearon en `scorer_preview`, separados de la base vacía destinada al torneo.

- GitHub Actions: ejecución remota correcta de tipos, CSS, migraciones, pruebas y build Docker. Runner fijado en Ubuntu 24.04 y checkout actualizado a Node 24.
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

## Regresiones de la revisión independiente — 28/10/2026

La suite ampliada pasa **22 pruebas con 166 verificaciones**, incluyendo: rechazo de cierres/cancelaciones sobre puntos desactualizados, aceptación posterior de correcciones manuales explícitas, cuotas de acceso aisladas por cliente, validación de headers de proxy, ausencia de archivos adicionales tras fallos de carga, preservación de logos compartidos, ganador público adjudicado y actualizaciones durante eventos continuos. Las pruebas JavaScript ejecutan el código real de `app.js` y de los renders públicos con un reloj controlado. No se modificó el esquema de la base.

La revisión y las sugerencias de producto que quedan pendientes están en [independent-review.md](independent-review.md).

En navegador, sobre `scorer_regression_ui_test`, se comprobó el cierre desde un marcador desactualizado: rechazar la confirmación mantuvo intacto el punto nuevo; aceptar una confirmación posterior registró el resultado manual solicitado sin borrar el historial. Se verificó el ganador adjudicado en el detalle público a 375 px, separado del conteo de sets. El entorno temporal se retiró al terminar.

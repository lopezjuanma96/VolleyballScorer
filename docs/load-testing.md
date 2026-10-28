# Prueba de carga local

Objetivo del torneo: hasta aproximadamente 100 espectadores simultáneos, dos canchas, VPS dedicada al torneo durante el evento. Se probó también margen hasta 450 espectadores; el límite actual de admisión SSE es de 500 conexiones por proceso, no una promesa de capacidad.

## Reproducir

Requiere Linux, Docker Compose y Bun. Desde la raíz:

```bash
bun scripts/load-test.ts --spectators 50,100,150,300,450 --duration 30 --output backups/load-results.json
# Ensayo sostenido con la audiencia esperada:
bun scripts/load-test.ts --spectators 100 --duration 120 --output backups/load-soak.json
```

El script siempre construye su propia imagen y levanta un proyecto Compose con nombre único, PostgreSQL aparte y base `volleyball_load_test`. No admite una URL externa ni usa los datos del torneo. Genera credenciales temporales sin imprimirlas y elimina **sólo su stack y su volumen** al finalizar. El reporte JSON permanece en `backups/`, fuera de Git. Ctrl+C solicita una finalización con limpieza; si se mata abruptamente el proceso, el stack descartable puede quedar levantado: identificá su nombre `volleyball-load-...` y retiralo con ese mismo proyecto, nunca con el Compose del torneo.

Opciones: `--spectators` (lista de 1–500), `--duration` (5–600 segundos por etapa), `--point-interval` (100–60000 ms por cancha, default 1000), `--port` (default 3100, sólo loopback), `--output`. `LOAD_CPU` permite elegir otro índice de CPU disponible; por defecto usa el primero permitido. `--help` no inicia contenedores.

## Qué se simula

- App y PostgreSQL comparten **el mismo procesador lógico**, mediante `cpuset`. Límites de memoria: app 1 GiB y DB 2 GiB, dejando presupuesto dentro de los 4 GB de una VPS para sistema y proxy. El generador corre fuera de esos contenedores. Es una aproximación, no una emulación del hardware de Hostinger.
- Fixture de 120 partidos, 6 categorías, 48 equipos, 240 sets cerrados y 10.800 registros históricos de marcador. Dos partidos en vivo adicionales dentro de esos 120 partidos.
- Cada espectador abre una conexión SSE. La mitad mira el fixture y consulta partidos + categorías; la otra mitad mira uno de los dos detalles de partido.
- Al recibir un evento, el cliente espera 180 ms y agrupa notificaciones; si está consultando, deja una actualización pendiente. Reproduce la política del cliente web, sin ejecutar un navegador completo.
- Dos anotadores agregan un punto por segundo **por cancha**, intercalados: dos escrituras por segundo en total. No reintentan puntos fallidos. Si el servidor se retrasa, la tasa alcanzada se informa y se compara con la prevista.
- El marcador de los partidos activos se acumula entre etapas para aumentar el historial. Los puntajes exagerados son intencionales: no se decide ningún ganador ni se aplican reglas de cierre automático.
- Antes de medir se conectan los espectadores y cargan sus datos. Al terminar se deja drenar hasta 15 segundos y se comprueba que todos recibieron el último marcador.
- Se compara cada punto aceptado con los registros y el resultado final en PostgreSQL, y se detectan retrocesos de marcador. Se toman muestras de CPU y memoria con `docker stats` cada tres segundos.

Se reportan p50/p95/p99 de consultas, guardado de puntos, conexión SSE y tiempo desde iniciar una escritura hasta recibir el marcador actualizado. Este último incluye la espera de 180 ms, pero **no** el renderizado ni la pintura del navegador. Las estadísticas de consultas incluyen el drenaje final; `requestsPerSecond` es una referencia aproximada sobre la duración de anotación, no un generador de tasa fija.

Para aprobar se exige: cero errores y desconexiones, todos los espectadores al día, puntos íntegros, al menos el 95 % de los puntos previstos, p95 de consultas <1 s, guardado <500 ms y actualización <1,5 s. Son objetivos de este ensayo, no un SLA.

## Resultados — 28/10/2026

Host local: AMD Ryzen 5 4500, 12 procesadores lógicos. App y DB restringidas al mismo procesador lógico; Bun 1.4.0 y PostgreSQL 17. Conexión HTTP local, sin Caddy/ngrok/TLS. Etapas de 30 segundos de anotación más calentamiento y drenaje.

La primera medición detectó consultas y serialización repetidas al consultar el mismo fixture por cada espectador. Se añadió una caché acotada en la misma app: agrupa solicitudes iguales y se invalida después de cada escritura, antes del evento SSE. No se añadió ningún servicio.

| Espectadores | Consulta p95 antes | Consulta p95 después | Guardado p95 después | Punto → datos p95 después |
| --- | ---: | ---: | ---: | ---: |
| 50 | 1.067 ms | 85 ms | 20 ms | 301 ms |
| 100 | Sin medición previa | 67 ms | 17 ms | 277 ms |
| 150 | 1.172 ms | 84 ms | 21 ms | 294 ms |
| 300 | 2.746 ms | 144 ms | 19 ms | 358 ms |
| 450 | 4.404 ms | 206 ms | 22 ms | 434 ms |

En todas las etapas posteriores: cero errores HTTP, cero desconexiones SSE, todos los espectadores actualizados y todos los puntos aceptados presentes en el marcador. Se alcanzaron las dos escrituras por segundo previstas. La primera versión preservó los puntos, pero se retrasó bajo carga: con 450 espectadores el guardado p95 fue de 4.269 ms y sólo completó 29 de los aproximadamente 60 puntos previstos en esa ventana. No debe interpretarse como capacidad satisfactoria sólo por no perder datos.

El pico muestreado de memoria conjunta de app y DB después de optimizar fue de aproximadamente 113 MiB con 100 espectadores y 133 MiB con 450, según `docker stats`; no incluye el sistema operativo, el generador, Caddy ni toda la caché de archivos del host. Son muestras, no el pico absoluto.

En el ensayo sostenido de **120 segundos con 100 espectadores** hubo 36.000 consultas y 240 puntos guardados: cero errores, cero desconexiones, 100/100 espectadores actualizados e integridad correcta. Consulta p95 **80 ms**, guardado p95 **15 ms** y punto → datos p95 **287 ms**. Es un ensayo de dos minutos, no de una jornada completa.

Las mediciones originales quedan en `backups/load-baseline.json` y `backups/load-optimized.json` (más `backups/load-soak-100.json` para el ensayo sostenido); se conserva un resumen reproducible en [load-results/2026-10-28.json](load-results/2026-10-28.json). El formato inicial de `passed` en el baseline sólo evaluaba integridad; el script actual distingue integridad de objetivos de latencia/tasa.

## Qué falta validar

Los resultados respaldan empezar con una VPS chica para la audiencia estimada, pero no garantizan las mismas latencias en KVM 1. Hay que repetir en hardware equivalente o en una VPS de ensayo, y comprobar HTTPS/proxy, región, almacenamiento, límites del proveedor y conectividad de la sede.

Esta prueba no cubre cortes de red, conexiones móviles lentas, clientes SSE que no leen, reconexiones masivas, una jornada completa ni el costo de renderizar 120 tarjetas en un teléfono. Un ensayo con unas pocas personas sirve para probar anotación, usabilidad y conexión; el generador sirve para producir volumen. Son complementarios: no hace falta reunir a 100 personas para medir el backend.

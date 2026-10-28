# Hosting: costo bajo sin multiplicar servicios

Investigación del **26 de octubre de 2026**. Tarifas de lista, sin impuestos, conversión de tarjeta, dominio ni backups externos salvo indicación. Disponibilidad y región pueden cambiar. Las estimaciones de consumo son escenarios, no mediciones de un torneo real.

## Recomendación para este proyecto

**Railway si el objetivo principal es dejar de administrar servidores:** app + PostgreSQL, dos volúmenes y HTTPS de la plataforma. Dos servicios en un mismo panel. Presupuestaría inicialmente **USD 5–10/mes**, pondría alertas y observaría consumo en un ensayo; no asumiría que siempre cuesta USD 5.

**Un VPS si el objetivo principal es el menor costo fijo manteniendo Docker:** app + PostgreSQL + Caddy en una VM. Una factura y tres contenedores. Hetzner CX23 es atractivo si hay capacidad; DigitalOcean es una alternativa de tarifa clara. Vos mantenés sistema, espacio en disco y copias de seguridad. La diferencia operativa con Railway pesa más que ahorrar un par de dólares.

En ambos casos está listo el mismo código: no hace falta Firebase, Redis, almacenamiento de objetos ni servidor frontend separado. La latencia desde Argentina debe verificarse con la región elegida, especialmente para el anotador. No se midió esa latencia aquí.

## Comparación

| Opción | Servicios que operás | Costo base mensual | Qué implica |
| --- | --- | --- | --- |
| Onprem + ngrok Free | App + DB + túnel | Hosting adicional USD 0; electricidad/internet propios | Conserva el aprendizaje. Depende de luz y conexión de la sede; cuotas bajas para espectadores |
| Hetzner CX23, Europa | Una VM / 3 contenedores | EUR 5,49 servidor + EUR 0,50 IPv4 ≈ **EUR 5,99** | Sin IVA, dominio ni backups. Capacidad CX no garantizada; alternativa CAX11 ARM desde EUR 5,99 + IPv4 |
| DigitalOcean Basic 1 GiB | Una VM / 3 contenedores | **USD 6**; 2 GiB **USD 12** | 1 GiB es una hipótesis a validar, especialmente si construís imágenes ahí; 2 GiB ofrece margen. Backups semanales opcionales agregan 20% |
| Railway Hobby | App + PostgreSQL | **Mínimo USD 5**, incluye USD 5 de uso; excedente por consumo | Menor trabajo operativo. DB y logos necesitan volúmenes; fijar alertas y revisar consumo |
| Render pago | App + PostgreSQL | App desde **USD 7**, DB desde **USD 6**, más almacenamiento | Dos servicios, HTTPS administrado. Referencia de piso: unos USD 13 más discos/transferencia; comprobar cotización final del plan |
| GCP Cloud Run + Cloud SQL + almacenamiento persistente | App + DB + almacenamiento, además de IAM/build/configuración | Variable; no se cotizó una región/carga concreta | Se puede, pero su operación y persistencia aportan piezas que esta escala no necesita |

Fuentes de precios: [Hetzner, ajuste de junio de 2026](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/), [IPv4 Hetzner](https://docs.hetzner.com/general/infrastructure-and-availability/ipv4-pricing/), [DigitalOcean Droplets](https://www.digitalocean.com/pricing/droplets), [planes Railway](https://docs.railway.com/pricing/plans), [tarifas Railway](https://docs.railway.com/pricing), [Render](https://render.com/pricing). La página de Render carga dinámicamente su tabla; se contrastó también el resultado indexado del propio proveedor. Confirmar el total en su calculadora antes de contratar.

## Por qué Railway no significa «USD 5 por cada servicio»

Hobby tiene un mínimo mensual de USD 5 con USD 5 de recursos incluidos. Se paga el mayor entre ese mínimo y el consumo total. Sus tarifas publicadas son RAM USD 10/GB-mes, CPU USD 20/vCPU-mes, volumen USD 0,15/GB-mes y salida USD 0,05/GB. [Planes y ejemplos](https://docs.railway.com/pricing/plans), [tarifas](https://docs.railway.com/pricing).

Ejemplo calculado, **no benchmark**: app + DB con 0,30 GB de RAM media conjunta, 0,02 vCPU media, 2 GB persistidos y 1 GB de salida darían USD 3 + 0,40 + 0,30 + 0,05 = USD 3,75 de uso; factura mínima USD 5. Con 0,70 GB de RAM media, 0,03 vCPU, 2 GB persistidos y 3 GB de salida: USD 8,05 de uso/factura. Uso real, picos de CPU, backups y otros recursos pueden modificarlo.

Las conexiones SSE mantienen actividad: no basar el presupuesto en que la aplicación duerma durante el torneo. Una alerta de gasto tampoco equivale a un techo que garantice continuidad; un corte por presupuesto deja sin marcador. Revisar límites del proveedor antes del evento.

## Ngrok gratis: conservarlo, conocer el límite

El plan gratuito publica **1 GB de salida y 20.000 requests HTTP al mes**, con una pantalla de advertencia para HTML. Su dominio asignado puede quedarse online sin timeout mientras corra el agente. [Límites oficiales](https://ngrok.com/docs/pricing-limits/free-plan-limits).

Ejemplo de cálculo: 100 espectadores, 8 horas y polling cada 5 segundos serían 576.000 consultas incluso con un único endpoint. El canal SSE implementado evita consultas periódicas sin cambios, pero las pantallas aún consultan la API cuando cambia el marcador: una jornada concurrida también puede superar la cuota. Por eso ngrok Free sirve para aprender/probar y no es la recomendación principal para publicar el torneo completo.

## Por qué no volvería ahora a Cloud Run/Firebase

Cloud Run ofrece escala a cero, pero su filesystem se descarta con la instancia: los logos necesitan otra estrategia. Las conexiones de larga duración también requieren considerar facturación y reconexiones. La combinación con DB y storage puede tener sentido a otra escala; para este caso el Dockerfile en una VM o dos servicios en Railway resulta más directo. Es una decisión de arquitectura, no una afirmación de que GCP siempre cueste más. [Modelo de Cloud Run](https://docs.cloud.google.com/run/docs/overview/what-is-cloud-run).

Tampoco usaría Render Free como base del evento: la app suspende por inactividad y su DB gratuita vence a los 30 días. [Restricciones oficiales](https://render.com/docs/free).

## Ampliación: Railway vs. Hostinger — 28/10/2026

Sí se puede alojar la aplicación completa en Railway: el servicio Bun también sirve HTML/CSS/JS, PostgreSQL es el segundo servicio y los logos van en un volumen del servicio app. No se necesita otro proveedor para frontend ni un bucket. El nombre de dominio propio, si se desea, se contrata aparte; la plataforma ofrece un dominio para acceder a la app.

Hobby sirve como plan inicial, pero USD 5 es el mínimo mensual con USD 5 de consumo incluido, no una tarifa plana ilimitada. Si el total de recursos es USD 4, la factura es USD 5; si es USD 8, es USD 8. El rango USD 5–10 es un presupuesto de ensayo, no una garantía sin medir audiencia, tráfico, memoria, disco y backups. [Facturación oficial](https://docs.railway.com/pricing/plans).

Railway mantiene su plantilla PostgreSQL y las actualizaciones de seguridad de su imagen. Backups, recuperación a un punto en el tiempo y alta disponibilidad son opciones que el usuario activa; los upgrades mayores y el tamaño del disco también requieren intervención. No significa que el plan de USD 5 incluya automáticamente un cluster con failover. Las copias incrementales tienen costo de almacenamiento. [Responsabilidades](https://docs.railway.com/databases), [backups](https://docs.railway.com/volumes/backups).

Hostinger VPS permite ejecutar el mismo perfil cloud: app, PostgreSQL y Caddy en una VM. Su Docker Manager facilita usar Compose; no hay que instalar los tres procesos manualmente. El sistema operativo, las actualizaciones de PostgreSQL y la operación de la aplicación quedan a cargo del usuario. Tener asistente de IA y backups semanales del VPS no equivale a contratar PostgreSQL administrado. [Producto y responsabilidades del VPS](https://www.hostinger.com/vps-hosting).

La oferta internacional KVM 1 consultada publica **USD 6,49/mes efectivos**, con **USD 155,76 por 24 meses** y renovación a **USD 11,99/mes** por el mismo plazo: 1 vCPU, 4 GB RAM, 50 GB NVMe y 4 TB de transferencia. Incluye backups semanales. Es más capacidad fija que la necesaria inicialmente según nuestra arquitectura, pero no se validó con la carga real del torneo. Los precios dependen de país, promoción y plazo. [Hostinger internacional](https://www.hostinger.com/vps-hosting).

La tienda argentina consultada publica KVM 1 a **ARS 12.099/mes efectivos**, contrato de **ARS 290.376 por 24 meses** (ofrece hasta 12 cuotas) y renovación a **ARS 24.199/mes**. No es una cotización del pago final: revisar impuestos/recargos y condiciones del checkout. [Hostinger Argentina](https://www.hostinger.com/ar/vps-argentina).

Para publicar este torneo con poco mantenimiento, mantendría Railway como primera opción. Un VPS de Hostinger tiene más sentido si se usará todo el año o también para otros proyectos, y se quiere asumir su administración. Para uno o pocos eventos, el compromiso promocional de 24 meses pesa más que una diferencia pequeña en la cifra mensual anunciada.

## Decisión práctica

1. Ensayar local con el flujo de torneo y algunos teléfonos.
2. Usar ngrok para comprobar acceso remoto y practicar operación onprem.
3. Para el evento, preferir Railway con presupuesto inicial USD 5–10, dos servicios y backups, o el VPS si querés mantener el aprendizaje de administrar el host.
4. Probar carga y latencia en la región elegida, restaurar un backup de ensayo y recién entonces publicar la URL.

La limpieza no creó cuentas, recursos cloud ni gastos. La elección del proveedor no cambia la rama ni el modelo de datos.

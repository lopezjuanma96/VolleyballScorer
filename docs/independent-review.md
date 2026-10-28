# Revisión independiente — 28/10/2026

Un subagente revisó el repositorio sin recibir el historial de la conversación ni las conclusiones del trabajo anterior. El brief pidió errores comprobables y mejoras priorizadas, sin modificar archivos. Confirmó cinco problemas, incluidos dos relevantes para la integridad/comunicación del marcador.

| Hallazgo | Corrección |
| --- | --- |
| Cierre con un puntaje de otra pantalla desactualizada | Control transaccional del último punto conocido; rechazo 409 y confirmación manual explícita después de revisar el marcador actual |
| Ganador adjudicado oculto cuando difiere de los sets | Ganador oficial visible en fixture y detalle, calculado desde el estado que eligió la organización |
| Actualización pública postergada indefinidamente durante una ráfaga | Agrupación de eventos con plazo fijo; consultas en serie con actualización pendiente |
| Intentos de un visitante consumen la cuota de login de todo el sitio | Cuota por cliente, mapa acotado, límite de payload y política explícita para proxies; IP de transporte en local |
| Archivos de logos sin registro o abandonados al reemplazar/borrar | Compensación ante fallos y limpieza posterior al commit; se verifican referencias antes de retirar archivos |

Los cierres y cancelaciones de sets requieren ahora `expectedLastPointId`; ver [operación](operations.md#cierre-seguro-de-sets). No cambió el esquema de PostgreSQL ni se añadieron servicios.

## Mejoras de producto implementadas

Se implementaron después de las correcciones anteriores, a pedido del usuario:

1. Advertencia de puntos pendientes y recuperación explícita del último set cancelado, conservando el marcador.
2. Correcciones administrativas con motivo, confirmación, versiones para detectar conflictos y registro antes/después.
3. Edición de horario y cancha desde el fixture y desde el marcador.
4. Zona horaria del dispositivo, zona del torneo y vista previa del horario que se publicará; se contempla el alias de Córdoba.
5. [Carga local reproducible](load-testing.md), con espectadores SSE y puntos por dos canchas sobre datos descartables. También se redujo el trabajo repetido de lectura sin incorporar servicios.

Queda pendiente validar la VPS elegida, HTTPS y la conectividad de la sede. La carga local no mide esa red ni sustituye una prueba desde el servidor final.

Se conservan las adjudicaciones manuales de ganador y la libertad de ingresar resultados sin imponer reglas profesionales al torneo amateur.

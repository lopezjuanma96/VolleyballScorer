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

## Mejoras de producto pendientes

Estas propuestas requieren definir la experiencia deseada; no se mezclaron con las correcciones anteriores.

1. Advertir y ofrecer recuperación explícita al cerrar accidentalmente un partido con un set activo que tiene puntos.
2. Permitir correcciones administrativas de sets ya cerrados con trazabilidad, confirmación e historial.
3. Editar horarios y cancha desde la interfaz; la API ya dispone de esa capacidad.
4. Mostrar la zona horaria del dispositivo al programar un partido y aclarar si difiere de la del torneo.
5. Ensayar espectadores y conectividad representativos antes del evento: el límite SSE configurado no sustituye una prueba de carga.

Se conservan las adjudicaciones manuales de ganador y la libertad de ingresar resultados sin imponer reglas profesionales al torneo amateur.

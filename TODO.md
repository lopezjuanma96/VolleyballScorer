# Próximos pasos

Actualizado el 25/11/2026. El torneo terminó y la app quedó apagada en la VPS, lista para reactivar ([cómo](docs/operations.md#apagar-y-reactivar)).

- [x] **Roles.** Público, planilleros y organización con cuentas personales, revocación que alcanza sesiones abiertas e identificación de la persona en el historial.
- [x] **Reglas de set configurables, tabla automática y rotación.**
- [x] **Producción en Hostinger.** VPS con Docker, <https://voley.zagador123.cloud> con HTTPS, usuario `deploy` y despliegue automático desde GitHub después de CI. Usada en el torneo y apagada el 25/11/2026 (`DEPLOY_ENABLED=false`).
- [ ] **Antes del próximo torneo** ([docs/hostinger.md](docs/hostinger.md) §7–8): reactivar, backups diarios fuera de la VPS, ensayo de restauración, prueba de carga contra la VPS y prueba desde la sede.
- [x] **Ingreso con Google** para organización y planilleros por email habilitado; sólo `manager` gestiona usuarios.
- [ ] **Opcional: plantel por equipo** (nombres de jugadores) para mostrar nombres en la rotación en lugar de números.

La **caché ya está implementada y probada**: respuestas compartidas en memoria para fixture, categorías, posiciones y detalle, con invalidación después de cada escritura y antes de avisar por SSE. Ver [resultados de carga](docs/load-testing.md).

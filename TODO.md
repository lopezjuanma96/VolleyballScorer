# Próximos pasos

Actualizado el 29/10/2026. No se contrataron servicios ni se conectaron cuentas externas.

- [x] **Roles.** Público, planilleros y organización con cuentas personales, revocación que alcanza sesiones abiertas e identificación de la persona en el historial.
- [x] **Reglas de set configurables, tabla automática y rotación.**
- [ ] **Contratar Hostinger y poner el proyecto en producción.** Seguir [docs/hostinger.md](docs/hostinger.md): VPS con Docker, dominio y HTTPS, usuario `deploy`, despliegue desde GitHub después de CI, backups fuera de la VPS y ensayo de restauración. Conectar el MCP de Hostinger (`claude mcp add --transport http hostinger https://mcp.hostinger.com`) para revisar la VPS. Repetir la prueba de carga en la VPS y probar desde la sede.
- [ ] **Opcional: «Continuar con Google».** Las cuentas ya existen en PostgreSQL; faltaría asociar un correo a cada usuario y aceptar el inicio con Google sólo para correos invitados. Requiere registrar el cliente OAuth y los retornos para local, ngrok y cloud.
- [ ] **Opcional: plantel por equipo** (nombres de jugadores) para mostrar nombres en la rotación en lugar de números.

La **caché ya está implementada y probada**: respuestas compartidas en memoria para fixture, categorías, posiciones y detalle, con invalidación después de cada escritura y antes de avisar por SSE. Ver [resultados de carga](docs/load-testing.md).

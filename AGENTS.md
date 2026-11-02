# VolleyballScorer

Read README.md and docs/operations.md before changing deployment behavior; docs/hostinger.md describes production.

## Production (as of 2026-11-02)

- Live at <https://voley.zagador123.cloud> on a Hostinger VPS (`DEPLOY_MODE=cloud`, Caddy HTTPS). Check health with `curl -fsS https://voley.zagador123.cloud/healthz`; the Hostinger MCP server (`.mcp.json`) can inspect the VPS.
- CI/CD is on: a push to `main` runs **Check** (`.github/workflows/ci.yml`) and, if it passes, **Deploy** (`deploy.yml`) ships it to the VPS because the repo variable `DEPLOY_ENABLED=true`. Merging to `main` is a production deploy: never merge on tournament days, and land migrations and new required `.env` values on the server before merging code that needs them.
- Server `.env` lives only on the VPS (`~/volleyball-scorer/.env`, user `deploy`); never copy it into the repo or print it.

- Keep one implementation and one active branch (`main`); deployment modes belong in configuration.
- Runtime: Bun, Hono, Drizzle, PostgreSQL. The API and static pages share an origin.
- Run `bun install --frozen-lockfile`, `bun run check`, `bun run css`, and `bun test` in `backend/`.
- Integration tests require `RUN_DB_TESTS=true` and an isolated database whose name ends in `_test`; see docs/operations.md.
- Never print `.env`, database URLs, session tokens, or manager passwords.
- Set rules are configurable per category and copied to each match (`src/rules.ts`). Rallies close sets and matches automatically; admins keep manual rulings (corrections, walkovers, cancellations) with audit history.
- Roles: public (read only), `scorer` (start matches, rallies, undo, lineups, set results), `admin` (everything except users). Enforce roles in the API (`src/middleware/auth.ts`), not only in pages.
- Sign-in: members (scorers and organization admins) use Google; the manager adds their emails with roles in **Usuarios** (`users` table). Only the `.env` manager (`MANAGER_USER`/`MANAGER_PASSWORD`, password login at the unlinked `/manager_login`) can manage users (`managerOnly`). Without `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` only the manager can log in.
- Rotation is derived from lineup, toss, rallies and substitutions (`src/rotation.ts`); never store a current rotation that undo could leave stale.
- Keep scoring changes transactional. Lock match before set, as in `src/scoring.ts`.
- No cloud resource provisioning or paid services without an explicit deployment request.

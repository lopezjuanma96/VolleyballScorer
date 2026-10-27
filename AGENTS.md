# VolleyballScorer

Read README.md and docs/operations.md before changing deployment behavior.

- Keep one implementation and one active branch (`main`); deployment modes belong in configuration.
- Runtime: Bun, Hono, Drizzle, PostgreSQL. The API and static pages share an origin.
- Run `bun install --frozen-lockfile`, `bun run check`, `bun run css`, and `bun test` in `backend/`.
- Integration tests require `RUN_DB_TESTS=true` and an isolated database whose name ends in `_test`; see docs/operations.md.
- Never print `.env`, database URLs, session tokens, or manager passwords.
- Preserve manual tournament rulings; do not automatically decide winners or impose standard set score rules.
- Keep scoring changes transactional. Lock match before set, as in `src/scoring.ts`.
- No cloud resource provisioning or paid services without an explicit deployment request.

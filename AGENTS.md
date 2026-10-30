# VolleyballScorer

Read README.md and docs/operations.md before changing deployment behavior; docs/hostinger.md describes production.

- Keep one implementation and one active branch (`main`); deployment modes belong in configuration.
- Runtime: Bun, Hono, Drizzle, PostgreSQL. The API and static pages share an origin.
- Run `bun install --frozen-lockfile`, `bun run check`, `bun run css`, and `bun test` in `backend/`.
- Integration tests require `RUN_DB_TESTS=true` and an isolated database whose name ends in `_test`; see docs/operations.md.
- Never print `.env`, database URLs, session tokens, or manager passwords.
- Set rules are configurable per category and copied to each match (`src/rules.ts`). Rallies close sets and matches automatically; admins keep manual rulings (corrections, walkovers, cancellations) with audit history.
- Roles: public (read only), `scorer` (start matches, rallies, undo, lineups, set results), `admin` (everything). Enforce roles in the API (`src/middleware/auth.ts`), not only in pages.
- Rotation is derived from lineup, toss, rallies and substitutions (`src/rotation.ts`); never store a current rotation that undo could leave stale.
- Keep scoring changes transactional. Lock match before set, as in `src/scoring.ts`.
- No cloud resource provisioning or paid services without an explicit deployment request.

# VolleyballScorer

Amateur volleyball tournament fixture and real-time scoring web app, built step by step for learning purposes.

## Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Bun |
| Framework | Hono (TypeScript) |
| Styling | Tailwind CSS |
| ORM | Drizzle |
| DB | PostgreSQL |
| Cache | Redis (optional, for learning) |
| Infra | Docker Compose → nginx → ngrok |

## Roles

- **Watcher (public):** views live scores, fixtures
- **Manager (authenticated):** creates/controls matches, records scores

## Project Structure

```
VolleyballScorer/
├── docker-compose.yml
├── .env                        # secrets — never commit
├── .env.example                # template with placeholder values
├── nginx/
│   └── nginx.conf              # server block only (mounted to conf.d/default.conf)
├── ngrok/
│   └── ngrok.yml               # tunnel config (start --all)
├── db/
│   ├── db_data/                # PostgreSQL volume mount (gitignored)
│   └── db_init/psql/
│       └── create_user.sh      # runs once on fresh DB: creates scorer user + grants
└── backend/
    ├── Dockerfile
    ├── package.json
    ├── drizzle.config.ts
    ├── src/
    │   ├── index.ts            # Hono app entry point, route wiring
    │   ├── middleware/
    │   │   └── auth.ts         # session cookie check
    │   ├── routes/
    │   │   ├── auth.ts         # POST /login, POST /logout, GET /me
    │   │   ├── categories.ts   # CRUD /api/categories
    │   │   ├── clubs.ts        # CRUD /api/clubs (multipart for logo)
    │   │   ├── teams.ts        # CRUD /api/teams
    │   │   ├── matches.ts      # CRUD /api/matches
    │   │   ├── sets.ts         # PUT /:id, POST /:id/finish
    │   │   └── points.ts       # POST /, DELETE /:id
    │   └── db/
    │       ├── config.ts       # DB connection config from env vars
    │       ├── index.ts        # Drizzle client
    │       └── schema.ts       # all tables, enums, relations
    └── static/
        ├── input.css           # Tailwind source
        ├── style.css           # Tailwind compiled output
        ├── index.html          # watcher lobby
        ├── game.html           # watcher match detail
        ├── login.html          # manager login
        ├── images/             # static images (bg.png lives here)
        ├── uploads/            # club logo uploads (created at runtime)
        └── manager/
            ├── index.html      # match list + links
            ├── categories.html # category CRUD
            ├── clubs.html      # club CRUD with logo upload
            ├── teams.html      # team CRUD
            ├── match-form.html # create match
            └── game.html       # live scoring panel
```

## Data Model

```
Club        { id, name, logo? }             ← logo stored as /uploads/<filename>
Category    { id, name }
Team        { id, club_id, category_id, name }

Match       { id, team_home_id, team_away_id, category_id,
              scheduled_at, court, status }
              court:  enum (court1, court2)
              status: enum (upcoming, in_progress,
                            finished_home, finished_away, cancelled)

Set         { id, match_id, set_number, status }
              status: enum (in_progress, finished_home,
                            finished_away, cancelled)

Point       { id, set_id, score_home, score_away, home_scored }
              ← each row is a snapshot after a single point
              ← home_scored (bool): true if home team scored, false if away
```

**Intentionally excluded:**
- Automatic win detection (amateur tournaments use custom rulings)
- Standings/ranking calculation (left to human organizers)
- Bracket/playoff structure

## Environment Variables

All vars live in root `.env` (never committed). See `.env.example` for the full list.

| Variable | Used by | Notes |
|----------|---------|-------|
| `NGROK_AUTHTOKEN` | ngrok container | from ngrok dashboard |
| `PSQL_HOST/PORT/DATABASE` | app + drizzle | |
| `PSQL_ADMIN_USER/PASSWORD` | drizzle migrations | needs CREATE/ALTER rights |
| `PSQL_USER/PASSWORD` | app at runtime | limited to DML on public schema |
| `MANAGER_USER` | auth route | login username |
| `MANAGER_PASSWORD` | auth route | login password |
| `SESSION_SECRET` | auth middleware | any long random string |
| `COOKIE_SECURE` | auth route | `false` locally, `true` behind HTTPS |

## Build Plan

| Step | Goal | Status |
|------|------|--------|
| 1 | Bun + Hono server with a Tailwind welcome page | ✓ |
| 2 | Dockerize, add to Compose, test locally with port forwarding | ✓ |
| 3 | Add nginx reverse proxy layer, test locally | ✓ |
| 4 | Add ngrok layer, go public | ✓ |
| 4.5 | Environment config: `.env`, no hardcoded credentials | ✓ |
| 5 | PostgreSQL + Drizzle ORM | ✓ |
| 6 | App features: pages, match management, live scoring | ✓ |

## Common Commands

```bash
# Run locally (from backend/)
bun run dev

# Generate a new migration after schema changes
bun run db:generate    # from backend/ with env vars set

# Apply migrations
bun run db:migrate     # from backend/ with env vars set

# Or from root (avoids moving .env):
bun --env-file .env --cwd backend run db:generate
bun --env-file .env --cwd backend run db:migrate

# Start full stack
docker compose up --build

# Fix DB table permissions after a fresh migration (if scorer user gets permission denied)
docker exec volleyball_scorer_db psql -U admin -d scorer \
  -c "GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO scorer; \
      GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO scorer;"
```

## Known Gotchas

- `serveStatic('/*')` must be **last** in `index.ts` — routes registered after it are unreachable
- `GRANT ALL ON DATABASE` does not grant table-level access in PostgreSQL — the init script also runs `GRANT ON ALL TABLES/SEQUENCES` and sets `ALTER DEFAULT PRIVILEGES`
- `drizzle insert().returning()` returns an array — always destructure: `const [row] = await db.insert(...).returning()`
- `COOKIE_SECURE` must be `false` in local HTTP dev (ngrok uses HTTPS so set to `true` in prod)
- Club logos upload to `./static/uploads/` at runtime — that directory is created by `index.ts` on startup via `fs.mkdirSync`
- Background image: place at `backend/static/images/bg.png` — already referenced in `index.html`

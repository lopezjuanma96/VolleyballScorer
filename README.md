# VolleyballScorer 🏐

Real-time fixture and scoring web app for amateur volleyball tournaments. Designed to be shared publicly via a tunnel so watchers can follow live scores from their phones while one person manages the matches from a tablet or laptop.

## What it does

- **Public lobby** — lists all matches grouped by status (live, upcoming, finished), filterable by category
- **Match detail** — shows set scores and point-by-point history for any match
- **Manager panel** — authenticated area to create and manage everything: categories, clubs, teams, and matches
- **Live scoring** — add points one by one, or enter a final set score directly if tracking point-by-point isn't practical
- **Club logos** — shown next to team names in all views

## Tech stack

Bun · Hono · TypeScript · Tailwind CSS · Drizzle ORM · PostgreSQL · Docker Compose · nginx · ngrok

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) with the Compose plugin
- A free [ngrok account](https://ngrok.com/) and auth token (for public access)

## Setup

### 1. Clone and configure

```bash
git clone <repo-url>
cd VolleyballScorer
cp .env.example .env
```

Edit `.env` and fill in every value:

```env
NGROK_AUTHTOKEN=your_ngrok_token

PSQL_HOST=localhost
PSQL_PORT=5432
PSQL_DATABASE=scorer

PSQL_ADMIN_USER=admin
PSQL_ADMIN_PASSWORD=choose_a_strong_password

PSQL_USER=scorer
PSQL_PASSWORD=choose_a_strong_password

MANAGER_USER=manager
MANAGER_PASSWORD=choose_a_strong_password
SESSION_SECRET=any_long_random_string_here
COOKIE_SECURE=false        # keep false for local HTTP; set true if using HTTPS
```

### 2. Configure ngrok

Edit `ngrok/ngrok.yml` and set your desired tunnel. The app is accessible through the ngrok URL shown in the dashboard at `localhost:4040`.

### 3. Start the stack

```bash
docker compose up --build
```

This starts four containers: the Bun app, nginx (port 80), ngrok (port 4040), and PostgreSQL (port 5432).

### 4. Run migrations

With the stack running, open a second terminal and run:

```bash
bun --env-file .env --cwd backend run db:migrate
```

> If `bun` isn't in your PATH, use the full path: `~/.bun/bin/bun`

After migrating, grant table permissions to the app user:

```bash
docker exec volleyball_scorer_db psql -U admin -d scorer \
  -c "GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO scorer; \
      GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO scorer;"
```

> **Why?** PostgreSQL's `GRANT ON DATABASE` only allows connecting — it doesn't grant access to tables. This step gives the app user the read/write access it needs. A fresh stack created after this fix will do it automatically via the init script, but existing databases need the manual grant.

### 5. Add a background image (optional)

Place an image at `backend/static/images/bg.png`. It will appear as a faint watermark behind the public lobby. The directory needs to be created:

```bash
mkdir -p backend/static/images
```

## First run — manager workflow

Open the ngrok URL (or `http://localhost`) and navigate to `/login.html`. After logging in:

1. **Categorías** — add the tournament categories (e.g. Masculino A, Femenino B)
2. **Clubes** — add participating clubs, optionally uploading a logo for each
3. **Equipos** — add teams, assigning each one a club and category
4. **Nuevo partido** — create a match; the first set is created automatically

Then open **Gestionar** next to a match to start scoring.

## Scoring a match

From the manager game page (`/manager/game.html?id=X`):

- **Point by point** — tap `+ Local` or `+ Visitante` after each rally; tap `↩ Deshacer` to remove the last point
- **Final score** — enter the final set score in the two number fields and press the winner button; this records the score as a single point row and auto-creates the next set
- **Match status** — use the status buttons at the bottom to mark the overall match as in progress, finished, or cancelled

Watchers can follow along at the public URL (`/` and `/game.html?id=X`). The page does not auto-refresh yet — watchers need to reload manually.

## Development

To run the backend without Docker:

```bash
cd backend
bun run dev     # starts Hono with hot reload + Tailwind watch
```

Make sure PostgreSQL is running and the env vars are exported in your shell (or place a `.env` file inside `backend/`).

### Schema changes

After editing `backend/src/db/schema.ts`:

```bash
bun --env-file .env --cwd backend run db:generate
bun --env-file .env --cwd backend run db:migrate
```

Then re-run the `GRANT` command if running in Docker.

## Project layout

```
VolleyballScorer/
├── backend/
│   ├── src/
│   │   ├── index.ts           # app entry, route wiring
│   │   ├── middleware/auth.ts  # session cookie check
│   │   ├── routes/            # one file per resource
│   │   └── db/                # Drizzle schema, client, config
│   └── static/
│       ├── index.html         # public lobby
│       ├── game.html          # public match detail
│       ├── login.html         # manager login
│       └── manager/           # manager pages (auth-gated by API)
├── nginx/nginx.conf
├── ngrok/ngrok.yml
├── db/db_init/psql/           # runs once on fresh DB
└── docker-compose.yml
```

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
└── backend/
    ├── Dockerfile
    ├── package.json
    ├── src/
    │   └── index.ts            # Hono app entry point
    └── static/
        ├── input.css           # Tailwind source
        ├── style.css           # Tailwind compiled output
        └── index.html          # welcome page
```

## Data Model

```
Club        { id, name }
Category    { id, name }
Team        { id, club_id, category_id }          ← unique per club+category

Match       { id, team_home_id, team_away_id, category_id,
              date, court, status }
              court:  enum (court1, court2, ...)   ← fixed list per tournament
              status: enum (upcoming, in_progress,
                            finished_home, finished_away, cancelled)

Set         { id, match_id, set_number, status }
              status: enum (in_progress, finished_home,
                            finished_away, cancelled)

Point       { id, set_id, score_home, score_away, home_scored }
              ← each row is a snapshot after a single point
              ← home_scored (bool): true if home team scored, false if away
```

**Intentionally excluded for now:**
- Automatic win detection (amateur tournaments use custom rulings)
- Standings/ranking calculation (left to human organizers)
- Bracket/playoff structure

## Build Plan

| Step | Goal | Status |
|------|------|--------|
| 1 | Bun + Hono server with a Tailwind welcome page | ✓ |
| 2 | Dockerize, add to Compose, test locally with port forwarding | ✓ |
| 3 | Add nginx reverse proxy layer, test locally | ✓ |
| 4 | Add ngrok layer, go public | ✓ |
| 4.5 | Environment config: `.env`, no hardcoded credentials | ✓ |
| 5 | PostgreSQL + Drizzle ORM, Redis (optional) | ✓ |
| 6 | App features: pages, match management, live scoring | - |

## Notes for README

- `bun run db:migrate` reads `.env` from `backend/` by default. To run it from the root without moving the file:
  ```bash
  bun --env-file .env --cwd backend run db:migrate
  ```

## App Features (planned for Step 6+)

- Fixture/schedule view per category
- Live score tracking (sets + points)
- Team and category management (manager)
- Score correction (undo last point)
- Match and set status management

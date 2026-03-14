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

- **Watcher (public):** views live scores, fixtures, standings
- **Manager (authenticated):** creates/controls games, records scores

## Build Plan

| Step | Goal | Status |
|------|------|--------|
| 1 | Bun + Hono server with a Tailwind welcome page | ✓ |
| 2 | Dockerize, add to Compose, test locally with port forwarding | - |
| 3 | Add nginx reverse proxy layer, test locally | - |
| 4 | Add ngrok layer, go public, add HTTP basic auth, verify TLS | - |
| 4.5 | Environment config: `.env`, Docker secrets, no hardcoded credentials | - |
| 5 | PostgreSQL + Drizzle ORM, Redis (optional) | - |
| 6 | App features: data model, pages, standings, bracket | - |

## App Features (planned for Step 6+)

- Fixture/schedule view per category
- Live score tracking (sets + points)
- Standings/ranking table (auto-calculated)
- Bracket/playoff visualization
- Team and category management (admin)
- Score correction (undo)

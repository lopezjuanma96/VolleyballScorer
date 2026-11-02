import { Hono } from 'hono'
import { asc, eq, inArray } from 'drizzle-orm'
import { db } from '../db'
import { categories, clubs, matches, teams } from '../db/schema'
import { publicReads } from '../read-cache'
import { standings } from '../standings'

// Public table per category, computed from finished matches on each read and
// shared through the read cache, so it never drifts from the results.
const standingRoutes = new Hono()
standingRoutes.get('/', async c => {
    const categoryId = c.req.query('categoryId') ? Number(c.req.query('categoryId')) : null
    return c.body(await publicReads.get(`standings:${categoryId ?? ''}`, async () => {
        const selected = await db.select().from(categories).where(categoryId ? eq(categories.id, categoryId) : undefined).orderBy(asc(categories.name))
        if (!selected.length) return []
        const ids = selected.map(category => category.id)
        const [teamRows, matchRows] = await Promise.all([
            db.select({ id: teams.id, name: teams.name, categoryId: teams.categoryId, clubName: clubs.name, clubLogo: clubs.logo }).from(teams).innerJoin(clubs, eq(teams.clubId, clubs.id)).where(inArray(teams.categoryId, ids)),
            db.query.matches.findMany({
                where: inArray(matches.categoryId, ids),
                with: { sets: { with: { points: { orderBy: (p, { desc }) => [desc(p.id)], limit: 1 } } } },
            }),
        ])
        return selected.map(category => ({
            categoryId: category.id,
            categoryName: category.name,
            bestOf: category.bestOf,
            rows: standings(
                teamRows.filter(t => t.categoryId === category.id).map(({ categoryId: _, ...team }) => team),
                matchRows.filter(m => m.categoryId === category.id).map(m => ({ ...m, sets: m.sets.map(s => ({ status: s.status, scoreHome: s.points[0]?.scoreHome ?? 0, scoreAway: s.points[0]?.scoreAway ?? 0 })) })),
            ),
        }))
    }), 200, { 'Content-Type': 'application/json; charset=UTF-8' })
})
export default standingRoutes

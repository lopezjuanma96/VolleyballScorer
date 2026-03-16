import { Hono } from 'hono'
import { db } from '../db'
import { points } from '../db/schema'
import { eq, desc } from 'drizzle-orm'
import { authMiddleware } from '../middleware/auth'

const pointRoutes = new Hono()

pointRoutes.post('/', authMiddleware, async (c) => {
    const { setId, homeScored } = await c.req.json()

    const lastPoints = await db.select().from(points)
        .where(eq(points.setId, setId))
        .orderBy(desc(points.id))
        .limit(1)
    const last = lastPoints[0]

    const scoreHome = (last?.scoreHome ?? 0) + (homeScored ? 1 : 0)
    const scoreAway = (last?.scoreAway ?? 0) + (homeScored ? 0 : 1)

    const [row] = await db.insert(points).values({ setId, scoreHome, scoreAway, homeScored }).returning()
    return c.json(row, 201)
})

pointRoutes.delete('/:id', authMiddleware, async (c) => {
    const id = Number(c.req.param('id'))

    const [point] = await db.select().from(points).where(eq(points.id, id))
    if (!point) return c.json({ error: 'Not found' }, 404)

    const lastPoints = await db.select().from(points)
        .where(eq(points.setId, point.setId))
        .orderBy(desc(points.id))
        .limit(1)

    if (!lastPoints[0] || lastPoints[0].id !== id) {
        return c.json({ error: 'Can only delete the last point in a set' }, 400)
    }

    await db.delete(points).where(eq(points.id, id))
    return c.json({ ok: true })
})

export default pointRoutes

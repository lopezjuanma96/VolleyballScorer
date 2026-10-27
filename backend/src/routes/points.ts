import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { db } from '../db'
import { points } from '../db/schema'
import { eq, desc } from 'drizzle-orm'
import { authMiddleware } from '../middleware/auth'
import { lockActiveSet } from '../scoring'

const pointRoutes = new Hono()
pointRoutes.post('/', authMiddleware, async c => {
    const { setId, homeScored } = await c.req.json()
    const row = await db.transaction(async tx => {
        await lockActiveSet(tx, setId)
        const [last] = await tx.select().from(points).where(eq(points.setId, setId)).orderBy(desc(points.id)).limit(1)
        const [point] = await tx.insert(points).values({
            setId, homeScored,
            scoreHome: (last?.scoreHome ?? 0) + (homeScored ? 1 : 0),
            scoreAway: (last?.scoreAway ?? 0) + (homeScored ? 0 : 1),
        }).returning()
        return point
    })
    return c.json(row, 201)
})
pointRoutes.delete('/:id', authMiddleware, async c => {
    const id = Number(c.req.param('id'))
    await db.transaction(async tx => {
        const [point] = await tx.select().from(points).where(eq(points.id, id))
        if (!point) throw new HTTPException(404, { message: 'Punto no encontrado.' })
        await lockActiveSet(tx, point.setId)
        const [last] = await tx.select().from(points).where(eq(points.setId, point.setId)).orderBy(desc(points.id)).limit(1)
        if (last?.id !== id) throw new HTTPException(409, { message: 'Solo se puede deshacer el último punto.' })
        await tx.delete(points).where(eq(points.id, id))
    })
    return c.json({ ok: true })
})
export default pointRoutes

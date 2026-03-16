import { Hono } from 'hono'
import { db } from '../db'
import { teams } from '../db/schema'
import { eq, and } from 'drizzle-orm'
import { authMiddleware } from '../middleware/auth'

const teamRoutes = new Hono()

teamRoutes.get('/', async (c) => {
    const categoryId = c.req.query('categoryId')
    const clubId = c.req.query('clubId')

    const conditions = []
    if (categoryId) conditions.push(eq(teams.categoryId, Number(categoryId)))
    if (clubId) conditions.push(eq(teams.clubId, Number(clubId)))

    const rows = conditions.length > 0
        ? await db.select().from(teams).where(and(...conditions))
        : await db.select().from(teams)

    return c.json(rows)
})

teamRoutes.post('/', authMiddleware, async (c) => {
    const { clubId, categoryId, name } = await c.req.json()
    const [row] = await db.insert(teams).values({ clubId, categoryId, name }).returning()
    return c.json(row, 201)
})

teamRoutes.put('/:id', authMiddleware, async (c) => {
    const id = Number(c.req.param('id'))
    const { clubId, categoryId, name } = await c.req.json()
    const [row] = await db.update(teams).set({ clubId, categoryId, name }).where(eq(teams.id, id)).returning()
    if (!row) return c.json({ error: 'Not found' }, 404)
    return c.json(row)
})

teamRoutes.delete('/:id', authMiddleware, async (c) => {
    const id = Number(c.req.param('id'))
    const [row] = await db.delete(teams).where(eq(teams.id, id)).returning()
    if (!row) return c.json({ error: 'Not found' }, 404)
    return c.json({ ok: true })
})

export default teamRoutes

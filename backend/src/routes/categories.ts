import { Hono } from 'hono'
import { db } from '../db'
import { categories } from '../db/schema'
import { eq } from 'drizzle-orm'
import { authMiddleware } from '../middleware/auth'

const categoryRoutes = new Hono()

categoryRoutes.get('/', async (c) => {
    const rows = await db.select().from(categories)
    return c.json(rows)
})

categoryRoutes.post('/', authMiddleware, async (c) => {
    const { name } = await c.req.json()
    const [row] = await db.insert(categories).values({ name }).returning()
    return c.json(row, 201)
})

categoryRoutes.put('/:id', authMiddleware, async (c) => {
    const id = Number(c.req.param('id'))
    const { name } = await c.req.json()
    const [row] = await db.update(categories).set({ name }).where(eq(categories.id, id)).returning()
    if (!row) return c.json({ error: 'Not found' }, 404)
    return c.json(row)
})

categoryRoutes.delete('/:id', authMiddleware, async (c) => {
    const id = Number(c.req.param('id'))
    const [row] = await db.delete(categories).where(eq(categories.id, id)).returning()
    if (!row) return c.json({ error: 'Not found' }, 404)
    return c.json({ ok: true })
})

export default categoryRoutes

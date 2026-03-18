import { Hono } from 'hono'
import { db } from '../db'
import { clubs } from '../db/schema'
import { eq } from 'drizzle-orm'
import { authMiddleware } from '../middleware/auth'

const clubRoutes = new Hono()

clubRoutes.get('/', async (c) => {
    const rows = await db.select().from(clubs)
    return c.json(rows)
})

clubRoutes.post('/', authMiddleware, async (c) => {
    const body = await c.req.parseBody()
    const name = body['name'] as string
    let logo: string | undefined = undefined

    const file = body['logo']
    if (file && typeof file !== 'string') {
        const filename = `${Date.now()}_${(file as File).name}`
        await Bun.write(`./static/uploads/${filename}`, await (file as File).arrayBuffer())
        logo = `/uploads/${filename}`
    }

    const [row] = await db.insert(clubs).values({ name, logo }).returning()
    return c.json(row, 201)
})

clubRoutes.put('/:id', authMiddleware, async (c) => {
    const id = Number(c.req.param('id'))
    const body = await c.req.parseBody()
    const name = body['name'] as string
    let logo: string | undefined = undefined

    const file = body['logo']
    if (file && typeof file !== 'string') {
        const filename = `${Date.now()}_${(file as File).name}`
        await Bun.write(`./static/uploads/${filename}`, await (file as File).arrayBuffer())
        logo = `/uploads/${filename}`
    }

    const updates: { name: string; logo?: string } = { name }
    if (logo !== undefined) updates.logo = logo

    const [row] = await db.update(clubs).set(updates).where(eq(clubs.id, id)).returning()
    if (!row) return c.json({ error: 'Not found' }, 404)
    return c.json(row)
})

clubRoutes.delete('/:id', authMiddleware, async (c) => {
    const id = Number(c.req.param('id'))
    const [row] = await db.delete(clubs).where(eq(clubs.id, id)).returning()
    if (!row) return c.json({ error: 'Not found' }, 404)
    return c.json({ ok: true })
})

export default clubRoutes

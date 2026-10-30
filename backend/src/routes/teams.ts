import { Hono } from 'hono'
import { db } from '../db'
import { teams, matches } from '../db/schema'
import { HTTPException } from 'hono/http-exception'
import { eq, and, or } from 'drizzle-orm'
import { adminOnly } from '../middleware/auth'

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

teamRoutes.post('/', adminOnly, async (c) => {
    const { clubId, categoryId, name } = await c.req.json()
    const [row] = await db.insert(teams).values({ clubId, categoryId, name }).returning()
    return c.json(row, 201)
})

teamRoutes.put('/:id', adminOnly, async (c) => {
    const id = Number(c.req.param('id'))
    const { clubId, categoryId, name } = await c.req.json()
    const row = await db.transaction(async tx => {
        const [current] = await tx.select().from(teams).where(eq(teams.id, id)).for('update')
        if (!current) return null
        if (current.categoryId !== categoryId) {
            const [used] = await tx.select({ id: matches.id }).from(matches).where(or(eq(matches.teamHomeId, id), eq(matches.teamAwayId, id))).limit(1)
            if (used) throw new HTTPException(409, { message: 'Un equipo con partidos no puede cambiar de categoría.' })
        }
        const [updated] = await tx.update(teams).set({ clubId, categoryId, name }).where(eq(teams.id, id)).returning()
        return updated
    })
    if (!row) return c.json({ error: 'Not found' }, 404)
    return c.json(row)
})

teamRoutes.delete('/:id', adminOnly, async (c) => {
    const id = Number(c.req.param('id'))
    const [row] = await db.delete(teams).where(eq(teams.id, id)).returning()
    if (!row) return c.json({ error: 'Not found' }, 404)
    return c.json({ ok: true })
})

export default teamRoutes

import { Hono } from 'hono'
import { db } from '../db'
import { categories } from '../db/schema'
import { asc, eq } from 'drizzle-orm'
import { adminOnly } from '../middleware/auth'
import { publicReads } from '../read-cache'
import { categoryInput, categoryUpdate, rulesInput } from '../validation'
import { rulesOf } from '../rules'

const categoryRoutes = new Hono()

categoryRoutes.get('/', async (c) => {
    return c.body(await publicReads.get('categories', () => db.select().from(categories).orderBy(asc(categories.name))), 200, { 'Content-Type': 'application/json; charset=UTF-8' })
})

categoryRoutes.post('/', adminOnly, async (c) => {
    const [row] = await db.insert(categories).values(categoryInput.parse(await c.req.json())).returning()
    return c.json(row, 201)
})

// Rule changes apply to matches created afterwards; existing matches keep their copy.
categoryRoutes.put('/:id', adminOnly, async (c) => {
    const id = Number(c.req.param('id'))
    const patch = categoryUpdate.parse(await c.req.json())
    const row = await db.transaction(async tx => {
        const [current] = await tx.select().from(categories).where(eq(categories.id, id)).for('update')
        if (!current) return null
        // Validate the complete rule set, not only the fields sent.
        rulesInput.parse(rulesOf({ ...current, ...patch }))
        const [updated] = await tx.update(categories).set(patch).where(eq(categories.id, id)).returning()
        return updated
    })
    if (!row) return c.json({ error: 'Categoría no encontrada.' }, 404)
    return c.json(row)
})

categoryRoutes.delete('/:id', adminOnly, async (c) => {
    const id = Number(c.req.param('id'))
    const [row] = await db.delete(categories).where(eq(categories.id, id)).returning()
    if (!row) return c.json({ error: 'Categoría no encontrada.' }, 404)
    return c.json({ ok: true })
})

export default categoryRoutes

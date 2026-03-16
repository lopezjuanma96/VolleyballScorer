import { Hono } from 'hono'
import { db } from '../db'
import { sets, points } from '../db/schema'
import { eq } from 'drizzle-orm'
import { authMiddleware } from '../middleware/auth'

const setRoutes = new Hono()

setRoutes.put('/:id', authMiddleware, async (c) => {
    const id = Number(c.req.param('id'))
    const { status } = await c.req.json()

    const result = await db.transaction(async (tx) => {
        const [updated] = await tx.update(sets).set({ status }).where(eq(sets.id, id)).returning()
        if (!updated) return null

        if (status === 'finished_home' || status === 'finished_away') {
            const existingSets = await tx.select().from(sets).where(eq(sets.matchId, updated.matchId))
            const nextSetNumber = Math.max(...existingSets.map(s => s.setNumber)) + 1
            await tx.insert(sets).values({ matchId: updated.matchId, setNumber: nextSetNumber, status: 'in_progress' })
        }

        return updated
    })

    if (!result) return c.json({ error: 'Not found' }, 404)
    return c.json(result)
})

// Enter final score and mark set as finished
setRoutes.post('/:id/finish', authMiddleware, async (c) => {
    const id = Number(c.req.param('id'))
    const { scoreHome, scoreAway, status } = await c.req.json()
    // status must be 'finished_home' or 'finished_away'

    const result = await db.transaction(async (tx) => {
        const [currentSet] = await tx.select().from(sets).where(eq(sets.id, id))
        if (!currentSet) return null

        const homeScored = status === 'finished_home'

        await tx.insert(points).values({ setId: id, scoreHome, scoreAway, homeScored })

        const [updated] = await tx.update(sets).set({ status }).where(eq(sets.id, id)).returning()

        const allSets = await tx.select().from(sets).where(eq(sets.matchId, currentSet.matchId))
        const nextSetNumber = Math.max(...allSets.map(s => s.setNumber)) + 1
        await tx.insert(sets).values({ matchId: currentSet.matchId, setNumber: nextSetNumber, status: 'in_progress' })

        return updated
    })

    if (!result) return c.json({ error: 'Not found' }, 404)
    return c.json(result)
})

export default setRoutes

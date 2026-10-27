import { Hono } from 'hono'
import { db } from '../db'
import { sets, points } from '../db/schema'
import { eq } from 'drizzle-orm'
import { HTTPException } from 'hono/http-exception'
import { authMiddleware } from '../middleware/auth'
import { lockActiveSet } from '../scoring'

const setRoutes = new Hono()
async function transition(id: number, status: typeof sets.$inferSelect.status, score?: { scoreHome: number; scoreAway: number }) {
    if (status === 'in_progress') throw new HTTPException(400, { message: 'No se puede reabrir un set desde esta operación.' })
    return db.transaction(async tx => {
        const current = await lockActiveSet(tx, id)
        if (score) await tx.insert(points).values({ setId: id, ...score, homeScored: status === 'finished_home' })
        const [updated] = await tx.update(sets).set({ status }).where(eq(sets.id, id)).returning()
        const allSets = await tx.select().from(sets).where(eq(sets.matchId, current.matchId))
        // Cancellation also creates a replacement so the match remains playable.
        await tx.insert(sets).values({ matchId: current.matchId, setNumber: Math.max(...allSets.map(s => s.setNumber)) + 1 })
        return updated
    })
}
setRoutes.put('/:id', authMiddleware, async c => {
    const { status } = await c.req.json()
    return c.json(await transition(Number(c.req.param('id')), status))
})
setRoutes.post('/:id/finish', authMiddleware, async c => {
    const { scoreHome, scoreAway, status } = await c.req.json()
    // Tournament-specific scoring rules and match winners remain manual.
    return c.json(await transition(Number(c.req.param('id')), status, { scoreHome, scoreAway }))
})
export default setRoutes

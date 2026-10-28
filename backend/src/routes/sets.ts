import { Hono } from 'hono'
import { db } from '../db'
import { sets, points } from '../db/schema'
import { eq, desc } from 'drizzle-orm'
import { HTTPException } from 'hono/http-exception'
import { authMiddleware } from '../middleware/auth'
import { lockActiveSet } from '../scoring'

const setRoutes = new Hono()
async function transition(id: number, status: typeof sets.$inferSelect.status, expectedLastPointId: number | null, score?: { scoreHome: number; scoreAway: number }) {
    if (status === 'in_progress') throw new HTTPException(400, { message: 'No se puede reabrir un set desde esta operación.' })
    return db.transaction(async tx => {
        const current = await lockActiveSet(tx, id)
        const [last] = await tx.select().from(points).where(eq(points.setId, id)).orderBy(desc(points.id)).limit(1)
        if ((last?.id ?? null) !== expectedLastPointId) {
            throw new HTTPException(409, { message: `El marcador cambió a ${last?.scoreHome ?? 0}–${last?.scoreAway ?? 0}. Revisalo antes de cerrar o cancelar el set.` })
        }
        if (score) await tx.insert(points).values({ setId: id, ...score, homeScored: status === 'finished_home' })
        const [updated] = await tx.update(sets).set({ status }).where(eq(sets.id, id)).returning()
        const allSets = await tx.select().from(sets).where(eq(sets.matchId, current.matchId))
        // Cancellation also creates a replacement so the match remains playable.
        await tx.insert(sets).values({ matchId: current.matchId, setNumber: Math.max(...allSets.map(s => s.setNumber)) + 1 })
        return updated
    })
}
setRoutes.put('/:id', authMiddleware, async c => {
    const { status, expectedLastPointId } = await c.req.json()
    return c.json(await transition(Number(c.req.param('id')), status, expectedLastPointId))
})
setRoutes.post('/:id/finish', authMiddleware, async c => {
    const { scoreHome, scoreAway, status, expectedLastPointId } = await c.req.json()
    // Tournament-specific scoring rules and match winners remain manual.
    return c.json(await transition(Number(c.req.param('id')), status, expectedLastPointId, { scoreHome, scoreAway }))
})
export default setRoutes

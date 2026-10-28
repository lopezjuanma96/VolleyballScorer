import { Hono } from 'hono'
import { db } from '../db'
import { sets, points, matches, scoringAudit } from '../db/schema'
import { eq, desc } from 'drizzle-orm'
import { HTTPException } from 'hono/http-exception'
import { authMiddleware } from '../middleware/auth'
import { lockActiveSet, lockSet, type Transaction } from '../scoring'
import { config } from '../config'

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
        const [updated] = await tx.update(sets).set({ status, revision: current.revision + 1 }).where(eq(sets.id, id)).returning()
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

async function lastPoint(tx: Transaction, setId: number) {
    const [last] = await tx.select().from(points).where(eq(points.setId, setId)).orderBy(desc(points.id)).limit(1)
    return last
}
function snapshot(set: typeof sets.$inferSelect, last: typeof points.$inferSelect | undefined) {
    return { status: set.status, revision: set.revision, scoreHome: last?.scoreHome ?? 0, scoreAway: last?.scoreAway ?? 0, lastPointId: last?.id ?? null }
}
function checkSnapshot(before: ReturnType<typeof snapshot>, body: any) {
    if (before.status !== body.expectedStatus || before.revision !== body.expectedRevision || before.lastPointId !== body.expectedLastPointId) {
        throw new HTTPException(409, { message: 'El set cambió desde que lo abriste. Actualizá la pantalla y revisá la corrección.' })
    }
}
setRoutes.post('/:id/correct', authMiddleware, async c => {
    const id = Number(c.req.param('id'))
    const body = await c.req.json()
    const result = await db.transaction(async tx => {
        const { set } = await lockSet(tx, id)
        if (set.status === 'in_progress') throw new HTTPException(409, { message: 'Usá el marcador para modificar un set en juego.' })
        const before = snapshot(set, await lastPoint(tx, id))
        checkSnapshot(before, body)
        const [point] = await tx.insert(points).values({ setId: id, scoreHome: body.scoreHome, scoreAway: body.scoreAway, homeScored: body.status === 'finished_home' }).returning()
        const [updated] = await tx.update(sets).set({ status: body.status, revision: set.revision + 1 }).where(eq(sets.id, id)).returning()
        await tx.insert(scoringAudit).values({ matchId: set.matchId, setId: id, action: 'set_correction', actor: config.MANAGER_USER, reason: body.reason.trim(), before, after: snapshot(updated, point) })
        // Correcting a set never changes the official match winner or creates a new set.
        return updated
    })
    return c.json(result)
})
setRoutes.post('/:id/recover', authMiddleware, async c => {
    const id = Number(c.req.param('id'))
    const body = await c.req.json()
    const result = await db.transaction(async tx => {
        const { match, set } = await lockSet(tx, id)
        const before = snapshot(set, await lastPoint(tx, id))
        checkSnapshot(before, body)
        const allSets = await tx.select().from(sets).where(eq(sets.matchId, match.id))
        if (match.status !== body.expectedMatchStatus || match.status === 'in_progress' || set.status !== 'cancelled' || allSets.some(s => s.setNumber > set.setNumber || s.status === 'in_progress')) {
            throw new HTTPException(409, { message: 'Sólo se puede recuperar el último set cancelado de un partido detenido, sin otro set en juego.' })
        }
        const [updated] = await tx.update(sets).set({ status: 'in_progress', revision: set.revision + 1 }).where(eq(sets.id, id)).returning()
        await tx.update(matches).set({ status: 'in_progress' }).where(eq(matches.id, match.id))
        await tx.insert(scoringAudit).values({ matchId: match.id, setId: id, action: 'set_recovery', actor: config.MANAGER_USER, reason: body.reason.trim(), before: { ...before, matchStatus: match.status }, after: { ...snapshot(updated, await lastPoint(tx, id)), matchStatus: 'in_progress' } })
        return updated
    })
    return c.json(result)
})
export default setRoutes

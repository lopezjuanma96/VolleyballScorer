import { Hono } from 'hono'
import { db } from '../db'
import { sets, points, matches, scoringAudit, setLineups, substitutions } from '../db/schema'
import { and, asc, desc, eq } from 'drizzle-orm'
import { HTTPException } from 'hono/http-exception'
import { actor, adminOnly, getSession, scorerOnly } from '../middleware/auth'
import { closeSet, lastPoint, lockActiveSet, lockSet, setRotation, setsWon } from '../scoring'
import { finalScoreWinner, rulesOf } from '../rules'
import { lineupInput, substitutionInput } from '../validation'
import { substitutionsFit } from '../rotation'

const setRoutes = new Hono()
function checkLastPoint(last: typeof points.$inferSelect | undefined, expectedLastPointId: number | null) {
    if ((last?.id ?? null) !== expectedLastPointId) {
        throw new HTTPException(409, { message: `El marcador cambió a ${last?.scoreHome ?? 0}–${last?.scoreAway ?? 0}. Revisalo antes de cerrar o cancelar el set.` })
    }
}
// Cancelling is an administrative ruling; a replacement set keeps the match playable.
setRoutes.put('/:id', adminOnly, async c => {
    const { status, expectedLastPointId } = await c.req.json()
    if (status !== 'cancelled') throw new HTTPException(400, { message: 'Los sets se cierran con el marcador o con el resultado final.' })
    const id = Number(c.req.param('id'))
    return c.json(await db.transaction(async tx => {
        const { match, set } = await lockActiveSet(tx, id)
        const last = await lastPoint(tx, id)
        checkLastPoint(last, expectedLastPointId)
        const [updated] = await tx.update(sets).set({ status, revision: set.revision + 1 }).where(eq(sets.id, id)).returning()
        const allSets = await tx.select().from(sets).where(eq(sets.matchId, match.id))
        await tx.insert(sets).values({ matchId: match.id, setNumber: Math.max(...allSets.map(s => s.setNumber)) + 1, firstServeHome: set.firstServeHome })
        await tx.insert(scoringAudit).values({ matchId: match.id, setId: id, action: 'set_cancel', actor: await actor(c), reason: 'Set cancelado por la organización', before: { status: set.status, scoreHome: last?.scoreHome ?? 0, scoreAway: last?.scoreAway ?? 0 }, after: { status } })
        return updated
    }))
})
// Final score entered at once, for scorers who do not log every rally. It must be a
// valid final score under the match rules; the winner follows from it.
setRoutes.post('/:id/finish', scorerOnly, async c => {
    const { scoreHome, scoreAway, status, expectedLastPointId } = await c.req.json()
    const id = Number(c.req.param('id'))
    return c.json(await db.transaction(async tx => {
        const { match, set } = await lockActiveSet(tx, id)
        checkLastPoint(await lastPoint(tx, id), expectedLastPointId)
        const winner = finalScoreWinner(rulesOf(match), await setsWon(tx, match.id, id), scoreHome, scoreAway)
        if (!winner) throw new HTTPException(400, { message: `${scoreHome}–${scoreAway} no es un resultado final válido para las reglas de este partido.` })
        if (status && status !== `finished_${winner}`) throw new HTTPException(400, { message: 'El ganador indicado no coincide con el marcador.' })
        await tx.insert(points).values({ setId: id, scoreHome, scoreAway, homeScored: winner === 'home', kind: 'final' })
        return { id, ...await closeSet(tx, match, set, winner) }
    }))
})

function snapshot(set: typeof sets.$inferSelect, last: typeof points.$inferSelect | undefined) {
    return { status: set.status, revision: set.revision, scoreHome: last?.scoreHome ?? 0, scoreAway: last?.scoreAway ?? 0, lastPointId: last?.id ?? null }
}
function checkSnapshot(before: ReturnType<typeof snapshot>, body: any) {
    if (before.status !== body.expectedStatus || before.revision !== body.expectedRevision || before.lastPointId !== body.expectedLastPointId) {
        throw new HTTPException(409, { message: 'El set cambió desde que lo abriste. Actualizá la pantalla y revisá la corrección.' })
    }
}
setRoutes.post('/:id/correct', adminOnly, async c => {
    const id = Number(c.req.param('id'))
    const body = await c.req.json()
    const result = await db.transaction(async tx => {
        const { set } = await lockSet(tx, id)
        if (set.status === 'in_progress') throw new HTTPException(409, { message: 'Usá el marcador para modificar un set en juego.' })
        const before = snapshot(set, await lastPoint(tx, id))
        checkSnapshot(before, body)
        const [point] = await tx.insert(points).values({ setId: id, scoreHome: body.scoreHome, scoreAway: body.scoreAway, homeScored: body.status === 'finished_home', kind: 'correction' }).returning()
        const [updated] = await tx.update(sets).set({ status: body.status, revision: set.revision + 1 }).where(eq(sets.id, id)).returning()
        await tx.insert(scoringAudit).values({ matchId: set.matchId, setId: id, action: 'set_correction', actor: await actor(c), reason: body.reason.trim(), before, after: snapshot(updated, point) })
        // Correcting a set never changes the official match winner or creates a new set.
        return updated
    })
    return c.json(result)
})
setRoutes.post('/:id/recover', adminOnly, async c => {
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
        await tx.insert(scoringAudit).values({ matchId: match.id, setId: id, action: 'set_recovery', actor: await actor(c), reason: body.reason.trim(), before: { ...before, matchStatus: match.status }, after: { ...snapshot(updated, await lastPoint(tx, id)), matchStatus: 'in_progress' } })
        return updated
    })
    return c.json(result)
})

// Toss and starting lineups. Scorers edit them while the set is in play (the
// rotation is recomputed from the rallies); admins can also fix closed sets.
setRoutes.put('/:id/lineup', scorerOnly, async c => {
    const id = Number(c.req.param('id'))
    const body = lineupInput.parse(await c.req.json())
    const admin = (await getSession(c))!.role === 'admin'
    return c.json(await db.transaction(async tx => {
        const { match, set } = admin ? await lockSet(tx, id) : await lockActiveSet(tx, id)
        const changes = await tx.select().from(substitutions).where(eq(substitutions.setId, id)).orderBy(asc(substitutions.id))
        for (const side of ['home', 'away'] as const) {
            if (!substitutionsFit(body[side], changes.filter(c => c.side === side))) {
                throw new HTTPException(409, { message: `La formación de ${side === 'home' ? 'local' : 'visitante'} no coincide con los cambios ya registrados. Deshacé esos cambios primero.` })
            }
        }
        await tx.update(sets).set({ firstServeHome: body.firstServeHome }).where(eq(sets.id, id))
        for (const side of ['home', 'away'] as const) {
            const positions = body[side]
            await tx.delete(setLineups).where(and(eq(setLineups.setId, id), eq(setLineups.side, side)))
            if (positions) await tx.insert(setLineups).values({ setId: id, side, positions })
        }
        const { state } = await setRotation(tx, { ...set, firstServeHome: body.firstServeHome })
        await tx.insert(scoringAudit).values({ matchId: match.id, setId: id, action: 'set_lineup', actor: await actor(c), reason: 'Saque inicial y formación', before: {}, after: { firstServeHome: body.firstServeHome, home: body.home, away: body.away } })
        return { id, firstServeHome: body.firstServeHome, rotation: state }
    }))
})
setRoutes.post('/:id/substitutions', scorerOnly, async c => {
    const id = Number(c.req.param('id'))
    const body = substitutionInput.parse(await c.req.json())
    const row = await db.transaction(async tx => {
        const { set } = await lockActiveSet(tx, id)
        const { rallyCount, state } = await setRotation(tx, set)
        const court = state.positions[body.side]
        if (!court) throw new HTTPException(409, { message: 'Cargá primero la formación inicial de ese equipo.' })
        if (!court.includes(body.playerOut)) throw new HTTPException(409, { message: `El ${body.playerOut} no está en cancha.` })
        if (court.includes(body.playerIn)) throw new HTTPException(409, { message: `El ${body.playerIn} ya está en cancha.` })
        const [row] = await tx.insert(substitutions).values({ setId: id, side: body.side, afterRallies: rallyCount, playerOut: body.playerOut, playerIn: body.playerIn }).returning()
        return row
    })
    return c.json(row, 201)
})
// Only the latest change, and only before another rally is played.
setRoutes.delete('/:id/substitutions/:changeId', scorerOnly, async c => {
    const id = Number(c.req.param('id')), changeId = Number(c.req.param('changeId'))
    await db.transaction(async tx => {
        const { set } = await lockActiveSet(tx, id)
        const [latest] = await tx.select().from(substitutions).where(eq(substitutions.setId, id)).orderBy(desc(substitutions.id)).limit(1)
        const { rallyCount } = await setRotation(tx, set)
        if (latest?.id !== changeId || latest.afterRallies !== rallyCount) throw new HTTPException(409, { message: 'Solo se deshace el último cambio, antes del punto siguiente.' })
        await tx.delete(substitutions).where(eq(substitutions.id, changeId))
    })
    return c.json({ ok: true })
})
export default setRoutes

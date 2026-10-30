import { HTTPException } from 'hono/http-exception'
import { and, asc, desc, eq, gt, inArray } from 'drizzle-orm'
import { db } from './db'
import { matches, points, sets, setLineups, substitutions } from './db/schema'
import { matchWinner, rulesOf, setWinner, type SetsWon, type Side } from './rules'
import { rotationState } from './rotation'
export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Match = typeof matches.$inferSelect
type Set = typeof sets.$inferSelect

// Always lock match before set, also used by match status updates. Points and set
// transitions serialize across scorers without overwriting another rally.
export async function lockActiveSet(tx: Transaction, id: number) {
    const { match, set } = await lockSet(tx, id)
    if (match.status !== 'in_progress' || set.status !== 'in_progress') {
        throw new HTTPException(409, { message: 'El partido y el set deben estar en juego. Actualizá la pantalla.' })
    }
    return { match, set }
}

export async function lockSet(tx: Transaction, id: number) {
    const [lookup] = await tx.select().from(sets).where(eq(sets.id, id))
    if (!lookup) throw new HTTPException(404, { message: 'Set no encontrado.' })
    const [match] = await tx.select().from(matches).where(eq(matches.id, lookup.matchId)).for('update')
    const [set] = await tx.select().from(sets).where(eq(sets.id, id)).for('update')
    if (!match || !set) throw new HTTPException(404, { message: 'Partido no encontrado.' })
    return { match, set }
}

export async function lastPoint(tx: Transaction, setId: number) {
    const [last] = await tx.select().from(points).where(eq(points.setId, setId)).orderBy(desc(points.id)).limit(1)
    return last
}

// Sets won before `exclude`, counting only finished sets.
export async function setsWon(tx: Transaction, matchId: number, exclude?: number): Promise<SetsWon> {
    const rows = await tx.select({ id: sets.id, status: sets.status }).from(sets).where(eq(sets.matchId, matchId))
    const counted = rows.filter(s => s.id !== exclude)
    return { home: counted.filter(s => s.status === 'finished_home').length, away: counted.filter(s => s.status === 'finished_away').length }
}

export type Outcome = { setWinner: Side | null; matchWinner: Side | null }

// Closes the set for `winner`. Finishes the match when the rules say so, or opens
// the next set with the serve alternated from this one.
export async function closeSet(tx: Transaction, match: Match, set: Set, winner: Side): Promise<Outcome> {
    await tx.update(sets).set({ status: `finished_${winner}`, revision: set.revision + 1 }).where(eq(sets.id, set.id))
    const won = await setsWon(tx, match.id)
    const decided = matchWinner(rulesOf(match), won)
    if (decided) {
        await tx.update(matches).set({ status: `finished_${decided}` }).where(eq(matches.id, match.id))
        return { setWinner: winner, matchWinner: decided }
    }
    const all = await tx.select({ setNumber: sets.setNumber }).from(sets).where(eq(sets.matchId, match.id))
    await tx.insert(sets).values({ matchId: match.id, setNumber: Math.max(...all.map(s => s.setNumber)) + 1, firstServeHome: set.firstServeHome === null ? null : !set.firstServeHome })
    return { setWinner: winner, matchWinner: null }
}

export async function addRally(tx: Transaction, setId: number, homeScored: boolean) {
    const { match, set } = await lockActiveSet(tx, setId)
    const last = await lastPoint(tx, setId)
    const [point] = await tx.insert(points).values({
        setId, homeScored, kind: 'rally',
        scoreHome: (last?.scoreHome ?? 0) + (homeScored ? 1 : 0),
        scoreAway: (last?.scoreAway ?? 0) + (homeScored ? 0 : 1),
    }).returning()
    const winner = setWinner(rulesOf(match), await setsWon(tx, match.id, set.id), point.scoreHome, point.scoreAway)
    const outcome: Outcome = winner ? await closeSet(tx, match, set, winner) : { setWinner: null, matchWinner: null }
    return { point, ...outcome }
}

// Undo the latest rally or entered final score of the match. If that entry closed
// the set or the match, both reopen and the empty set created after it is removed.
export async function undoPoint(tx: Transaction, pointId: number) {
    const [lookup] = await tx.select().from(points).where(eq(points.id, pointId))
    if (!lookup) throw new HTTPException(404, { message: 'Punto no encontrado.' })
    const { match, set } = await lockSet(tx, lookup.setId)
    const last = await lastPoint(tx, set.id)
    if (last?.id !== pointId) throw new HTTPException(409, { message: 'Solo se puede deshacer el último punto.' })
    if (last.kind === 'correction') throw new HTTPException(409, { message: 'El último registro es una corrección administrativa; no se deshace desde el marcador.' })
    const later = await tx.select().from(sets).where(and(eq(sets.matchId, match.id), gt(sets.setNumber, set.setNumber))).for('update')
    const laterPoints = later.length ? await tx.select({ id: points.id }).from(points).where(inArray(points.setId, later.map(s => s.id))).limit(1) : []
    if (laterPoints.length || later.some(s => s.status !== 'in_progress')) throw new HTTPException(409, { message: 'El set siguiente ya empezó. Solo se deshace el último punto del partido.' })
    const rallies = await tx.select({ id: points.id }).from(points).where(and(eq(points.setId, set.id), eq(points.kind, 'rally')))
    const [change] = await tx.select({ id: substitutions.id }).from(substitutions).where(and(eq(substitutions.setId, set.id), gt(substitutions.afterRallies, rallies.length - (last.kind === 'rally' ? 1 : 0)))).limit(1)
    if (change) throw new HTTPException(409, { message: 'Hay un cambio registrado después de este punto. Deshacé primero el cambio.' })
    const open = match.status === 'in_progress' && set.status === 'in_progress'
    const closedBySet = set.status.startsWith('finished') && (match.status === 'in_progress' || (match.status.startsWith('finished') && later.length === 0))
    if (!open && !closedBySet) throw new HTTPException(409, { message: 'El partido y el set deben estar en juego. Actualizá la pantalla.' })
    if (later.length) await tx.delete(sets).where(inArray(sets.id, later.map(s => s.id)))
    if (!open) {
        await tx.update(sets).set({ status: 'in_progress', revision: set.revision + 1 }).where(eq(sets.id, set.id))
        if (match.status !== 'in_progress') await tx.update(matches).set({ status: 'in_progress' }).where(eq(matches.id, match.id))
    }
    await tx.delete(points).where(eq(points.id, pointId))
    return { reopenedSet: !open, reopenedMatch: match.status !== 'in_progress' }
}

// Current rotation of a set, rebuilt from its lineups, toss, rallies and substitutions.
export async function setRotation(tx: Transaction, set: Set) {
    const [lineups, rallies, changes] = await Promise.all([
        tx.select().from(setLineups).where(eq(setLineups.setId, set.id)),
        tx.select({ homeScored: points.homeScored }).from(points).where(and(eq(points.setId, set.id), eq(points.kind, 'rally'))).orderBy(asc(points.id)),
        tx.select().from(substitutions).where(eq(substitutions.setId, set.id)).orderBy(asc(substitutions.id)),
    ])
    return {
        rallyCount: rallies.length,
        state: rotationState({
            firstServeHome: set.firstServeHome,
            lineups: Object.fromEntries(lineups.map(l => [l.side, l.positions])),
            rallies: rallies.map(r => r.homeScored),
            substitutions: changes,
        }),
    }
}

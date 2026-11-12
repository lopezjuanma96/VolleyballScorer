import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { db } from '../db'
import { categories, matches, phases, points, sets, teams } from '../db/schema'
import { adminOnly } from '../middleware/auth'
import { publicReads } from '../read-cache'
import { planBracket, roundName, type PlannedMatch, type Source } from '../bracket'
import { rulesOf } from '../rules'
import { phaseInput, phasePreview, phaseUpdate } from '../validation'

// Knockout phases. The organization decides which teams go to each phase and in
// what seed order (usually from the standings, but not necessarily the first N);
// the bracket and its matches follow, and winners advance on their own.
const phaseRoutes = new Hono()

phaseRoutes.get('/', async c => {
    const categoryId = c.req.query('categoryId') ? Number(c.req.query('categoryId')) : null
    return c.body(await publicReads.get(`phases:${categoryId ?? ''}`, async () => {
        const rows = await db.select().from(phases).where(categoryId ? eq(phases.categoryId, categoryId) : undefined).orderBy(asc(phases.categoryId), asc(phases.id))
        const names = await teamNames(rows.flatMap(p => p.teamIds))
        const counts = await bracketSizes(rows.map(p => p.id))
        return rows.map(p => ({
            id: p.id, categoryId: p.categoryId, name: p.name, thirdPlace: p.thirdPlace, createdAt: p.createdAt,
            rounds: counts.get(p.id) ?? 0,
            teams: p.teamIds.map((id, i) => ({ seed: i + 1, id, name: names.get(id) ?? '—' })),
        }))
    }), 200, { 'Content-Type': 'application/json; charset=UTF-8' })
})

// The bracket a set of seeds produces, so the form can name, place and time each match.
phaseRoutes.post('/preview', adminOnly, async c => {
    const { teamIds, thirdPlace } = phasePreview.parse(await c.req.json())
    const names = await teamNames(teamIds)
    const bracket = planBracket(teamIds.length, thirdPlace)
    const labels = new Map(bracket.matches.map(m => [m.key, m.label]))
    const side = (source: Source) => 'seed' in source
        ? `${source.seed}. ${names.get(teamIds[source.seed - 1]) ?? '—'}`
        : `${source.loser ? 'Perdedor' : 'Ganador'} de ${labels.get(source.from)}`
    return c.json({
        rounds: bracket.rounds,
        thirdPlaceAvailable: bracket.thirdPlaceAvailable,
        matches: bracket.matches.map(m => ({ round: m.round, slot: m.slot, roundName: m.slot === 1 && m.round === bracket.rounds ? 'Tercer puesto' : roundName(m.round, bracket.rounds), label: m.label, home: side(m.home), away: side(m.away) })),
    })
})

phaseRoutes.post('/', adminOnly, async c => {
    const body = phaseInput.parse(await c.req.json())
    const bracket = planBracket(body.teamIds.length, body.thirdPlace)
    if (body.thirdPlace && !bracket.thirdPlaceAvailable) throw new HTTPException(400, { message: 'No hay tercer puesto: un equipo llega a la final sin jugar la semifinal.' })
    const details = new Map(body.matches.map(m => [`${m.round}-${m.slot}`, m]))
    if (details.size !== body.matches.length || bracket.matches.some(m => !details.has(m.key)) || details.size !== bracket.matches.length) {
        throw new HTTPException(400, { message: 'La llave cambió. Volvé a generar los partidos.' })
    }
    const phase = await db.transaction(async tx => {
        const [category] = await tx.select().from(categories).where(eq(categories.id, body.categoryId))
        if (!category) throw new HTTPException(404, { message: 'Categoría no encontrada.' })
        const selected = await tx.select({ id: teams.id }).from(teams).where(and(inArray(teams.id, body.teamIds), eq(teams.categoryId, body.categoryId))).for('share')
        if (selected.length !== body.teamIds.length) throw new HTTPException(400, { message: 'Los equipos deben pertenecer a la categoría de la fase.' })
        const [phase] = await tx.insert(phases).values({ categoryId: body.categoryId, name: body.name, teamIds: body.teamIds, thirdPlace: body.thirdPlace }).returning()
        const rules = body.rules ?? rulesOf(category)
        // Rounds in order, so every source match already has an id.
        const ids = new Map<string, number>()
        const team = (source: Source) => 'seed' in source ? body.teamIds[source.seed - 1] : null
        const from = (source: Source) => 'from' in source ? ids.get(source.from)! : null
        for (const planned of [...bracket.matches].sort((a, b) => a.round - b.round || a.slot - b.slot) as PlannedMatch[]) {
            const detail = details.get(planned.key)!
            const [match] = await tx.insert(matches).values({
                categoryId: body.categoryId, phaseId: phase.id, round: planned.round, slot: planned.slot,
                label: detail.label ?? planned.label, court: detail.court, scheduledAt: new Date(detail.scheduledAt),
                teamHomeId: team(planned.home), teamAwayId: team(planned.away),
                homeFromMatchId: from(planned.home), awayFromMatchId: from(planned.away),
                fromLosers: 'from' in planned.home && planned.home.loser,
                ...rules,
            }).returning()
            ids.set(planned.key, match.id)
            await tx.insert(sets).values({ matchId: match.id, setNumber: 1, status: 'in_progress' })
        }
        return phase
    })
    return c.json(phase, 201)
})

phaseRoutes.put('/:id', adminOnly, async c => {
    const { name } = phaseUpdate.parse(await c.req.json())
    const [row] = await db.update(phases).set({ name }).where(eq(phases.id, Number(c.req.param('id')))).returning()
    if (!row) return c.json({ error: 'Fase no encontrada.' }, 404)
    return c.json(row)
})

// Removes the phase with all its matches and their results.
phaseRoutes.delete('/:id', adminOnly, async c => {
    const id = Number(c.req.param('id'))
    await db.transaction(async tx => {
        const [phase] = await tx.select().from(phases).where(eq(phases.id, id)).for('update')
        if (!phase) throw new HTTPException(404, { message: 'Fase no encontrada.' })
        const rows = await tx.select({ id: matches.id }).from(matches).where(eq(matches.phaseId, id)).orderBy(asc(matches.id)).for('update')
        const matchIds = rows.map(m => m.id)
        if (matchIds.length) {
            const setIds = (await tx.select({ id: sets.id }).from(sets).where(inArray(sets.matchId, matchIds))).map(s => s.id)
            if (setIds.length) await tx.delete(points).where(inArray(points.setId, setIds))
            await tx.delete(sets).where(inArray(sets.matchId, matchIds))
            await tx.delete(matches).where(inArray(matches.id, matchIds))
        }
        await tx.delete(phases).where(eq(phases.id, id))
    })
    return c.json({ ok: true })
})

async function teamNames(ids: number[]) {
    if (!ids.length) return new Map<number, string>()
    const rows = await db.select({ id: teams.id, name: teams.name }).from(teams).where(inArray(teams.id, [...new Set(ids)]))
    return new Map(rows.map(t => [t.id, t.name]))
}

async function bracketSizes(ids: number[]) {
    if (!ids.length) return new Map<number, number>()
    const rows = await db.select({ phaseId: matches.phaseId, round: matches.round }).from(matches).where(inArray(matches.phaseId, ids))
    const rounds = new Map<number, number>()
    for (const row of rows) rounds.set(row.phaseId!, Math.max(rounds.get(row.phaseId!) ?? 0, row.round ?? 0))
    return rounds
}

export default phaseRoutes

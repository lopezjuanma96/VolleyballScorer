import { Hono } from 'hono'
import { db } from '../db'
import { matches, sets, points, teams, clubs, categories, scoringAudit } from '../db/schema'
import { HTTPException } from 'hono/http-exception'
import { eq, and, inArray, desc, type SQL } from 'drizzle-orm'
import { authMiddleware } from '../middleware/auth'
import { config } from '../config'
import { publicReads } from '../read-cache'

const matchRoutes = new Hono()

type MatchWithRelations = typeof matches.$inferSelect & {
    category: typeof categories.$inferSelect
    teamHome: typeof teams.$inferSelect & { club: typeof clubs.$inferSelect }
    teamAway: typeof teams.$inferSelect & { club: typeof clubs.$inferSelect }
    sets: (typeof sets.$inferSelect & { points: (typeof points.$inferSelect)[] })[]
}
function buildMatchShape(match: MatchWithRelations) {
    const setsWithScores = match.sets
        .sort((a, b) => a.setNumber - b.setNumber)
        .map((s) => {
            const lastPoint = s.points.length > 0 ? s.points[s.points.length - 1] : null
            return {
                id: s.id,
                setNumber: s.setNumber,
                status: s.status,
                revision: s.revision,
                scoreHome: lastPoint?.scoreHome ?? 0,
                scoreAway: lastPoint?.scoreAway ?? 0,
            }
        })

    return {
        id: match.id,
        categoryId: match.category.id,
        categoryName: match.category.name,
        court: match.court,
        scheduledAt: match.scheduledAt,
        status: match.status,
        teamHome: {
            id: match.teamHome.id,
            name: match.teamHome.name,
            clubName: match.teamHome.club.name,
            clubLogo: match.teamHome.club.logo ?? null,
        },
        teamAway: {
            id: match.teamAway.id,
            name: match.teamAway.name,
            clubName: match.teamAway.club.name,
            clubLogo: match.teamAway.club.logo ?? null,
        },
        sets: setsWithScores,
    }
}

const withClause = {
    category: true as const,
    teamHome: { with: { club: true as const } },
    teamAway: { with: { club: true as const } },
    sets: {
        orderBy: (s: any, { asc }: any) => [asc(s.setNumber)],
        with: {
            points: {
                orderBy: (p: any, { desc }: any) => [desc(p.id)],
                limit: 1,
            },
        },
    },
}

matchRoutes.get('/', async (c) => {
    const categoryId = c.req.query('categoryId')
    const status = c.req.query('status')

    const conditions: SQL[] = []
    if (categoryId) conditions.push(eq(matches.categoryId, Number(categoryId)))
    if (status) conditions.push(eq(matches.status, status as any))

    return c.body(await publicReads.get(`matches:${categoryId ? Number(categoryId) : ''}:${status ?? ''}`, async () => {
        const rows = await db.query.matches.findMany({
            where: conditions.length > 0 ? and(...conditions) : undefined,
            with: withClause,
        })

        return rows.map(buildMatchShape)
    }), 200, { 'Content-Type': 'application/json; charset=UTF-8' })
})

matchRoutes.get('/:id', async (c) => {
    const id = Number(c.req.param('id'))
    return c.body(await publicReads.get(`match:${id}`, async () => {
        const match = await db.query.matches.findFirst({
            where: eq(matches.id, id),
            with: { ...withClause, sets: { ...withClause.sets, with: { points: { orderBy: (p, { asc }) => [asc(p.id)] } } } },
        })

        if (!match) throw new HTTPException(404, { message: 'Partido no encontrado.' })

        const base = buildMatchShape(match)
        const sortedSets = [...match.sets].sort((a, b) => a.setNumber - b.setNumber)
        const setsWithPoints = base.sets.map((s, i) => ({
            ...s,
            points: sortedSets[i].points.map((p) => ({
                id: p.id,
                scoreHome: p.scoreHome,
                scoreAway: p.scoreAway,
                homeScored: p.homeScored,
            })),
        }))

        return { ...base, sets: setsWithPoints }
    }), 200, { 'Content-Type': 'application/json; charset=UTF-8' })
})

matchRoutes.get('/:id/history', authMiddleware, async c => {
    const id = Number(c.req.param('id'))
    return c.json(await db.select().from(scoringAudit).where(eq(scoringAudit.matchId, id)).orderBy(desc(scoringAudit.id)))
})

matchRoutes.post('/', authMiddleware, async (c) => {
    const { teamHomeId, teamAwayId, categoryId, court, scheduledAt } = await c.req.json()

    const result = await db.transaction(async (tx) => {
        await validateTeams(tx, teamHomeId, teamAwayId, categoryId)
        const [match] = await tx.insert(matches).values({
            teamHomeId, teamAwayId, categoryId, court,
            scheduledAt: new Date(scheduledAt),
        }).returning()
        await tx.insert(sets).values({ matchId: match.id, setNumber: 1, status: 'in_progress' })
        return match
    })

    return c.json(result, 201)
})

matchRoutes.put('/:id', authMiddleware, async (c) => {
    const id = Number(c.req.param('id'))
    const body = await c.req.json()

    const updates: Record<string, any> = {}
    if (body.status !== undefined) updates.status = body.status
    if (body.court !== undefined) updates.court = body.court
    if (body.scheduledAt !== undefined) updates.scheduledAt = new Date(body.scheduledAt)
    if (body.teamHomeId !== undefined) updates.teamHomeId = body.teamHomeId
    if (body.teamAwayId !== undefined) updates.teamAwayId = body.teamAwayId

    const row = await db.transaction(async tx => {
        const [current] = await tx.select().from(matches).where(eq(matches.id, id)).for('update')
        if (!current) return null
        await validateTeams(tx, updates.teamHomeId ?? current.teamHomeId, updates.teamAwayId ?? current.teamAwayId, current.categoryId)
        if (body.expectedStatus !== undefined && body.expectedStatus !== current.status) {
            throw new HTTPException(409, { message: 'El estado del partido cambió. Actualizá la pantalla.' })
        }
        if (body.status && body.status !== 'in_progress' && body.status !== 'upcoming') {
            const [active] = await tx.select().from(sets).where(and(eq(sets.matchId, id), eq(sets.status, 'in_progress'))).for('update')
            const [last] = active ? await tx.select().from(points).where(eq(points.setId, active.id)).orderBy(desc(points.id)).limit(1) : []
            const expected = body.expectedActiveSet
            if ((last && expected === undefined) || (expected !== undefined && (expected?.id !== active?.id || (expected?.lastPointId ?? null) !== (last?.id ?? null)))) {
                throw new HTTPException(409, { message: 'Hay un set activo o su marcador cambió. Revisalo y confirmá el cierre del partido.' })
            }
            if (active) {
                await tx.update(sets).set({ status: 'cancelled', revision: active.revision + 1 }).where(eq(sets.id, active.id))
                await tx.insert(scoringAudit).values({ matchId: id, setId: active.id, action: 'match_close', actor: config.MANAGER_USER, reason: 'Cierre manual del partido', before: { matchStatus: current.status, status: active.status, scoreHome: last?.scoreHome ?? 0, scoreAway: last?.scoreAway ?? 0 }, after: { matchStatus: body.status, status: 'cancelled' } })
            }
        }
        if (body.status === 'in_progress') {
            const allSets = await tx.select().from(sets).where(eq(sets.matchId, id))
            if (!allSets.some(s => s.status === 'in_progress')) {
                const latest = allSets.sort((a, b) => b.setNumber - a.setNumber)[0]
                const [last] = latest ? await tx.select().from(points).where(eq(points.setId, latest.id)).limit(1) : []
                if (latest?.status === 'cancelled' && last && body.startNewSet !== true) {
                    throw new HTTPException(409, { message: 'El último set cancelado conserva puntos. Recuperalo o confirmá que querés iniciar uno nuevo.' })
                }
                await tx.insert(sets).values({ matchId: id, setNumber: Math.max(0, ...allSets.map(s => s.setNumber)) + 1 })
            }
        }
        if (body.status && body.status !== current.status) {
            await tx.insert(scoringAudit).values({ matchId: id, action: 'match_status', actor: config.MANAGER_USER, reason: body.startNewSet ? 'Cambio manual de estado; iniciar un set nuevo' : 'Cambio manual de estado', before: { matchStatus: current.status }, after: { matchStatus: body.status } })
        }
        const [updated] = await tx.update(matches).set(updates).where(eq(matches.id, id)).returning()
        return updated
    })
    if (!row) return c.json({ error: 'Not found' }, 404)
    return c.json(row)
})

matchRoutes.delete('/:id', authMiddleware, async (c) => {
    const id = Number(c.req.param('id'))

    await db.transaction(async (tx) => {
        const [current] = await tx.select().from(matches).where(eq(matches.id, id)).for('update')
        if (!current) throw new HTTPException(404, { message: 'Partido no encontrado.' })
        const matchSets = await tx.select().from(sets).where(eq(sets.matchId, id))
        for (const s of matchSets) {
            await tx.delete(points).where(eq(points.setId, s.id))
        }
        await tx.delete(sets).where(eq(sets.matchId, id))
        await tx.delete(matches).where(eq(matches.id, id))
    })

    return c.json({ ok: true })
})

async function validateTeams(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], home: number, away: number, categoryId: number) {
    if (home === away) throw new HTTPException(400, { message: 'Elegí dos equipos distintos.' })
    const selected = await tx.select().from(teams).where(inArray(teams.id, [home, away])).for('share')
    if (![home, away].every(id => selected.some(t => t.id === id && t.categoryId === categoryId))) {
        throw new HTTPException(400, { message: 'Los equipos deben pertenecer a la categoría del partido.' })
    }
}
export default matchRoutes

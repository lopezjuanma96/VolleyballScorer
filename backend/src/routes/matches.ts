import { Hono } from 'hono'
import { db } from '../db'
import { matches, sets, points } from '../db/schema'
import { eq, and } from 'drizzle-orm'
import { authMiddleware } from '../middleware/auth'

const matchRoutes = new Hono()

function buildMatchShape(match: any) {
    const setsWithScores = (match.sets as any[])
        .sort((a: any, b: any) => a.setNumber - b.setNumber)
        .map((s: any) => {
            const lastPoint = s.points.length > 0 ? s.points[s.points.length - 1] : null
            return {
                id: s.id,
                setNumber: s.setNumber,
                status: s.status,
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
    category: true,
    teamHome: { with: { club: true } },
    teamAway: { with: { club: true } },
    sets: {
        orderBy: (s: any, { asc }: any) => [asc(s.setNumber)],
        with: {
            points: {
                orderBy: (p: any, { asc }: any) => [asc(p.id)],
            },
        },
    },
}

matchRoutes.get('/', async (c) => {
    const categoryId = c.req.query('categoryId')
    const status = c.req.query('status')

    const conditions = []
    if (categoryId) conditions.push(eq(matches.categoryId, Number(categoryId)))
    if (status) conditions.push(eq(matches.status, status as any))

    const rows = await db.query.matches.findMany({
        where: conditions.length > 0 ? and(...conditions) : undefined,
        with: withClause,
    })

    return c.json(rows.map(buildMatchShape))
})

matchRoutes.get('/:id', async (c) => {
    const id = Number(c.req.param('id'))

    const match = await db.query.matches.findFirst({
        where: eq(matches.id, id),
        with: withClause,
    })

    if (!match) return c.json({ error: 'Not found' }, 404)

    const base = buildMatchShape(match)
    const sortedSets = [...(match.sets as any[])].sort((a, b) => a.setNumber - b.setNumber)
    const setsWithPoints = base.sets.map((s, i) => ({
        ...s,
        points: sortedSets[i].points.map((p: any) => ({
            id: p.id,
            scoreHome: p.scoreHome,
            scoreAway: p.scoreAway,
            homeScored: p.homeScored,
        })),
    }))

    return c.json({ ...base, sets: setsWithPoints })
})

matchRoutes.post('/', authMiddleware, async (c) => {
    const { teamHomeId, teamAwayId, categoryId, court, scheduledAt } = await c.req.json()

    const result = await db.transaction(async (tx) => {
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

    const [row] = await db.update(matches).set(updates).where(eq(matches.id, id)).returning()
    if (!row) return c.json({ error: 'Not found' }, 404)
    return c.json(row)
})

matchRoutes.delete('/:id', authMiddleware, async (c) => {
    const id = Number(c.req.param('id'))

    await db.transaction(async (tx) => {
        const matchSets = await tx.select().from(sets).where(eq(sets.matchId, id))
        for (const s of matchSets) {
            await tx.delete(points).where(eq(points.setId, s.id))
        }
        await tx.delete(sets).where(eq(sets.matchId, id))
        await tx.delete(matches).where(eq(matches.id, id))
    })

    return c.json({ ok: true })
})

export default matchRoutes

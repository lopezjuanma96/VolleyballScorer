import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { eq, isNotNull } from 'drizzle-orm'
import { db } from '../db'
import { matches, scoringAudit } from '../db/schema'
import { getSession, scorerOnly } from '../middleware/auth'

// A match is scored by one member at a time. Anyone signed in can take a free match;
// only its holder releases it, except the organization, which can free a match left
// behind (a phone that died, someone who left) but cannot take it over in one step.
const claimRoutes = new Hono()
claimRoutes.use('*', scorerOnly)

// Names only: emails stay private. The match list and scoring page show who holds what.
claimRoutes.get('/', async c => {
    const { username } = (await getSession(c))!
    const rows = await db.select({ matchId: matches.id, claimedBy: matches.claimedBy, name: matches.claimedName, since: matches.claimedAt }).from(matches).where(isNotNull(matches.claimedBy))
    return c.json(rows.map(({ claimedBy, ...row }) => ({ ...row, mine: claimedBy === username })))
})

async function lockMatch(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], id: number) {
    const [match] = await tx.select().from(matches).where(eq(matches.id, id)).for('update')
    if (!match) throw new HTTPException(404, { message: 'Partido no encontrado.' })
    return match
}

claimRoutes.post('/:matchId', async c => {
    const session = (await getSession(c))!
    const id = Number(c.req.param('matchId'))
    await db.transaction(async tx => {
        const match = await lockMatch(tx, id)
        if (match.claimedBy === session.username) return
        if (match.claimedBy) throw new HTTPException(409, { message: `Este partido lo anota ${match.claimedName ?? 'otra persona'}. Pedile que lo libere.` })
        await tx.update(matches).set({ claimedBy: session.username, claimedName: session.displayName, claimedAt: new Date() }).where(eq(matches.id, id))
        await tx.insert(scoringAudit).values({ matchId: id, action: 'claim', actor: session.username, reason: 'Tomó el partido para anotarlo', before: {}, after: { holder: session.displayName } })
    })
    return c.json({ ok: true })
})

claimRoutes.post('/:matchId/release', async c => {
    const session = (await getSession(c))!
    const id = Number(c.req.param('matchId'))
    const { expectedHolder } = await c.req.json()
    await db.transaction(async tx => {
        const match = await lockMatch(tx, id)
        if (!match.claimedBy) return
        const mine = match.claimedBy === session.username
        if (!mine && session.role !== 'admin') throw new HTTPException(403, { message: 'Sólo quien anota el partido o la organización pueden liberarlo.' })
        // A forced release names the holder it means to remove, so it never frees a newer claim.
        if (!mine && expectedHolder !== match.claimedName) throw new HTTPException(409, { message: 'Cambió quién anota este partido. Revisalo antes de liberarlo.' })
        await tx.update(matches).set({ claimedBy: null, claimedName: null, claimedAt: null }).where(eq(matches.id, id))
        await tx.insert(scoringAudit).values({ matchId: id, action: mine ? 'release' : 'release_forced', actor: session.username,
            reason: mine ? 'Liberó el partido' : 'La organización liberó el partido', before: { holder: match.claimedName }, after: {} })
    })
    return c.json({ ok: true })
})
export default claimRoutes

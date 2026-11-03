import { Hono } from 'hono'
import { db } from '../db'
import { getSession, scorerOnly } from '../middleware/auth'
import { addRally, undoPoint } from '../scoring'

const pointRoutes = new Hono()
// A rally that completes a set or match closes it immediately under the match rules.
pointRoutes.post('/', scorerOnly, async c => {
    const { setId, homeScored, expectedLastPointId } = await c.req.json()
    const { username } = (await getSession(c))!
    const result = await db.transaction(tx => addRally(tx, setId, homeScored, expectedLastPointId, username))
    return c.json({ ...result.point, setWinner: result.setWinner, matchWinner: result.matchWinner }, 201)
})
pointRoutes.delete('/:id', scorerOnly, async c => {
    const { username } = (await getSession(c))!
    return c.json({ ok: true, ...await db.transaction(tx => undoPoint(tx, Number(c.req.param('id')), username)) })
})
export default pointRoutes

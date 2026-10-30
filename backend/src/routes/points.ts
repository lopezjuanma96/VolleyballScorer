import { Hono } from 'hono'
import { db } from '../db'
import { scorerOnly } from '../middleware/auth'
import { addRally, undoPoint } from '../scoring'

const pointRoutes = new Hono()
// A rally that completes a set or match closes it immediately under the match rules.
pointRoutes.post('/', scorerOnly, async c => {
    const { setId, homeScored } = await c.req.json()
    const result = await db.transaction(tx => addRally(tx, setId, homeScored))
    return c.json({ ...result.point, setWinner: result.setWinner, matchWinner: result.matchWinner }, 201)
})
pointRoutes.delete('/:id', scorerOnly, async c => {
    return c.json({ ok: true, ...await db.transaction(tx => undoPoint(tx, Number(c.req.param('id')))) })
})
export default pointRoutes

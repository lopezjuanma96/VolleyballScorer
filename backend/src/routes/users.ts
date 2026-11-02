import { Hono } from 'hono'
import { asc, eq, sql } from 'drizzle-orm'
import { db } from '../db'
import { users } from '../db/schema'
import { managerOnly } from '../middleware/auth'
import { config } from '../config'
import { userInput, userUpdate } from '../validation'

// Members are the Google emails allowed in, each with a role. Only the .env manager edits them.
const userRoutes = new Hono()
userRoutes.use('*', managerOnly)
const columns = { id: users.id, email: users.email, displayName: users.displayName, role: users.role, active: users.active, createdAt: users.createdAt }

userRoutes.get('/', async c => c.json({ bootstrapAdmin: config.MANAGER_USER, googleEnabled: config.googleEnabled, users: await db.select(columns).from(users).orderBy(asc(users.email)) }))
userRoutes.post('/', async c => {
    const body = userInput.parse(await c.req.json())
    const [row] = await db.insert(users).values({ email: body.email, displayName: body.displayName || body.email.split('@')[0]!, role: body.role }).returning(columns)
    return c.json(row, 201)
})
userRoutes.put('/:id', async c => {
    const id = Number(c.req.param('id'))
    const body = userUpdate.parse(await c.req.json())
    const values: Partial<typeof users.$inferInsert> = {}
    if (body.displayName) values.displayName = body.displayName
    if (body.email !== undefined) values.email = body.email
    if (body.role !== undefined) values.role = body.role
    if (body.active !== undefined) values.active = body.active
    // Any access change closes that person's open sessions.
    const revoke = body.email !== undefined || body.role !== undefined || body.active !== undefined
    const [row] = await db.update(users).set({ ...values, ...(revoke ? { sessionVersion: sql`${users.sessionVersion} + 1` } : {}) }).where(eq(users.id, id)).returning(columns)
    if (!row) return c.json({ error: 'Usuario no encontrado.' }, 404)
    return c.json(row)
})
userRoutes.delete('/:id', async c => {
    const [row] = await db.delete(users).where(eq(users.id, Number(c.req.param('id')))).returning({ id: users.id })
    if (!row) return c.json({ error: 'Usuario no encontrado.' }, 404)
    return c.json({ ok: true })
})
export default userRoutes

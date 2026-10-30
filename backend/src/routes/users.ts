import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { asc, eq, sql } from 'drizzle-orm'
import { db } from '../db'
import { users } from '../db/schema'
import { adminOnly, getSession } from '../middleware/auth'
import { config } from '../config'
import { userInput, userUpdate } from '../validation'

const userRoutes = new Hono()
userRoutes.use('*', adminOnly)
const columns = { id: users.id, username: users.username, displayName: users.displayName, role: users.role, active: users.active, createdAt: users.createdAt }

userRoutes.get('/', async c => c.json({ bootstrapAdmin: config.MANAGER_USER, users: await db.select(columns).from(users).orderBy(asc(users.username)) }))
userRoutes.post('/', async c => {
    const body = userInput.parse(await c.req.json())
    if (body.username === config.MANAGER_USER.toLowerCase()) throw new HTTPException(409, { message: 'Ese usuario está reservado para el administrador principal.' })
    const [row] = await db.insert(users).values({ username: body.username, displayName: body.displayName, role: body.role, passwordHash: await Bun.password.hash(body.password) }).returning(columns)
    return c.json(row, 201)
})
userRoutes.put('/:id', async c => {
    const id = Number(c.req.param('id'))
    const body = userUpdate.parse(await c.req.json())
    const session = (await getSession(c))!
    if (session.userId === id && (body.role === 'scorer' || body.active === false)) throw new HTTPException(409, { message: 'No podés quitarte el acceso de administración a vos mismo.' })
    const values: Partial<typeof users.$inferInsert> = {}
    if (body.displayName !== undefined) values.displayName = body.displayName
    if (body.role !== undefined) values.role = body.role
    if (body.active !== undefined) values.active = body.active
    if (body.password !== undefined) values.passwordHash = await Bun.password.hash(body.password)
    // Any access change closes that person's open sessions.
    const revoke = body.password !== undefined || body.role !== undefined || body.active !== undefined
    const [row] = await db.update(users).set({ ...values, ...(revoke ? { sessionVersion: sql`${users.sessionVersion} + 1` } : {}) }).where(eq(users.id, id)).returning(columns)
    if (!row) return c.json({ error: 'Usuario no encontrado.' }, 404)
    return c.json(row)
})
userRoutes.delete('/:id', async c => {
    const id = Number(c.req.param('id'))
    if ((await getSession(c))!.userId === id) throw new HTTPException(409, { message: 'No podés eliminar tu propio usuario.' })
    const [row] = await db.delete(users).where(eq(users.id, id)).returning({ id: users.id })
    if (!row) return c.json({ error: 'Usuario no encontrado.' }, 404)
    return c.json({ ok: true })
})
export default userRoutes

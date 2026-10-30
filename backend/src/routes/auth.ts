import { Hono } from 'hono'
import { z } from 'zod'
import { setCookie, deleteCookie } from 'hono/cookie'
import { timingSafeEqual } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { envAdmin, getSession, issueToken, scorerOnly, SESSION_SECONDS, type Session } from '../middleware/auth'
import { config } from '../config'
import { db } from '../db'
import { users } from '../db/schema'
import { bodyLimit } from 'hono/body-limit'
import { clientAddress, LoginLimiter } from '../login-limit'

const auth = new Hono<{ Bindings: { clientAddress?: string } }>()
const attempts = new LoginLimiter()
// Verifying against a fixed hash keeps unknown usernames as slow as wrong passwords.
const decoy = Bun.password.hash('decoy-password-for-timing')
// Bound request work separately from the per-client attempt quota.
auth.use('/login', bodyLimit({ maxSize: 4096, onError: c => c.json({ error: 'Solicitud de acceso demasiado grande.' }, 413) }))
const same = (a: unknown, b: string) => typeof a === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b))
auth.get('/me', scorerOnly, async c => {
    const { username, displayName, role } = (await getSession(c))!
    return c.json({ username, displayName, role })
})
auth.post('/login', async c => {
    const address = clientAddress(c.env?.clientAddress, c.req.header(config.CLIENT_IP_HEADER), config.TRUST_PROXY_HOPS)
    const retryAfter = attempts.consume(address)
    if (retryAfter) { c.header('Retry-After', String(retryAfter)); return c.json({ error: 'Demasiados intentos desde este cliente. Esperá un minuto.' }, 429) }
    const { username, password } = z.object({ username: z.string().max(100), password: z.string().max(1024) }).parse(await c.req.json())
    let session: Session | null = null, version = 0
    if (same(username, config.MANAGER_USER)) {
        // Same hashing work as database accounts, so timing does not reveal this username.
        await Bun.password.verify(password, await decoy)
        if (same(password, config.MANAGER_PASSWORD)) session = envAdmin()
    } else {
        const [user] = await db.select().from(users).where(eq(users.username, username.trim().toLowerCase()))
        const valid = await Bun.password.verify(password, user?.passwordHash ?? await decoy)
        if (user && valid && user.active) { session = { userId: user.id, username: user.username, displayName: user.displayName, role: user.role }; version = user.sessionVersion }
    }
    if (!session) return c.json({ error: 'Usuario o contraseña incorrectos.' }, 401)
    setCookie(c, 'session', await issueToken(session, version), { httpOnly: true, path: '/', secure: config.secureCookie, sameSite: 'Lax', maxAge: SESSION_SECONDS })
    return c.json({ username: session.username, displayName: session.displayName, role: session.role })
})
auth.post('/logout', c => {
    deleteCookie(c, 'session', { path: '/', secure: config.secureCookie })
    return c.json({ ok: true })
})
export default auth

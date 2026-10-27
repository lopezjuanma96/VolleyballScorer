import { Hono } from 'hono'
import { z } from 'zod'
import { setCookie, deleteCookie } from 'hono/cookie'
import { sign } from 'hono/jwt'
import { timingSafeEqual } from 'node:crypto'
import { authMiddleware } from '../middleware/auth'
import { config } from '../config'

const auth = new Hono()
// A bounded process-local limiter also works behind tunnels without trusting forwarded IPs.
let attempts = 0
let windowStart = Date.now()
const same = (a: unknown, b: string) => typeof a === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b))
auth.get('/me', authMiddleware, c => c.json({ ok: true }))
auth.post('/login', async c => {
    if (Date.now() - windowStart > 60_000) { attempts = 0; windowStart = Date.now() }
    if (++attempts > 30) { c.header('Retry-After', '60'); return c.json({ error: 'Demasiados intentos. Esperá un minuto.' }, 429) }
    const { username, password } = z.object({ username: z.string().max(100), password: z.string().max(1024) }).parse(await c.req.json())
    if (!same(username, config.MANAGER_USER) || !same(password, config.MANAGER_PASSWORD)) {
        return c.json({ error: 'Usuario o contraseña incorrectos.' }, 401)
    }
    const now = Math.floor(Date.now() / 1000)
    const token = await sign({ sub: config.MANAGER_USER, iat: now, exp: now + 60 * 60 * 12 }, config.SESSION_SECRET, 'HS256')
    setCookie(c, 'session', token, { httpOnly: true, path: '/', secure: config.secureCookie, sameSite: 'Lax', maxAge: 60 * 60 * 12 })
    return c.json({ ok: true })
})
auth.post('/logout', c => {
    deleteCookie(c, 'session', { path: '/', secure: config.secureCookie })
    return c.json({ ok: true })
})
export default auth

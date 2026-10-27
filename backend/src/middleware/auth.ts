import type { Context, Next } from 'hono'
import { getCookie } from 'hono/cookie'
import { verify } from 'hono/jwt'
import { config } from '../config'

export async function isAuthenticated(c: Context) {
    const token = getCookie(c, 'session')
    if (!token) return false
    try {
        const payload = await verify(token, config.SESSION_SECRET, 'HS256')
        return payload.sub === config.MANAGER_USER && typeof payload.exp === 'number'
    } catch { return false }
}
export async function authMiddleware(c: Context, next: Next) {
    if (!await isAuthenticated(c)) return c.json({ error: 'Iniciá sesión para continuar.' }, 401)
    await next()
}

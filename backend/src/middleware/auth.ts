import { Context, Next } from 'hono'
import { getCookie } from 'hono/cookie'

export async function authMiddleware(c: Context, next: Next) {
    const session = getCookie(c, 'session')
    if (!session || session !== process.env.SESSION_SECRET) {
        return c.json({ error: 'Unauthorized' }, 401)
    }
    await next()
}

import { Hono } from 'hono'
import { setCookie, deleteCookie } from 'hono/cookie'
import { authMiddleware } from '../middleware/auth'

const auth = new Hono()

auth.get('/me', authMiddleware, (c) => {
    return c.json({ ok: true })
})

auth.post('/login', async (c) => {
    const { username, password } = await c.req.json()
    if (username !== process.env.MANAGER_USER || password !== process.env.MANAGER_PASSWORD) {
        return c.json({ error: 'Invalid credentials' }, 401)
    }
    setCookie(c, 'session', process.env.SESSION_SECRET!, {
        httpOnly: true,
        path: '/',
        secure: process.env.COOKIE_SECURE === 'true',
        sameSite: 'Lax',
        maxAge: 60 * 60 * 24 * 7,
    })
    return c.json({ ok: true })
})

auth.post('/logout', (c) => {
    deleteCookie(c, 'session', { path: '/' })
    return c.json({ ok: true })
})

export default auth

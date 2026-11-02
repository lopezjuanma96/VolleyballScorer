import type { Context, Next } from 'hono'
import { getCookie } from 'hono/cookie'
import { sign, verify } from 'hono/jwt'
import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { config } from '../config'
import { db } from '../db'
import { users } from '../db/schema'

export type Role = 'admin' | 'scorer'
export type Session = { userId: number | null; username: string; displayName: string; role: Role }
export const SESSION_SECONDS = 60 * 60 * 12

// The .env manager is the bootstrap admin. Its sessions end when the password changes.
const envVersion = createHash('sha256').update(`${config.MANAGER_PASSWORD}\0${config.SESSION_SECRET}`).digest('hex').slice(0, 16)
const envSubject = `env:${config.MANAGER_USER}`

export function envAdmin(): Session {
    return { userId: null, username: config.MANAGER_USER, displayName: config.MANAGER_USER, role: 'admin' }
}

export async function issueToken(session: Session, sessionVersion = 0) {
    const now = Math.floor(Date.now() / 1000)
    const sub = session.userId === null ? envSubject : `user:${session.userId}`
    return sign({ sub, ver: session.userId === null ? envVersion : sessionVersion, iat: now, exp: now + SESSION_SECONDS }, config.SESSION_SECRET, 'HS256')
}

const sessions = new WeakMap<Request, Session | null>()
// Role and access are read from the database on every request, so revoking a
// user or changing their role reaches sessions that are already open.
export async function getSession(c: Context): Promise<Session | null> {
    if (sessions.has(c.req.raw)) return sessions.get(c.req.raw)!
    let session: Session | null = null
    const token = getCookie(c, 'session')
    if (token) {
        try {
            const payload = await verify(token, config.SESSION_SECRET, 'HS256')
            if (payload.sub === envSubject && payload.ver === envVersion) session = envAdmin()
            const id = typeof payload.sub === 'string' && /^user:\d+$/.test(payload.sub) ? Number(payload.sub.slice(5)) : null
            if (id !== null) {
                const [user] = await db.select().from(users).where(eq(users.id, id))
                if (user?.active && user.sessionVersion === payload.ver) session = { userId: user.id, username: user.username, displayName: user.displayName, role: user.role }
            }
        } catch { session = null }
    }
    sessions.set(c.req.raw, session)
    return session
}

export const isAuthenticated = async (c: Context) => (await getSession(c)) !== null

function requireRole(...roles: Role[]) {
    return async (c: Context, next: Next) => {
        const session = await getSession(c)
        if (!session) return c.json({ error: 'Iniciá sesión para continuar.' }, 401)
        if (!roles.includes(session.role)) return c.json({ error: 'Tu usuario no tiene permiso para esta acción.' }, 403)
        await next()
    }
}
// Scorers run matches: start, rallies, undo, lineups and set results.
export const scorerOnly = requireRole('admin', 'scorer')
// Admins also manage fixture, categories, rules, teams, users and rulings.
export const adminOnly = requireRole('admin')

export async function actor(c: Context) {
    return (await getSession(c))?.username ?? 'desconocido'
}

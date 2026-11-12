import type { Context, Next } from 'hono'
import { getCookie } from 'hono/cookie'
import { sign, verify } from 'hono/jwt'
import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { config } from '../config'
import { db } from '../db'
import { users } from '../db/schema'

export type Role = 'admin' | 'scorer'
// userId is null only for the .env manager. username is the manager name or the member's email.
// viaToken marks a short-lived API token (Authorization: Bearer) used by scripts.
export type Session = { userId: number | null; username: string; displayName: string; role: Role; viaToken?: boolean }
export const SESSION_SECONDS = 60 * 60 * 12
export const API_TOKEN_MAX_HOURS = 12

// The .env manager is the bootstrap admin. Its sessions end when the password changes.
const envVersion = createHash('sha256').update(`${config.MANAGER_PASSWORD}\0${config.SESSION_SECRET}`).digest('hex').slice(0, 16)
const envSubject = `env:${config.MANAGER_USER}`

export function envAdmin(): Session {
    return { userId: null, username: config.MANAGER_USER, displayName: config.MANAGER_USER, role: 'admin' }
}

export function memberSession(user: { id: number; email: string; displayName: string; role: Role }): Session {
    return { userId: user.id, username: user.email, displayName: user.displayName, role: user.role }
}
// API tokens never manage users, even when the manager issued them.
export const isManager = (session: Session | null) => session?.userId === null && !session.viaToken

export async function issueToken(session: Session, sessionVersion = 0) {
    const now = Math.floor(Date.now() / 1000)
    const sub = session.userId === null ? envSubject : `user:${session.userId}`
    return sign({ sub, ver: session.userId === null ? envVersion : sessionVersion, iat: now, exp: now + SESSION_SECONDS }, config.SESSION_SECRET, 'HS256')
}

// Same subject and version as the browser session, so the same revocations apply:
// a password change ends manager tokens; any access change in Usuarios ends a member's.
export async function issueApiToken(session: Session, sessionVersion: number, hours: number) {
    const now = Math.floor(Date.now() / 1000)
    const exp = now + hours * 3600
    const sub = session.userId === null ? envSubject : `user:${session.userId}`
    const token = await sign({ typ: 'api', sub, ver: session.userId === null ? envVersion : sessionVersion, iat: now, exp }, config.SESSION_SECRET, 'HS256')
    return { token, expiresAt: new Date(exp * 1000).toISOString() }
}

function bearer(c: Context) {
    const header = c.req.header('Authorization')
    return header?.startsWith('Bearer ') ? header.slice(7).trim() : null
}

const sessions = new WeakMap<Request, Session | null>()
// Role and access are read from the database on every request, so revoking a
// user or changing their role reaches sessions that are already open.
export async function getSession(c: Context): Promise<Session | null> {
    if (sessions.has(c.req.raw)) return sessions.get(c.req.raw)!
    let session: Session | null = null
    // A Bearer header must carry an API token and a cookie a browser session; never the other way.
    const api = bearer(c)
    const token = api ?? getCookie(c, 'session')
    if (token) {
        try {
            const payload = await verify(token, config.SESSION_SECRET, 'HS256')
            if ((payload.typ === 'api') !== (api !== null)) throw new Error('wrong token type')
            if (payload.sub === envSubject && payload.ver === envVersion) session = envAdmin()
            const id = typeof payload.sub === 'string' && /^user:\d+$/.test(payload.sub) ? Number(payload.sub.slice(5)) : null
            if (id !== null) {
                const [user] = await db.select().from(users).where(eq(users.id, id))
                if (user?.active && user.sessionVersion === payload.ver) session = memberSession(user)
            }
            if (session && api) session = { ...session, viaToken: true }
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
// Admins also manage fixture, categories, rules, teams and rulings.
export const adminOnly = requireRole('admin')
// Only the .env manager manages members, so no Google account can grant access.
export async function managerOnly(c: Context, next: Next) {
    const session = await getSession(c)
    if (!session) return c.json({ error: 'Iniciá sesión para continuar.' }, 401)
    if (!isManager(session)) return c.json({ error: 'Sólo el administrador principal gestiona usuarios.' }, 403)
    await next()
}

export async function actor(c: Context) {
    return (await getSession(c))?.username ?? 'desconocido'
}

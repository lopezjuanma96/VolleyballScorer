import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { setCookie, deleteCookie, getCookie } from 'hono/cookie'
import { sign, verify } from 'hono/jwt'
import { timingSafeEqual } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { adminOnly, API_TOKEN_MAX_HOURS, envAdmin, getSession, isManager, issueApiToken, issueToken, memberSession, scorerOnly, SESSION_SECONDS, type Session } from '../middleware/auth'
import { config } from '../config'
import { db } from '../db'
import { users } from '../db/schema'
import { bodyLimit } from 'hono/body-limit'
import { clientAddress, LoginLimiter } from '../login-limit'
import { authorizationUrl, exchangeCode, randomToken, verifiedEmail } from '../google'

const auth = new Hono<{ Bindings: { clientAddress?: string } }>()
const attempts = new LoginLimiter()
const limited = (c: Context) => attempts.consume(clientAddress(c.env?.clientAddress, c.req.header(config.CLIENT_IP_HEADER), config.TRUST_PROXY_HOPS))
// Verifying against a fixed hash keeps the password check equally slow for every username.
const decoy = Bun.password.hash('decoy-password-for-timing')
// Bound request work separately from the per-client attempt quota.
auth.use('/login', bodyLimit({ maxSize: 4096, onError: c => c.json({ error: 'Solicitud de acceso demasiado grande.' }, 413) }))
const same = (a: unknown, b: string) => typeof a === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b))
const startSession = async (c: Context, session: Session, version = 0) =>
    setCookie(c, 'session', await issueToken(session, version), { httpOnly: true, path: '/', secure: config.secureCookie, sameSite: 'Lax', maxAge: SESSION_SECONDS })

auth.get('/me', scorerOnly, async c => {
    const session = (await getSession(c))!
    return c.json({ username: session.username, displayName: session.displayName, role: session.role, manager: isManager(session) })
})
// Password login is only for the .env manager (page /manager_login). Members use Google.
auth.post('/login', async c => {
    const retryAfter = limited(c)
    if (retryAfter) { c.header('Retry-After', String(retryAfter)); return c.json({ error: 'Demasiados intentos desde este cliente. Esperá un minuto.' }, 429) }
    const { username, password } = z.object({ username: z.string().max(100), password: z.string().max(1024) }).parse(await c.req.json())
    await Bun.password.verify(password, await decoy)
    if (!same(username, config.MANAGER_USER) || !same(password, config.MANAGER_PASSWORD)) return c.json({ error: 'Usuario o contraseña incorrectos.' }, 401)
    const session = envAdmin()
    await startSession(c, session)
    return c.json({ username: session.username, displayName: session.displayName, role: session.role, manager: true })
})
// Short-lived token for scripts (bulk imports, fixture generation), sent as
// Authorization: Bearer. Only from a browser session: a token cannot extend itself.
auth.post('/token', adminOnly, async c => {
    const session = (await getSession(c))!
    if (session.viaToken) return c.json({ error: 'Generá el token desde una sesión del navegador.' }, 403)
    const { hours } = z.object({ hours: z.number().int().min(1).max(API_TOKEN_MAX_HOURS).default(2) }).parse(await c.req.json().catch(() => ({})))
    let version = 0
    if (session.userId !== null) {
        const [user] = await db.select({ sessionVersion: users.sessionVersion }).from(users).where(eq(users.id, session.userId))
        if (!user) return c.json({ error: 'Usuario no encontrado.' }, 404)
        version = user.sessionVersion
    }
    const issued = await issueApiToken(session, version, hours)
    console.log(`API token issued to ${session.username} until ${issued.expiresAt}`)
    c.header('Cache-Control', 'no-store')
    return c.json(issued, 201)
})
auth.post('/logout', c => {
    deleteCookie(c, 'session', { path: '/', secure: config.secureCookie })
    return c.json({ ok: true })
})

// Local testing without Google (DEV_LOGIN=true, refused outside DEPLOY_MODE=local):
// signs in as an active member by email so two people can be simulated on one machine.
auth.post('/dev-login', async c => {
    if (!config.devLogin) return c.json({ error: 'Not found' }, 404)
    const { email } = z.object({ email: z.string().trim().toLowerCase().max(254) }).parse(await c.req.json())
    const [user] = await db.select().from(users).where(eq(users.email, email))
    if (!user?.active) return c.json({ error: 'No hay un usuario activo con ese email. Cargalo en Usuarios.' }, 401)
    await startSession(c, memberSession(user), user.sessionVersion)
    return c.json({ ok: true })
})

// --- Google sign-in ---
const FLOW_COOKIE = 'google_flow'
const FLOW_PATH = '/api/auth/google'
const FLOW_SECONDS = 600
const origin = (c: Context) => config.PUBLIC_URL ? new URL(config.PUBLIC_URL).origin : new URL(c.req.url).origin
const callbackUrl = (c: Context) => `${origin(c)}${FLOW_PATH}/callback`
const loginError = (c: Context, code: 'no-member' | 'unavailable' | 'failed') => c.redirect(`/login.html?error=${code}`)

auth.get('/google', async c => {
    if (!config.googleEnabled) return loginError(c, 'unavailable')
    const state = randomToken(), nonce = randomToken(), verifier = randomToken()
    // The flow secrets travel in a short-lived signed cookie bound to this browser.
    const flow = await sign({ typ: 'google_flow', state, nonce, verifier, exp: Math.floor(Date.now() / 1000) + FLOW_SECONDS }, config.SESSION_SECRET, 'HS256')
    setCookie(c, FLOW_COOKIE, flow, { httpOnly: true, path: FLOW_PATH, secure: config.secureCookie, sameSite: 'Lax', maxAge: FLOW_SECONDS })
    return c.redirect(authorizationUrl(config.GOOGLE_CLIENT_ID!, callbackUrl(c), state, nonce, verifier))
})
auth.get('/google/callback', async c => {
    if (!config.googleEnabled) return loginError(c, 'unavailable')
    if (limited(c)) return loginError(c, 'failed')
    const cookie = getCookie(c, FLOW_COOKIE)
    deleteCookie(c, FLOW_COOKIE, { path: FLOW_PATH, secure: config.secureCookie })
    const code = c.req.query('code'), state = c.req.query('state')
    if (!cookie || !code || !state || code.length > 2048) return loginError(c, 'failed')
    let flow: Record<string, unknown>
    try { flow = await verify(cookie, config.SESSION_SECRET, 'HS256') } catch { return loginError(c, 'failed') }
    if (flow.typ !== 'google_flow' || typeof flow.state !== 'string' || !same(state, flow.state)) return loginError(c, 'failed')
    const claims = await exchangeCode({ clientId: config.GOOGLE_CLIENT_ID!, clientSecret: config.GOOGLE_CLIENT_SECRET! }, code, String(flow.verifier), callbackUrl(c)).catch(() => null)
    const email = claims && verifiedEmail(claims, { clientId: config.GOOGLE_CLIENT_ID!, nonce: String(flow.nonce) })
    if (!email) return loginError(c, 'failed')
    const [user] = await db.select().from(users).where(eq(users.email, email))
    if (!user?.active) return loginError(c, 'no-member')
    await startSession(c, memberSession(user), user.sessionVersion)
    return c.redirect('/manager/')
})
export default auth

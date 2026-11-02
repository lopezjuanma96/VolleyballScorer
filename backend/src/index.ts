import { Hono } from 'hono'
import { serveStatic } from 'hono/bun'
import { secureHeaders } from 'hono/secure-headers'
import { bodyLimit } from 'hono/body-limit'
import { HTTPException } from 'hono/http-exception'
import { z, ZodError } from 'zod'
import { mkdirSync } from 'node:fs'
import { sql } from 'drizzle-orm'
import { db } from './db'
import { config } from './config'
import { getSession } from './middleware/auth'
import { validateRequest } from './validation'
import { liveRoutes, publishChange } from './live'
import authRoutes from './routes/auth'
import categoryRoutes from './routes/categories'
import clubRoutes from './routes/clubs'
import teamRoutes from './routes/teams'
import matchRoutes from './routes/matches'
import setRoutes from './routes/sets'
import pointRoutes from './routes/points'
import standingRoutes from './routes/standings'
import userRoutes from './routes/users'
import { publicReads } from './read-cache'

// Validation messages reach the UI; custom messages in validation.ts take precedence.
z.config(z.locales.es())
const fieldNames: Record<string, string> = { bestOf: 'Sets', setPoints: 'Puntos por set', tiebreakPoints: 'Puntos del desempate', minLead: 'Diferencia mínima', pointCap: 'Tope de puntos', username: 'Usuario', password: 'Contraseña', displayName: 'Nombre', name: 'Nombre', home: 'Formación local', away: 'Formación visitante', reason: 'Motivo' }
mkdirSync(config.UPLOAD_DIR, { recursive: true })
const app = new Hono()
app.use('*', secureHeaders())
app.use('/api/*', bodyLimit({ maxSize: 2 * 1024 * 1024 + 8192, onError: c => c.json({ error: 'El archivo supera 2 MB.' }, 413) }))
app.use('/api/*', async (c, next) => {
    c.header('Cache-Control', 'no-store')
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
        const origin = c.req.header('Origin')
        const expected = config.PUBLIC_URL ? new URL(config.PUBLIC_URL).origin : new URL(c.req.url).origin
        if (origin && origin !== expected) return c.json({ error: 'Origen no permitido.' }, 403)
    }
    await next()
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) && c.res.ok && !c.req.path.startsWith('/api/auth')) {
        publicReads.invalidate()
        publishChange()
    }
})
app.get('/healthz', async c => {
    try { await db.execute(sql`select 1`); return c.json({ ok: true }) }
    catch { return c.json({ ok: false }, 503) }
})
app.get('/api/config', c => c.json({ name: config.TOURNAMENT_NAME, subtitle: config.TOURNAMENT_SUBTITLE, accent: config.TOURNAMENT_ACCENT, timeZone: config.TOURNAMENT_TIMEZONE }))
app.route('/api/events', liveRoutes)
app.use('/api/*', validateRequest)
app.route('/api/auth', authRoutes)
app.route('/api/categories', categoryRoutes)
app.route('/api/clubs', clubRoutes)
app.route('/api/teams', teamRoutes)
app.route('/api/matches', matchRoutes)
app.route('/api/sets', setRoutes)
app.route('/api/points', pointRoutes)
app.route('/api/standings', standingRoutes)
app.route('/api/users', userRoutes)
app.all('/api/*', c => c.json({ error: 'Ruta no encontrada.' }, 404))
// Scorers only see the match list and scoreboard; the API enforces the same roles.
const adminPages = new Set(['/manager/categories.html', '/manager/clubs.html', '/manager/teams.html', '/manager/users.html', '/manager/match-form.html'])
app.use('/manager/*', async (c, next) => {
    c.header('Cache-Control', 'no-store')
    const session = await getSession(c)
    if (!session) return c.redirect('/login.html')
    if (session.role !== 'admin' && adminPages.has(c.req.path)) return c.redirect('/manager/')
    await next()
})
app.get('/uploads/:file', async c => {
    const name = c.req.param('file')
    if (!/^[\w.-]+$/.test(name)) return c.notFound()
    const file = Bun.file(`${config.UPLOAD_DIR}/${name}`)
    if (!await file.exists()) return c.notFound()
    c.header('Cache-Control', 'public, max-age=86400')
    return new Response(file, { headers: c.res.headers })
})
// No static fallback for missing upload files.
app.all('/uploads/*', c => c.notFound())
app.use('/*', serveStatic({ root: './static' }))
app.onError((error, c) => {
    if (error instanceof HTTPException) return c.json({ error: error.message }, error.status)
    if (error instanceof ZodError) {
        const issue = error.issues[0]
        const field = fieldNames[String(issue?.path[0])]
        return c.json({ error: issue ? `${field ? `${field}: ` : ''}${issue.message}` : 'Revisá los datos ingresados.', fields: error.issues.map(i => i.path.join('.')) }, 400)
    }
    if (error instanceof SyntaxError) return c.json({ error: 'JSON inválido.' }, 400)
    const cause = (error as any).cause ?? error
    if (cause.code === '23505') return c.json({ error: 'Ya existe un registro con esos datos.' }, 409)
    if (cause.code === '23503') return c.json({ error: 'El registro está en uso o la referencia no existe.' }, 409)
    // Do not log SQL parameters (credentials / user data).
    console.error('Request failed', c.req.method, c.req.path, cause.code ?? error.name)
    return c.json({ error: 'No se pudo completar la operación. Intentá nuevamente.' }, 500)
})
export default app

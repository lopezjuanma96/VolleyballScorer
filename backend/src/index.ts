import { Hono } from 'hono'
import { serveStatic } from 'hono/bun'
import fs from 'fs'
import authRoutes from './routes/auth'
import categoryRoutes from './routes/categories'
import clubRoutes from './routes/clubs'
import teamRoutes from './routes/teams'
import matchRoutes from './routes/matches'
import setRoutes from './routes/sets'
import pointRoutes from './routes/points'

fs.mkdirSync('./static/uploads', { recursive: true })

const app = new Hono()

app.route('/api/auth', authRoutes)
app.route('/api/categories', categoryRoutes)
app.route('/api/clubs', clubRoutes)
app.route('/api/teams', teamRoutes)
app.route('/api/matches', matchRoutes)
app.route('/api/sets', setRoutes)
app.route('/api/points', pointRoutes)

// static must be last
app.use('/*', serveStatic({ root: './static' }))

export default app

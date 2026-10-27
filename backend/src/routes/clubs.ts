import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { db } from '../db'
import { clubs } from '../db/schema'
import { eq } from 'drizzle-orm'
import { authMiddleware } from '../middleware/auth'
import { config } from '../config'

const clubRoutes = new Hono()
async function parseClub(c: Parameters<typeof authMiddleware>[0]) {
    const body = await c.req.parseBody()
    const name = z.string().trim().min(1).max(100).parse(body.name)
    const file = body.logo
    if (!(file instanceof File) || file.size === 0) return { name }
    if (file.size > 2 * 1024 * 1024) throw new HTTPException(413, { message: 'El logo supera 2 MB.' })
    const bytes = new Uint8Array(await file.arrayBuffer())
    const png = bytes.slice(0, 8).join(',') === '137,80,78,71,13,10,26,10'
    const jpg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    const webp = new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP'
    const extension = png ? 'png' : jpg ? 'jpg' : webp ? 'webp' : null
    if (!extension) throw new HTTPException(400, { message: 'Usá una imagen PNG, JPG o WebP.' })
    const filename = `${crypto.randomUUID()}.${extension}`
    await Bun.write(`${config.UPLOAD_DIR}/${filename}`, bytes)
    return { name, logo: `/uploads/${filename}` }
}
clubRoutes.get('/', async c => c.json(await db.select().from(clubs).orderBy(clubs.name)))
clubRoutes.post('/', authMiddleware, async c => {
    const values = await parseClub(c)
    const [row] = await db.insert(clubs).values(values).returning()
    return c.json(row, 201)
})
clubRoutes.put('/:id', authMiddleware, async c => {
    const values = await parseClub(c)
    const [row] = await db.update(clubs).set(values).where(eq(clubs.id, Number(c.req.param('id')))).returning()
    if (!row) return c.json({ error: 'Club no encontrado.' }, 404)
    return c.json(row)
})
clubRoutes.delete('/:id', authMiddleware, async c => {
    const [row] = await db.delete(clubs).where(eq(clubs.id, Number(c.req.param('id')))).returning()
    if (!row) return c.json({ error: 'Club no encontrado.' }, 404)
    return c.json({ ok: true })
})
export default clubRoutes

import { Hono } from 'hono'
import type { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { db } from '../db'
import { clubs } from '../db/schema'
import { eq } from 'drizzle-orm'
import { adminOnly } from '../middleware/auth'
import { config } from '../config'
import { unlink } from 'node:fs/promises'
import { join } from 'node:path'

const clubRoutes = new Hono()
async function removeUnusedLogo(logo: string | null | undefined) {
    const filename = logo?.match(/^\/uploads\/([\w.-]+)$/)?.[1]
    if (!filename || filename === '.' || filename === '..') return
    try {
        const [reference] = await db.select({ id: clubs.id }).from(clubs).where(eq(clubs.logo, logo!)).limit(1)
        if (!reference) await unlink(join(config.UPLOAD_DIR, filename))
    } catch (error) {
        // A successful DB commit stays successful if filesystem cleanup needs attention.
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error('Could not clean unused club logo')
    }
}
async function parseClub(c: Context) {
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
    try { await Bun.write(join(config.UPLOAD_DIR, filename), bytes) }
    catch (error) { await unlink(join(config.UPLOAD_DIR, filename)).catch(() => {}); throw error }
    return { name, logo: `/uploads/${filename}` }
}
clubRoutes.get('/', async c => c.json(await db.select().from(clubs).orderBy(clubs.name)))
clubRoutes.post('/', adminOnly, async c => {
    const values = await parseClub(c)
    try {
        const [row] = await db.insert(clubs).values(values).returning()
        return c.json(row, 201)
    } catch (error) {
        await removeUnusedLogo(values.logo)
        throw error
    }
})
clubRoutes.put('/:id', adminOnly, async c => {
    const values = await parseClub(c)
    try {
        const { row, oldLogo } = await db.transaction(async tx => {
            const id = Number(c.req.param('id'))
            const [current] = await tx.select().from(clubs).where(eq(clubs.id, id)).for('update')
            if (!current) throw new HTTPException(404, { message: 'Club no encontrado.' })
            const [row] = await tx.update(clubs).set(values).where(eq(clubs.id, id)).returning()
            return { row, oldLogo: current.logo }
        })
        if (values.logo && values.logo !== oldLogo) await removeUnusedLogo(oldLogo)
        return c.json(row)
    } catch (error) {
        await removeUnusedLogo(values.logo)
        throw error
    }
})
clubRoutes.delete('/:id', adminOnly, async c => {
    const [row] = await db.delete(clubs).where(eq(clubs.id, Number(c.req.param('id')))).returning()
    if (!row) return c.json({ error: 'Club no encontrado.' }, 404)
    await removeUnusedLogo(row.logo)
    return c.json({ ok: true })
})
export default clubRoutes

import { z } from 'zod'
import type { Context, Next } from 'hono'
import { HTTPException } from 'hono/http-exception'

export const positiveId = z.number().int().positive()
const name = z.string().trim().min(1).max(100)
const score = z.number().int().min(0).max(999)
export const setStatus = z.enum(['in_progress', 'finished_home', 'finished_away', 'cancelled'])
export const matchStatus = z.enum(['upcoming', 'in_progress', 'finished_home', 'finished_away', 'cancelled'])
export const teamInput = z.object({ name, clubId: positiveId, categoryId: positiveId })
export const matchInput = z.object({
    teamHomeId: positiveId, teamAwayId: positiveId, categoryId: positiveId,
    court: z.enum(['court1', 'court2']), scheduledAt: z.iso.datetime({ offset: true }),
})
export const matchUpdate = matchInput.omit({ categoryId: true }).partial().extend({ status: matchStatus.optional() })
    .refine(value => Object.keys(value).length > 0, 'Indicá algún cambio.')
const schemas: Record<string, z.ZodType> = {
    categories: z.object({ name }), teams: teamInput, matches: matchInput,
    points: z.object({ setId: positiveId, homeScored: z.boolean() }),
}

export async function validateRequest(c: Context, next: Next) {
    const parts = c.req.path.split('/').filter(Boolean)
    if (parts[2] && parts[1] !== 'auth' && !/^\d+$/.test(parts[2])) throw new HTTPException(400, { message: 'ID inválido.' })
    if (parts[2] && parts[1] !== 'auth') positiveId.parse(Number(parts[2]))
    for (const key of ['categoryId', 'clubId']) {
        const value = c.req.query(key)
        if (value !== undefined) positiveId.parse(Number(value))
    }
    if (c.req.query('status')) matchStatus.parse(c.req.query('status'))
    if (['POST', 'PUT'].includes(c.req.method) && parts[1] !== 'clubs' && parts[1] !== 'auth') {
        let schema = schemas[parts[1]]
        if (parts[1] === 'matches' && c.req.method === 'PUT') schema = matchUpdate
        if (parts[1] === 'sets') schema = parts[3] === 'finish'
            ? z.object({ scoreHome: score, scoreAway: score, status: z.enum(['finished_home', 'finished_away']) })
            : z.object({ status: setStatus })
        if (schema) {
            const parsed = schema.parse(await c.req.json())
            // Hono caches parsed JSON; validate in middleware and route handlers use the same body.
            if (typeof parsed === 'object' && parsed && 'name' in parsed) Object.assign(await c.req.json(), parsed)
        }
    }
    await next()
}

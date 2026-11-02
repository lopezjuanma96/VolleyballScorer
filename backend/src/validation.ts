import { z } from 'zod'
import type { Context, Next } from 'hono'
import { HTTPException } from 'hono/http-exception'

export const positiveId = z.number().int().positive()
const name = z.string().trim().min(1).max(100)
const score = z.number().int().min(0).max(999)
const jersey = z.number().int().min(0).max(99)
export const side = z.enum(['home', 'away'])
export const setStatus = z.enum(['in_progress', 'finished_home', 'finished_away', 'cancelled'])
export const matchStatus = z.enum(['upcoming', 'in_progress', 'finished_home', 'finished_away', 'cancelled'])
export const teamInput = z.object({ name, clubId: positiveId, categoryId: positiveId })

const ruleFields = {
    bestOf: z.number().int().min(1).max(7).refine(n => n % 2 === 1, 'Usá una cantidad impar de sets.'),
    setPoints: z.number().int().min(3).max(99),
    tiebreakPoints: z.number().int().min(3).max(99),
    minLead: z.number().int().min(1).max(5),
    pointCap: z.number().int().min(4).max(199).nullable(),
}
type RuleShape = { setPoints?: number; tiebreakPoints?: number; pointCap?: number | null }
const capAboveTargets = (r: RuleShape) => r.pointCap == null || r.setPoints === undefined || r.tiebreakPoints === undefined || r.pointCap > Math.max(r.setPoints, r.tiebreakPoints)
const capMessage = { message: 'El tope de puntos debe superar los puntos del set y del desempate.', path: ['pointCap'] }
export const rulesInput = z.object(ruleFields).refine(capAboveTargets, capMessage)
export const categoryInput = z.object({
    name,
    bestOf: ruleFields.bestOf.default(3), setPoints: ruleFields.setPoints.default(25),
    tiebreakPoints: ruleFields.tiebreakPoints.default(15), minLead: ruleFields.minLead.default(2),
    pointCap: ruleFields.pointCap.default(null),
}).refine(capAboveTargets, capMessage)
export const categoryUpdate = z.object({ name, ...ruleFields }).partial().refine(capAboveTargets, capMessage)
    .refine(value => Object.keys(value).length > 0, 'Indicá algún cambio.')

const matchBase = z.object({
    teamHomeId: positiveId, teamAwayId: positiveId, categoryId: positiveId,
    court: z.enum(['court1', 'court2']), scheduledAt: z.iso.datetime({ offset: true }),
})
// Rules are copied from the category unless the admin overrides them for this match.
export const matchInput = matchBase.extend({ rules: rulesInput.optional() })
export const matchUpdate = matchBase.omit({ categoryId: true }).partial().extend({
    rules: rulesInput.optional(),
    status: matchStatus.optional(),
    expectedStatus: matchStatus.optional(),
    expectedActiveSet: z.object({ id: positiveId, lastPointId: positiveId.nullable() }).nullable().optional(),
    startNewSet: z.boolean().optional(),
}).refine(value => ['status', 'court', 'scheduledAt', 'teamHomeId', 'teamAwayId', 'rules'].some(key => key in value), 'Indicá algún cambio.')

const username = z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,50}$/, 'Usá de 3 a 50 letras, números, punto, guion o guion bajo.')
const password = z.string().min(10, 'La contraseña debe tener al menos 10 caracteres.').max(200)
const role = z.enum(['admin', 'scorer'])
export const userInput = z.object({ username, displayName: name, role, password })
export const userUpdate = z.object({ displayName: name.optional(), role: role.optional(), active: z.boolean().optional(), password: password.optional() })
    .refine(value => Object.keys(value).length > 0, 'Indicá algún cambio.')

const lineup = z.array(jersey).length(6).refine(numbers => new Set(numbers).size === 6, 'Cada posición necesita un número distinto.')
export const lineupInput = z.object({ firstServeHome: z.boolean().nullable(), home: lineup.nullable(), away: lineup.nullable() })
export const substitutionInput = z.object({ side, playerOut: jersey, playerIn: jersey }).refine(s => s.playerOut !== s.playerIn, 'Elegí jugadores distintos.')

const setSnapshot = { expectedLastPointId: positiveId.nullable(), expectedRevision: z.number().int().nonnegative(), expectedStatus: setStatus }
const reason = z.string().trim().min(3).max(500)
export const setSchemas: Record<string, z.ZodType> = {
    correct: z.object({ ...setSnapshot, scoreHome: score, scoreAway: score, status: z.enum(['finished_home', 'finished_away', 'cancelled']), reason }),
    recover: z.object({ ...setSnapshot, expectedMatchStatus: matchStatus, reason }),
    // The winner follows from the score and the match rules; status is an optional cross-check.
    finish: z.object({ scoreHome: score, scoreAway: score, status: z.enum(['finished_home', 'finished_away']).optional(), expectedLastPointId: positiveId.nullable() }),
    lineup: lineupInput,
    substitutions: substitutionInput,
}
const schemas: Record<string, z.ZodType> = {
    categories: categoryInput, teams: teamInput, matches: matchInput, users: userInput,
    points: z.object({ setId: positiveId, homeScored: z.boolean() }),
}

export async function validateRequest(c: Context, next: Next) {
    const parts = c.req.path.split('/').filter(Boolean)
    if (parts[2] && parts[1] !== 'auth' && !/^\d+$/.test(parts[2])) throw new HTTPException(400, { message: 'ID inválido.' })
    if (parts[2] && parts[1] !== 'auth') positiveId.parse(Number(parts[2]))
    if (parts[4] !== undefined) positiveId.parse(Number(parts[4]))
    for (const key of ['categoryId', 'clubId']) {
        const value = c.req.query(key)
        if (value !== undefined) positiveId.parse(Number(value))
    }
    if (c.req.query('status')) matchStatus.parse(c.req.query('status'))
    if (['POST', 'PUT'].includes(c.req.method) && parts[1] !== 'clubs' && parts[1] !== 'auth') {
        let schema = schemas[parts[1]]
        if (parts[1] === 'matches' && c.req.method === 'PUT') schema = matchUpdate
        if (parts[1] === 'users' && c.req.method === 'PUT') schema = userUpdate
        if (parts[1] === 'categories' && c.req.method === 'PUT') schema = categoryUpdate
        if (parts[1] === 'sets') schema = setSchemas[parts[3]] ?? z.object({ status: setStatus, expectedLastPointId: positiveId.nullable() })
        if (schema) {
            const parsed = schema.parse(await c.req.json())
            // Hono caches parsed JSON; normalized values (trimmed names, defaults) reach the handlers.
            if (typeof parsed === 'object' && parsed) Object.assign(await c.req.json(), parsed)
        }
    }
    await next()
}

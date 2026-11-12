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
    minLead: z.number().int().min(1).max(5),
    pointCap: z.number().int().min(4).max(199).nullable(),
    tiebreakPoints: z.number().int().min(3).max(99),
    tiebreakMinLead: z.number().int().min(1).max(5),
    tiebreakPointCap: z.number().int().min(4).max(199).nullable(),
}
// Clients written before the deciding set had its own lead and cap may omit them.
const ruleDefaults = { bestOf: 3, setPoints: 25, minLead: 2, pointCap: null, tiebreakPoints: 15, tiebreakMinLead: 2, tiebreakPointCap: null }
type RuleShape = { setPoints?: number; pointCap?: number | null; tiebreakPoints?: number; tiebreakPointCap?: number | null }
const capAbove = (cap: 'pointCap' | 'tiebreakPointCap', target: 'setPoints' | 'tiebreakPoints') => (r: RuleShape) => r[cap] == null || r[target] === undefined || r[cap]! > r[target]!
const withCaps = <T extends z.ZodType<RuleShape>>(schema: T) => schema
    .refine(capAbove('pointCap', 'setPoints'), { message: 'El tope de puntos debe superar los puntos del set.', path: ['pointCap'] })
    .refine(capAbove('tiebreakPointCap', 'tiebreakPoints'), { message: 'El tope del desempate debe superar sus puntos.', path: ['tiebreakPointCap'] })
const defaulted = Object.fromEntries(Object.entries(ruleFields).map(([key, field]) => [key, field.default(ruleDefaults[key as keyof typeof ruleDefaults] as never)])) as { [K in keyof typeof ruleFields]: z.ZodDefault<(typeof ruleFields)[K]> }
export const rulesInput = withCaps(z.object({ ...ruleFields, tiebreakMinLead: defaulted.tiebreakMinLead, tiebreakPointCap: defaulted.tiebreakPointCap }))
export const categoryInput = withCaps(z.object({ name, ...defaulted }))
export const categoryUpdate = withCaps(z.object({ name, ...ruleFields }).partial())
    .refine(value => Object.keys(value).length > 0, 'Indicá algún cambio.')

export const court = z.number().int().min(1).max(20)
const label = z.string().trim().max(100).transform(value => value || null).nullable()
const matchBase = z.object({
    teamHomeId: positiveId, teamAwayId: positiveId, categoryId: positiveId,
    court, scheduledAt: z.iso.datetime({ offset: true }), label: label.optional(),
})
// Rules are copied from the category unless the admin overrides them for this match.
export const matchInput = matchBase.extend({ rules: rulesInput.optional() })
export const matchUpdate = matchBase.omit({ categoryId: true }).partial().extend({
    rules: rulesInput.optional(),
    status: matchStatus.optional(),
    expectedStatus: matchStatus.optional(),
    expectedActiveSet: z.object({ id: positiveId, lastPointId: positiveId.nullable() }).nullable().optional(),
    startNewSet: z.boolean().optional(),
}).refine(value => ['status', 'court', 'scheduledAt', 'teamHomeId', 'teamAwayId', 'rules', 'label'].some(key => key in value), 'Indicá algún cambio.')

// Knockout phase: teams in seed order; each bracket match (round, slot) gets its
// label, court and time. The server rebuilds the bracket and requires every match.
const bracketPlan = { teamIds: z.array(positiveId).min(2).max(32).refine(ids => new Set(ids).size === ids.length, 'Cada equipo puede aparecer una sola vez.'), thirdPlace: z.boolean().default(false) }
export const phasePreview = z.object(bracketPlan)
export const phaseInput = z.object({
    categoryId: positiveId, name, ...bracketPlan,
    rules: rulesInput.optional(),
    matches: z.array(z.object({ round: z.number().int().min(1).max(6), slot: z.number().int().min(0).max(31), label, court, scheduledAt: z.iso.datetime({ offset: true }) })).min(1).max(40),
})
export const phaseUpdate = z.object({ name })

const email = z.string().trim().toLowerCase().max(254).pipe(z.email('Ingresá un email válido.'))
const role = z.enum(['admin', 'scorer'])
const displayName = z.string().trim().max(100)
export const userInput = z.object({ email, displayName: displayName.optional(), role })
export const userUpdate = z.object({ email: email.optional(), displayName: displayName.optional(), role: role.optional(), active: z.boolean().optional() })
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
    points: z.object({ setId: positiveId, homeScored: z.boolean(), expectedLastPointId: positiveId.nullable() }),
    claims: z.object({ expectedHolder: z.string().max(254).nullable().optional() }),
    phases: phaseInput,
}

export async function validateRequest(c: Context, next: Next) {
    const parts = c.req.path.split('/').filter(Boolean)
    const named = parts[1] === 'auth' || (parts[1] === 'phases' && parts[2] === 'preview')
    if (parts[2] && !named && !/^\d+$/.test(parts[2])) throw new HTTPException(400, { message: 'ID inválido.' })
    if (parts[2] && !named) positiveId.parse(Number(parts[2]))
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
        if (parts[1] === 'phases') schema = c.req.method === 'PUT' ? phaseUpdate : parts[2] === 'preview' ? phasePreview : phaseInput
        if (parts[1] === 'sets') schema = setSchemas[parts[3]] ?? z.object({ status: setStatus, expectedLastPointId: positiveId.nullable() })
        if (schema) {
            const parsed = schema.parse(await c.req.json())
            // Hono caches parsed JSON; normalized values (trimmed names, defaults) reach the handlers.
            if (typeof parsed === 'object' && parsed) Object.assign(await c.req.json(), parsed)
        }
    }
    await next()
}

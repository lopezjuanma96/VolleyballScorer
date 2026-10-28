import { z } from 'zod'

const envSchema = z.object({
    DEPLOY_MODE: z.enum(['local', 'onprem', 'cloud']).default('local'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    MANAGER_USER: z.string().trim().min(1).default('manager'),
    MANAGER_PASSWORD: z.string().min(12, 'Use at least 12 characters'),
    SESSION_SECRET: z.string().min(32, 'Use at least 32 characters'),
    PUBLIC_URL: z.url().optional(),
    COOKIE_SECURE: z.enum(['true', 'false']).optional(),
    UPLOAD_DIR: z.string().default('./static/uploads'),
    AUTO_MIGRATE: z.enum(['true', 'false']).default('true'),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).optional(),
    CLIENT_IP_HEADER: z.enum(['x-forwarded-for', 'x-real-ip']).default('x-forwarded-for'),
    TOURNAMENT_NAME: z.string().trim().min(1).max(100).default('Torneo de vóley'),
    TOURNAMENT_SUBTITLE: z.string().max(200).default('Cada punto cuenta.'),
    TOURNAMENT_ACCENT: z.string().regex(/^#[0-9a-f]{6}$/i).default('#b9ed64'),
    TOURNAMENT_TIMEZONE: z.string().default('America/Argentina/Cordoba'),
})

export function parseConfig(env: Record<string, string | undefined>) {
    const result = envSchema.safeParse(env)
    if (!result.success) {
        // Report field names and messages, never secret values.
        throw new Error('Invalid configuration: ' + result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '))
    }
    const config = result.data
    if (config.DEPLOY_MODE !== 'local' && (!config.PUBLIC_URL?.startsWith('https://') || config.COOKIE_SECURE === 'false')) {
        throw new Error('onprem/cloud require an HTTPS PUBLIC_URL and secure cookies')
    }
    try { new Intl.DateTimeFormat('es-AR', { timeZone: config.TOURNAMENT_TIMEZONE }) }
    catch { throw new Error('Invalid TOURNAMENT_TIMEZONE') }
    return Object.freeze({ ...config,
        TRUST_PROXY_HOPS: config.TRUST_PROXY_HOPS ?? (config.DEPLOY_MODE === 'local' ? 0 : 1),
        secureCookie: config.COOKIE_SECURE ? config.COOKIE_SECURE === 'true' : config.DEPLOY_MODE !== 'local',
    })
}

export const config = parseConfig(process.env)

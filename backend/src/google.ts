import { createHash, randomBytes } from 'node:crypto'

// Google sign-in with the OpenID Connect authorization code flow (PKCE + state + nonce).
// The ID token comes straight from Google's token endpoint over TLS, authenticated with
// the client secret, so its claims are checked without verifying the JWT signature
// (OpenID Connect Core 3.1.3.7).
export const GOOGLE_AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth'
export const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token'
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com']

export const randomToken = () => randomBytes(32).toString('base64url')
export const pkceChallenge = (verifier: string) => createHash('sha256').update(verifier).digest('base64url')

export function authorizationUrl(clientId: string, redirectUri: string, state: string, nonce: string, verifier: string) {
    const url = new URL(GOOGLE_AUTHORIZE)
    url.search = new URLSearchParams({
        client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'openid email',
        state, nonce, code_challenge: pkceChallenge(verifier), code_challenge_method: 'S256', prompt: 'select_account',
    }).toString()
    return url.toString()
}

// Returns the verified, lowercased email, or null when any claim does not match.
export function verifiedEmail(claims: Record<string, unknown>, expected: { clientId: string; nonce: string; now?: number }) {
    const now = expected.now ?? Math.floor(Date.now() / 1000)
    if (!ISSUERS.includes(claims.iss as string)) return null
    if (claims.aud !== expected.clientId) return null
    if (typeof claims.exp !== 'number' || claims.exp < now) return null
    if (claims.nonce !== expected.nonce) return null
    if (claims.email_verified !== true || typeof claims.email !== 'string') return null
    const email = claims.email.trim().toLowerCase()
    return email.length <= 254 && email.includes('@') ? email : null
}

export async function exchangeCode(settings: { clientId: string; clientSecret: string }, code: string, verifier: string, redirectUri: string) {
    const response = await fetch(GOOGLE_TOKEN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code, code_verifier: verifier, client_id: settings.clientId, client_secret: settings.clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
        signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) return null
    const body = await response.json().catch(() => null) as { id_token?: unknown } | null
    const part = typeof body?.id_token === 'string' ? body.id_token.split('.')[1] : undefined
    if (!part) return null
    try { return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown> }
    catch { return null }
}

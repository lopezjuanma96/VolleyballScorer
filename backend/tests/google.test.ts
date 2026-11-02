import { describe, test, expect } from 'bun:test'
import { authorizationUrl, pkceChallenge, verifiedEmail } from '../src/google'

describe('Google sign-in claims', () => {
    const now = 1_800_000_000
    const valid = { iss: 'https://accounts.google.com', aud: 'client', exp: now + 60, nonce: 'n', email: 'Ana@Example.com', email_verified: true }
    const check = (claims: object) => verifiedEmail(claims as Record<string, unknown>, { clientId: 'client', nonce: 'n', now })
    test('accepts a verified email for this client and nonce, lowercased', () => {
        expect(check(valid)).toBe('ana@example.com')
        expect(check({ ...valid, iss: 'accounts.google.com' })).toBe('ana@example.com')
    })
    test('rejects other issuers, audiences, expired tokens, replays and unverified emails', () => {
        for (const bad of [{ iss: 'https://evil.example' }, { aud: 'other' }, { aud: ['client'] }, { exp: now - 1 }, { exp: undefined }, { nonce: 'other' },
            { email_verified: false }, { email_verified: 'true' }, { email: undefined }, { email: 'no-at-sign' }]) expect(check({ ...valid, ...bad })).toBeNull()
    })
    test('authorization request uses PKCE S256 and carries state and nonce', () => {
        const url = new URL(authorizationUrl('client', 'https://voley.example.com/api/auth/google/callback', 's', 'n', 'verifier'))
        expect(url.searchParams.get('code_challenge')).toBe(pkceChallenge('verifier'))
        expect(url.searchParams.get('code_challenge_method')).toBe('S256')
        expect(url.searchParams.get('state')).toBe('s')
        expect(url.searchParams.get('nonce')).toBe('n')
        expect(url.searchParams.get('scope')).toBe('openid email profile')
    })
})

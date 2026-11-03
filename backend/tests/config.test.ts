import { describe, test, expect } from 'bun:test'
process.env.MANAGER_PASSWORD ??= 'test-manager-password'
process.env.SESSION_SECRET ??= 'test-session-secret-at-least-32-characters'
const { parseConfig } = await import('../src/config')
const base = { MANAGER_PASSWORD: 'test-manager-password', SESSION_SECRET: 'test-session-secret-at-least-32-characters' }
describe('deployment configuration', () => {
    test('local uses HTTP-compatible cookies and trusts no proxy', () => {
        expect(parseConfig(base).secureCookie).toBe(false)
        expect(parseConfig(base).TRUST_PROXY_HOPS).toBe(0)
    })
    test('onprem and cloud require HTTPS and secure cookies', () => {
        for (const DEPLOY_MODE of ['onprem', 'cloud']) {
            expect(() => parseConfig({ ...base, DEPLOY_MODE })).toThrow('HTTPS')
            expect(() => parseConfig({ ...base, DEPLOY_MODE, PUBLIC_URL: 'http://example.com' })).toThrow('HTTPS')
            expect(() => parseConfig({ ...base, DEPLOY_MODE, PUBLIC_URL: 'https://example.com', COOKIE_SECURE: 'false' })).toThrow()
            const config = parseConfig({ ...base, DEPLOY_MODE, PUBLIC_URL: 'https://example.com' })
            expect(config.secureCookie).toBe(true)
            expect(config.TRUST_PROXY_HOPS).toBe(1)
        }
    })
    test('the local dev login is refused outside local mode', () => {
        expect(parseConfig(base).devLogin).toBe(false)
        expect(parseConfig({ ...base, DEV_LOGIN: 'true' }).devLogin).toBe(true)
        for (const DEPLOY_MODE of ['onprem', 'cloud']) expect(() => parseConfig({ ...base, DEPLOY_MODE, PUBLIC_URL: 'https://example.com', DEV_LOGIN: 'true' })).toThrow('DEV_LOGIN')
    })
    test('validates the forwarding policy', () => {
        expect(parseConfig({ ...base, TRUST_PROXY_HOPS: '2', CLIENT_IP_HEADER: 'x-real-ip' }).CLIENT_IP_HEADER).toBe('x-real-ip')
        expect(() => parseConfig({ ...base, TRUST_PROXY_HOPS: '-1' })).toThrow()
        expect(() => parseConfig({ ...base, CLIENT_IP_HEADER: 'arbitrary' })).toThrow()
    })
    test('rejects bad timezone and CSS injection', () => {
        expect(() => parseConfig({ ...base, TOURNAMENT_TIMEZONE: 'invalid' })).toThrow()
        expect(() => parseConfig({ ...base, TOURNAMENT_ACCENT: 'red; color: transparent' })).toThrow()
    })
    test('Google sign-in needs both client values; blank means off', () => {
        expect(parseConfig({ ...base, GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '' }).googleEnabled).toBe(false)
        expect(parseConfig({ ...base, GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' }).googleEnabled).toBe(true)
        expect(() => parseConfig({ ...base, GOOGLE_CLIENT_ID: 'id' })).toThrow('GOOGLE')
        expect(() => parseConfig({ ...base, GOOGLE_CLIENT_SECRET: 'secret' })).toThrow('GOOGLE')
        expect(parseConfig({ ...base, CONTACT_EMAIL: '' }).CONTACT_EMAIL).toBeUndefined()
        expect(parseConfig({ ...base, CONTACT_EMAIL: 'org@example.com' }).CONTACT_EMAIL).toBe('org@example.com')
        expect(() => parseConfig({ ...base, CONTACT_EMAIL: 'not-an-email' })).toThrow('CONTACT_EMAIL')
    })
    test('configuration errors do not expose secrets', () => {
        try { parseConfig({ MANAGER_PASSWORD: 'secret', SESSION_SECRET: 'private' }) }
        catch (e) { expect(String(e)).not.toContain('private'); expect(String(e)).not.toContain('secret') }
    })
})

import { describe, expect, test } from 'bun:test'
import { clientAddress, LoginLimiter } from '../src/login-limit'

describe('login abuse controls', () => {
    test('isolates clients and recovers after the rate limit window', () => {
        const limiter = new LoginLimiter(2, 60_000)
        expect(limiter.consume('A', 1000)).toBe(0)
        expect(limiter.consume('A', 1001)).toBe(0)
        expect(limiter.consume('A', 2000)).toBe(59)
        expect(limiter.consume('B', 2000)).toBe(0)
        expect(limiter.consume('A', 61_000)).toBe(0)
    })
    test('direct deployments ignore spoofed forwarding headers', () => {
        expect(clientAddress('198.51.100.10', '203.0.113.10', 0)).toBe('198.51.100.10')
        expect(clientAddress('::ffff:198.51.100.10', undefined, 0)).toBe('198.51.100.10')
    })
    test('trusted proxies ignore untrusted prefixes and reject malformed addresses', () => {
        expect(clientAddress('127.0.0.1', '203.0.113.99, 198.51.100.10', 1)).toBe('198.51.100.10')
        expect(clientAddress('127.0.0.1', '203.0.113.99, 198.51.100.10, 10.0.0.1', 2)).toBe('198.51.100.10')
        expect(clientAddress('127.0.0.1', 'not-an-ip', 1)).toBe('127.0.0.1')
        expect(clientAddress('127.0.0.1', undefined, 1)).toBe('127.0.0.1')
    })
})

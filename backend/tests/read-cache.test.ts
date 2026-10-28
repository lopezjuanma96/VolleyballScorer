import { expect, test } from 'bun:test'
import { ReadCache } from '../src/read-cache'

test('coalesces concurrent reads and invalidates immediately after a write', async () => {
    const cache = new ReadCache()
    let loads = 0
    const load = async () => ({ score: ++loads })
    expect(await Promise.all(Array.from({ length: 100 }, () => cache.get('match:1', load)))).toEqual(Array(100).fill('{"score":1}'))
    cache.invalidate()
    expect(await cache.get('match:1', load)).toBe('{"score":2}')
})
test('a slow invalidated read cannot overwrite a fresh generation', async () => {
    const cache = new ReadCache()
    let finish!: (value: unknown) => void
    const old = cache.get('match:1', () => new Promise(resolve => { finish = resolve }))
    await Promise.resolve()
    cache.invalidate()
    expect(await cache.get('match:1', async () => 'fresh')).toBe('"fresh"')
    finish('stale'); await old
    expect(await cache.get('match:1', async () => 'incorrect')).toBe('"fresh"')
})
test('does not cache failures and respects entry, byte and lifetime bounds', async () => {
    const cache = new ReadCache(1000, 1, 8)
    await expect(cache.get('a', async () => { throw new Error('not found') })).rejects.toThrow('not found')
    expect(await cache.get('a', async () => 1)).toBe('1')
    await cache.get('b', async () => 2)
    expect(await cache.get('a', async () => 3)).toBe('3')
    await cache.get('a', async () => 'cached')
    cache.invalidate()
    await cache.get('large', async () => 'too large for this cache')
    expect(await cache.get('large', async () => 'new')).toBe('"new"')
    const expired = new ReadCache(-1)
    await expired.get('a', async () => 1)
    expect(await expired.get('a', async () => 2)).toBe('2')
})

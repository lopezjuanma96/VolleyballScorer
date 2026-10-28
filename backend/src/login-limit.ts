import { isIP } from 'node:net'

// Trust a fixed number of forwarding proxies only when direct access to the
// origin is prevented. Read from the right so a client-supplied prefix is ignored.
export function clientAddress(peer: string | undefined, forwarded: string | undefined, trustedHops: number) {
    const normalize = (value: string) => value.toLowerCase().replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/, '$1')
    if (trustedHops > 0 && forwarded && forwarded.length <= 1024) {
        const address = forwarded.split(',').map(value => value.trim()).at(-trustedHops)
        if (address && isIP(address)) return normalize(address)
    }
    return peer && isIP(peer) ? normalize(peer) : 'unknown'
}

export class LoginLimiter {
    private buckets = new Map<string, { count: number; resetAt: number }>()
    constructor(private limit = 30, private windowMs = 60_000, private maxClients = 4096) {}

    consume(key: string, now = Date.now()) {
        let bucket = this.buckets.get(key)
        if (!bucket || bucket.resetAt <= now) {
            if (!bucket && this.buckets.size >= this.maxClients) this.buckets.delete(this.buckets.keys().next().value!)
            bucket = { count: 0, resetAt: now + this.windowMs }
            this.buckets.set(key, bucket)
        }
        if (bucket.count >= this.limit) return Math.ceil((bucket.resetAt - now) / 1000)
        bucket.count++
        return 0
    }
}

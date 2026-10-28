// One process, bounded memory; no extra service. Successful writes invalidate all
// public snapshots before notifying viewers. In-flight reads cannot refill an
// invalidated generation. A short TTL also covers out-of-band DB changes.
export class ReadCache {
    private entries = new Map<string, { value: Promise<string>; expires: number; bytes: number }>()
    private bytes = 0
    constructor(private ttlMs = 1000, private maxEntries = 128, private maxBytes = 16 * 1024 * 1024) {}
    invalidate() { this.entries.clear(); this.bytes = 0 }
    private remove(key: string) { this.bytes -= this.entries.get(key)?.bytes ?? 0; this.entries.delete(key) }
    async get(key: string, load: () => Promise<unknown>): Promise<string> {
        const existing = this.entries.get(key)
        if (existing && existing.expires > Date.now()) return existing.value
        this.remove(key)
        while (this.entries.size >= this.maxEntries) this.remove(this.entries.keys().next().value!)
        const entry = { value: Promise.resolve(''), expires: Date.now() + this.ttlMs, bytes: 0 }
        entry.value = Promise.resolve().then(load).then(data => {
            const value = JSON.stringify(data)
            if (this.entries.get(key) === entry) {
                entry.bytes = Buffer.byteLength(value)
                this.bytes += entry.bytes
                while (this.bytes > this.maxBytes) this.remove(this.entries.keys().next().value!)
            }
            return value
        }).catch(error => { if (this.entries.get(key) === entry) this.remove(key); throw error })
        this.entries.set(key, entry)
        return entry.value
    }
}
export const publicReads = new ReadCache()

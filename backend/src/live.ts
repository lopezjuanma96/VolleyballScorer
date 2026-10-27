import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'

const listeners = new Set<() => void>()
export function publishChange() { for (const listener of listeners) listener() }
export const liveRoutes = new Hono().get('/', c => {
    if (listeners.size >= 500) return c.json({ error: 'Capacidad de espectadores alcanzada.' }, 503)
    c.header('Cache-Control', 'no-store')
    c.header('X-Accel-Buffering', 'no')
    return streamSSE(c, async stream => {
        let resolveClose!: () => void
        const closed = new Promise<void>(resolve => { resolveClose = resolve })
        const send = () => { void stream.writeSSE({ event: 'change', data: 'refresh', retry: 5000 }).catch(resolveClose) }
        listeners.add(send)
        const heartbeat = setInterval(() => { void stream.write(': heartbeat\n\n').catch(resolveClose) }, 25_000)
        stream.onAbort(resolveClose)
        try { send(); await closed }
        finally { clearInterval(heartbeat); listeners.delete(send) }
    })
})

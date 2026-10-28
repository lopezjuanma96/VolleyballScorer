import { request as httpRequest, Agent } from 'node:http'
import { cpus } from 'node:os'
import { resolve, dirname } from 'node:path'
import { mkdir } from 'node:fs/promises'

// This runner always owns its stack. It deliberately accepts no external target URL.
const root = resolve(import.meta.dir, '..')
const args = process.argv.slice(2)
function option(name: string, fallback: string) { const at = args.indexOf(name); return at < 0 ? fallback : args[at + 1] ?? '' }
if (args.includes('--help')) {
    console.info('bun scripts/load-test.ts [--spectators 50,150,300,450] [--duration 30] [--point-interval 1000] [--port 3100] [--output backups/load-results.json]')
    process.exit(0)
}
const stages = option('--spectators', '50,150,300,450').split(',').map(Number)
const duration = Number(option('--duration', '30'))
const pointInterval = Number(option('--point-interval', '1000'))
const port = Number(option('--port', '3100'))
if (stages.some(n => !Number.isInteger(n) || n < 1 || n > 500) || !Number.isFinite(duration) || duration < 5 || duration > 600 || !Number.isInteger(pointInterval) || pointInterval < 100 || pointInterval > 60000 || !Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid load parameters; see --help')
const id = `volleyball-load-${Date.now()}`
const status = await Bun.file('/proc/self/status').text()
const cpu = process.env.LOAD_CPU ?? status.match(/^Cpus_allowed_list:\s*(\d+)/m)?.[1]
if (!cpu || !/^\d+$/.test(cpu)) throw new Error('Set LOAD_CPU to one available Linux CPU index')
const env = { ...process.env, LOAD_ID: id, LOAD_CPU: cpu, LOAD_PORT: String(port), LOAD_DB_PASSWORD: crypto.randomUUID(), LOAD_MANAGER_PASSWORD: crypto.randomUUID(), LOAD_SESSION_SECRET: crypto.randomUUID() + crypto.randomUUID(), COMPOSE_PROFILES: '' }
const composeArgs = ['docker', 'compose', '-f', 'deploy/compose.load.yml', '-p', id]
async function compose(args: string[], capture = false) {
    const proc = Bun.spawn([...composeArgs, ...args], { cwd: root, env, stdout: capture ? 'pipe' : 'inherit', stderr: 'inherit' })
    const output = capture ? await new Response(proc.stdout).text() : ''
    if (await proc.exited !== 0) throw new Error(`Disposable Compose operation failed: ${args[0]}`)
    return output.trim()
}
const agent = new Agent({ keepAlive: true, maxSockets: 4096, maxFreeSockets: 512 })
const base = `http://127.0.0.1:${port}`
let cookie = ''
const pause = (ms: number) => new Promise<void>(r => setTimeout(r, ms))
type Metric = { count: number; errors: number; bytes: number; durations: number[] }
const metric = (): Metric => ({ count: 0, errors: 0, bytes: 0, durations: [] })
function summary(m: Metric) {
    const sorted = m.durations.toSorted((a, b) => a - b)
    const percentile = (p: number) => sorted.length ? Math.round(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] * 100) / 100 : null
    return { count: m.count, errors: m.errors, bytes: m.bytes, p50Ms: percentile(.5), p95Ms: percentile(.95), p99Ms: percentile(.99) }
}
async function json(path: string, method = 'GET', body?: unknown, m?: Metric) {
    const start = performance.now()
    try {
        const result = await new Promise<{ data: any; cookie?: string }>((resolve, reject) => {
            const payload = body === undefined ? undefined : JSON.stringify(body)
            const request = httpRequest(base + path, { agent, method, headers: { ...(cookie && method !== 'GET' ? { Cookie: cookie } : {}), ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(payload)) } : {}) } }, response => {
                const chunks: Buffer[] = []
                response.on('data', chunk => chunks.push(chunk))
                response.on('error', reject)
                response.on('end', () => {
                    const bytes = Buffer.concat(chunks)
                    if (m) m.bytes += bytes.length
                    if (!response.statusCode || response.statusCode >= 400) return reject(new Error(`HTTP ${response.statusCode} ${method} ${path}`))
                    try { resolve({ data: JSON.parse(bytes.toString()), cookie: response.headers['set-cookie']?.[0]?.split(';')[0] }) } catch { reject(new Error('Invalid JSON response')) }
                })
            })
            request.setTimeout(15_000, () => request.destroy(new Error('Request timeout')))
            request.on('error', reject)
            request.end(payload)
        })
        if (result.cookie) cookie = result.cookie
        return result.data
    } catch (error) { if (m) m.errors++; throw error }
    finally { if (m) { m.count++; m.durations.push(performance.now() - start) } }
}
type LiveMatch = { id: number; setId: number; home: number; away: number; accepted: number; times: Map<number, number> }
let live: LiveMatch[] = []
let stop = false
process.on('SIGINT', () => { stop = true })
process.on('SIGTERM', () => { stop = true })
const results: any[] = []
let failed = false
try {
    console.info(`Disposable benchmark ${id}; app and PostgreSQL share CPU ${cpu}; memory limits app 1 GiB + DB 2 GiB`)
    await compose(['up', '-d', '--build', '--wait', '--wait-timeout', '120'])
    for (let i = 0; i < 120; i++) {
        try { if ((await json('/api/config')).name !== id) throw new Error('Unexpected target'); await json('/healthz'); break }
        catch { if (i === 119) throw new Error('Isolated app did not become ready'); await pause(500) }
    }
    await compose(['exec', '-T', 'app', 'bun', 'load-fixtures.ts'])
    await json('/api/auth/login', 'POST', { username: 'load-manager', password: env.LOAD_MANAGER_PASSWORD })
    live = (await json('/api/matches?status=in_progress')).map((m: any) => ({ id: m.id, setId: m.sets[0].id, home: 0, away: 0, accepted: 0, times: new Map() }))
    const containers = (await compose(['ps', '-q'], true)).split('\n')
    for (const spectators of stages) {
        if (stop) break
        let measuring = false, ending = false, connected = 0, disconnects = 0, refreshFailures = 0
        const reads = metric(), writes = metric(), visibility = metric(), connection = metric()
        const resourceSamples: any[] = []
        const clients: { destroy: () => void; seen: Map<number, number>; relevant: LiveMatch[]; refresh: () => Promise<void>; pending: () => boolean }[] = []
        const sseTasks: Promise<void>[] = []
        const refreshTasks = new Set<Promise<void>>()
        for (let i = 0; i < spectators; i++) {
            const lobby = i % 2 === 0
            const relevant = lobby ? live : [live[Math.floor(i / 2) % live.length]]
            const seen = new Map<number, number>()
            let timer: ReturnType<typeof setTimeout> | undefined, busy = false, queued = false
            async function refresh() {
                if (busy) { queued = true; return }
                busy = true
                try {
                    const m = measuring ? reads : undefined
                    const data: any[] = lobby ? (await Promise.all([json('/api/matches', 'GET', undefined, m), json('/api/categories', 'GET', undefined, m)]))[0] : [await json(`/api/matches/${relevant[0].id}`, 'GET', undefined, m)]
                    for (const target of relevant) {
                        const set = data.find(d => d.id === target.id)?.sets.find((s: any) => s.id === target.setId)
                        if (!set) throw new Error('Missing live score')
                        const count = set.scoreHome + set.scoreAway
                        if (count < (seen.get(target.id) ?? 0)) throw new Error('Score moved backwards')
                        if (count > (seen.get(target.id) ?? 0) && measuring && target.times.has(count)) { visibility.count++; visibility.durations.push(performance.now() - target.times.get(count)!) }
                        seen.set(target.id, count)
                    }
                } catch { if (measuring) refreshFailures++ }
                finally { busy = false; if (queued && !ending) { queued = false; trackRefresh() } }
            }
            function trackRefresh() { const task = refresh(); refreshTasks.add(task); void task.finally(() => refreshTasks.delete(task)); return task }
            const start = performance.now()
            const req = httpRequest(base + '/api/events', { agent, headers: { Accept: 'text/event-stream' } })
            sseTasks.push(new Promise<void>(resolve => {
                req.on('response', response => {
                    if (response.statusCode !== 200) { connection.errors++; response.resume(); resolve(); return }
                    connected++; connection.count++; connection.durations.push(performance.now() - start)
                    let buffer = ''
                    response.setEncoding('utf8')
                    response.on('data', chunk => {
                        buffer += chunk
                        let at: number
                        while ((at = buffer.indexOf('\n\n')) >= 0) {
                            const event = buffer.slice(0, at); buffer = buffer.slice(at + 2)
                            if (event.includes('event: change') && timer === undefined && !ending) timer = setTimeout(() => { timer = undefined; trackRefresh() }, 180)
                        }
                    })
                    response.on('close', () => { if (!ending) disconnects++; resolve() })
                    response.on('error', () => { if (!ending) disconnects++; resolve() })
                })
                req.on('error', () => { if (!ending) { disconnects++; connection.errors++ }; resolve() })
            }))
            req.end()
            clients.push({ destroy: () => { clearTimeout(timer); req.destroy() }, seen, relevant, refresh: trackRefresh, pending: () => busy || timer !== undefined || queued })
            if (i % 20 === 19) await pause(10)
        }
        const warmupDeadline = performance.now() + 60_000
        while (performance.now() < warmupDeadline && (connected < spectators || clients.some(c => c.seen.size < c.relevant.length || c.pending()))) await pause(100)
        if (connected !== spectators || clients.some(c => c.seen.size < c.relevant.length)) throw new Error(`Only ${connected}/${spectators} spectators connected and loaded`)
        measuring = true
        const started = performance.now(), end = started + duration * 1000
        const acceptedBefore = live.reduce((n, m) => n + m.accepted, 0)
        const sample = async () => {
            const proc = Bun.spawn(['docker', 'stats', '--no-stream', '--format', '{{json .}}', ...containers], { stdout: 'pipe', stderr: 'ignore' })
            const data = await new Response(proc.stdout).text()
            if (await proc.exited === 0) resourceSamples.push(...data.trim().split('\n').filter(Boolean).map(line => JSON.parse(line)))
        }
        let sampling = false
        const sampler = setInterval(() => { if (!sampling) { sampling = true; void sample().finally(() => { sampling = false }) } }, 3000)
        const writers = live.map(async (target, court) => {
            let deadline = started + court * pointInterval / live.length, tick = 0
            while (!stop && performance.now() < end) {
                await pause(Math.max(0, deadline - performance.now()))
                if (stop || performance.now() >= end) break
                const homeScored = tick++ % 2 === 0, before = performance.now()
                try {
                    const point = await json('/api/points', 'POST', { setId: target.setId, homeScored }, writes)
                    target.accepted++; target.home = point.scoreHome; target.away = point.scoreAway
                    target.times.set(point.scoreHome + point.scoreAway, before)
                } catch { /* Report failures; never blindly retry a point. */ }
                deadline += pointInterval
            }
        })
        await Promise.all(writers)
        clearInterval(sampler)
        const actualSeconds = (performance.now() - started) / 1000
        const drain = performance.now() + 15_000
        while (performance.now() < drain && clients.some(c => c.pending() || c.relevant.some(m => c.seen.get(m.id) !== m.home + m.away))) await pause(50)
        const caughtUp = clients.filter(c => c.relevant.every(m => c.seen.get(m.id) === m.home + m.away)).length
        measuring = false; ending = true
        for (const client of clients) client.destroy()
        await Promise.all(sseTasks)
        await Promise.allSettled([...refreshTasks])
        while (sampling) await pause(50)
        const integrity: any[] = []
        for (const target of live) {
            const match = await json(`/api/matches/${target.id}`)
            const set = match.sets.find((s: any) => s.id === target.setId)
            const ok = set.points.length === target.accepted && set.scoreHome === target.home && set.scoreAway === target.away && set.points.every((p: any, i: number) => p.scoreHome + p.scoreAway === i + 1)
            integrity.push({ matchId: target.id, accepted: target.accepted, records: set.points.length, ok })
        }
        const correct = connected === spectators && caughtUp === spectators && reads.errors === 0 && writes.errors === 0 && refreshFailures === 0 && disconnects === 0 && integrity.every(i => i.ok)
        const acceptedPoints = live.reduce((n, m) => n + m.accepted, 0) - acceptedBefore
        const intendedPoints = duration * 1000 / pointInterval * live.length
        const withinTargets = (summary(reads).p95Ms ?? Infinity) < 1000 && (summary(writes).p95Ms ?? Infinity) < 500 && (summary(visibility).p95Ms ?? Infinity) < 1500 && acceptedPoints >= intendedPoints * .95
        const passed = correct && withinTargets
        const result = { spectators, passed, correct, withinTargets, actualSeconds: Math.round(actualSeconds * 100) / 100, connected, caughtUp, disconnects, refreshFailures, acceptedPoints, intendedPoints, reads: summary(reads), writes: summary(writes), pointToRefresh: summary(visibility), connection: summary(connection), requestsPerSecond: Math.round((reads.count + writes.count) / actualSeconds * 100) / 100, integrity, resourceSamples }
        results.push(result)
        if (!passed) failed = true
        console.info(JSON.stringify({ ...result, resourceSamples: `${resourceSamples.length} container samples` }, null, 2))
        await pause(500)
    }
} catch (error) {
    failed = true
    console.error(error instanceof Error ? error.message : 'Load test failed')
} finally {
    agent.destroy()
    await compose(['down', '-v', '--remove-orphans'])
    const output = resolve(root, option('--output', `backups/${id}.json`))
    await mkdir(dirname(output), { recursive: true })
    await Bun.write(output, JSON.stringify({ id, createdAt: new Date().toISOString(), host: { model: cpus()[0]?.model, logicalCpus: cpus().length }, budget: { sharedCpu: cpu, appMemoryGiB: 1, dbMemoryGiB: 2 }, fixture: { matches: 120, categories: 6, teams: 48, historicalRecords: 10800 }, parameters: { stages, duration, pointInterval }, stopped: stop, passed: !failed && !stop && results.length === stages.length, results }, null, 2))
    console.info(`Report: ${output}`)
}
process.exitCode = failed || stop ? 1 : 0

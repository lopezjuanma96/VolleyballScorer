import { describe, expect, test } from 'bun:test'
import { createContext, runInContext } from 'node:vm'

const appSource = await Bun.file('./static/app.js').text()
function browser() {
    let now = 0, timerId = 0
    const timers = new Map<number, { at: number; callback: () => unknown }>()
    const elements = new Map<string, any>()
    const context: any = {
        document: {
            hidden: false, addEventListener() {}, querySelectorAll: () => [],
            getElementById: (id: string) => { if (!elements.has(id)) elements.set(id, { innerHTML: '', setAttribute() {} }); return elements.get(id) },
            documentElement: { style: { setProperty() {} } },
        },
        navigator: { onLine: true }, location: { search: '?id=1', pathname: '/' },
        AbortSignal, URLSearchParams, console,
        fetch: async () => ({ ok: true, json: async () => ({ timeZone: 'UTC' }) }),
        addEventListener() {},
        setTimeout(callback: () => unknown, delay: number) { const id = ++timerId; timers.set(id, { at: now + delay, callback }); return id },
        clearTimeout: (id: number) => timers.delete(id),
    }
    context.window = context
    let source: any
    context.EventSource = class {
        handlers = new Map<string, () => void>()
        constructor() { source = this }
        addEventListener(event: string, fn: () => void) { this.handlers.set(event, fn) }
        close() {}
    }
    createContext(context)
    runInContext(appSource, context)
    context.App.ready = new Promise(() => {})
    return {
        context, elements,
        event() { source.handlers.get('change')() },
        async advance(ms: number) {
            const end = now + ms
            while (true) {
                const next = [...timers].filter(([, value]) => value.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
                if (!next) break
                timers.delete(next[0]); now = next[1].at; next[1].callback()
                await Promise.resolve(); await Promise.resolve()
            }
            now = end
        },
    }
}

describe('public live updates', () => {
    test('refreshes during a continuous stream instead of waiting for silence', async () => {
        const view = browser()
        let refreshes = 0
        view.context.App.watch(async () => { refreshes++ })
        for (let i = 0; i < 100; i++) { view.event(); await view.advance(100) }
        expect(refreshes).toBeGreaterThan(20)
        expect(refreshes).toBeLessThanOrEqual(56)
    })
    test('serializes slow refreshes and preserves a queued update', async () => {
        const view = browser()
        let refreshes = 0
        const releases: (() => void)[] = []
        view.context.App.watch(() => { refreshes++; return new Promise<void>(resolve => releases.push(resolve)) })
        view.event(); await view.advance(180)
        expect(refreshes).toBe(1)
        for (let i = 0; i < 8; i++) { view.event(); await view.advance(100) }
        expect(refreshes).toBe(1)
        releases.shift()!(); await Promise.resolve(); await Promise.resolve()
        expect(refreshes).toBe(2)
        releases.shift()!()
    })
})
const fixture = (status: string) => ({
    id: 1, status, categoryId: 1, categoryName: 'Mixto', court: 'court1', scheduledAt: '2026-10-28T18:00:00Z',
    teamHome: { id: 1, name: 'Local', clubName: 'Local' },
    teamAway: { id: 2, name: 'Visitante <A>', clubName: 'Visitante' },
    sets: [{ id: 1, setNumber: 1, status: 'finished_home', scoreHome: 25, scoreAway: 10, points: [] }],
})
const pageScript = async (path: string) => (await Bun.file(path).text()).match(/<script>([\s\S]*?)<\/script>/)![1]
describe('official match result', () => {
    test('timezone aliases do not produce a false scheduling warning', () => {
        const view = browser()
        expect(view.context.App.sameTimeZone('America/Cordoba', 'America/Argentina/Cordoba')).toBe(true)
        expect(view.context.App.sameTimeZone('Europe/Madrid', 'America/Argentina/Cordoba')).toBe(false)
    })
    test('lobby announces the adjudicated winner even when set totals disagree', async () => {
        const view = browser()
        runInContext(await pageScript('./static/index.html'), view.context)
        view.context.fixture = fixture('finished_away')
        const card = runInContext('card(fixture)', view.context)
        expect(card).toContain('Ganó Visitante &lt;A&gt;')
        expect(card).not.toContain('Ganó Local')
        view.context.fixture = { ...fixture('finished_home'), sets: [] }
        expect(runInContext('card(fixture)', view.context)).toContain('Ganó Local')
    })
    test('detail shows the official winner separately from recorded set totals', async () => {
        const view = browser()
        runInContext(await pageScript('./static/game.html'), view.context)
        view.context.fixture = fixture('finished_away')
        runInContext('currentMatch = fixture; render()', view.context)
        const detail = view.elements.get('content').innerHTML
        expect(detail).toContain('Ganó Visitante &lt;A&gt;')
        expect(detail).toContain('1–0')
        view.context.fixture = fixture('cancelled')
        runInContext('currentMatch = fixture; render()', view.context)
        expect(view.elements.get('content').innerHTML).not.toContain('Ganó')
    })
})
describe('team sides', () => {
    test('score halves use the club logo or the side color, and ignore foreign urls', () => {
        const view = browser()
        const match = { teamHome: { clubLogo: '/uploads/abc-1.png' }, teamAway: { clubLogo: "https://evil.example/x.png');background:red" } }
        view.context.match = match
        const box = runInContext("App.scoreBox(match, { home: 12, away: 10 }, ['away', 'home'])", view.context)
        expect(box).toContain('aria-label="10–12"')
        expect(box.indexOf('team-away')).toBeLessThan(box.indexOf('team-home'))
        expect(box).toContain("--team-logo:url('/uploads/abc-1.png')")
        expect(box).not.toContain('evil')
        expect(runInContext("App.rotationCourt(i => i, { team: { match, side: 'away' } })", view.context)).toContain('class="court team-bg team-away"')
        view.context.sameClub = { teamHome: { clubLogo: '/uploads/a.png' }, teamAway: { clubLogo: '/uploads/a.png' } }
        expect(runInContext("App.scoreBox(sameClub, { home: 1, away: 2 })", view.context)).not.toContain('has-logo')
    })
})
const liveFixture = () => ({
    ...fixture('in_progress'), rules: { bestOf: 3, setPoints: 25, tiebreakPoints: 15, minLead: 2, pointCap: null },
    sets: [
        { id: 1, setNumber: 1, status: 'finished_home', scoreHome: 25, scoreAway: 10, firstServeHome: true, lineups: { home: [1, 2, 3, 4, 5, 6], away: [7, 8, 9, 10, 11, 12] }, points: [{ id: 9, kind: 'rally' }], substitutions: [], rotation: { positions: {} } },
        { id: 2, setNumber: 2, status: 'in_progress', scoreHome: 0, scoreAway: 0, firstServeHome: null, lineups: {}, points: [], substitutions: [], rotation: { serving: null, positions: { home: null, away: null } } },
    ],
})
describe('scorer start of set', () => {
    async function scorer() {
        const view = browser()
        runInContext(await pageScript('./static/manager/game.html'), view.context)
        view.context.fixture = liveFixture()
        runInContext('m = fixture; claim = { mine: true }', view.context)
        return view
    }
    test('a set without toss and lineups asks to start it instead of offering points', async () => {
        const view = await scorer()
        runInContext('renderScore()', view.context)
        const html = view.elements.get('score').innerHTML
        expect(html).toContain('Iniciar set 2')
        expect(html).not.toContain('addPoint')
        expect(runInContext('listText(missing(setupOf(activeSet()), rawName))', view.context)).toBe('quién saca primero, la formación de Local y la formación de Visitante <A>')
    })
    test('a complete setup or a skip shows the point buttons, in the scorer\'s side order', async () => {
        const view = await scorer()
        runInContext("skipped.add(2); swapped = true; renderScore()", view.context)
        const html = view.elements.get('score').innerHTML
        expect(html).toContain('No se sigue la rotación')
        expect(html.indexOf('act(addPoint, false)')).toBeLessThan(html.indexOf('act(addPoint, true)'))
        runInContext("skipped.clear(); Object.assign(activeSet(), { firstServeHome: false, lineups: { home: [1, 2, 3, 4, 5, 6], away: [7, 8, 9, 10, 11, 12] } }); renderScore()", view.context)
        expect(view.elements.get('score').innerHTML).toContain('act(addPoint, true)')
        expect(view.elements.get('score').innerHTML).not.toContain('No se sigue la rotación')
    })
    test('the toss suggestion alternates with the previous set outside the deciding set', async () => {
        const view = await scorer()
        const fields = runInContext("setupFields(activeSet(), 'start')", view.context)
        expect(fields).toMatch(/value="away" checked/)
        expect(fields).toContain('value="1"')
    })
})

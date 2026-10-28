import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { sql } from 'drizzle-orm'
import { sign } from 'hono/jwt'
import { readdir } from 'node:fs/promises'

const integration = describe.skipIf(process.env.RUN_DB_TESTS !== 'true')
integration('API against an isolated PostgreSQL database', () => {
    let app: typeof import('../src/index').default
    let db: typeof import('../src/db').db
    let client: typeof import('../src/db').client
    let cookie: string
    let categoryId: number, clubId: number, home: number, away: number, matchId: number, setId: number
    const name = `test-${crypto.randomUUID().slice(0, 8)}`
    const paths: string[] = []
    const request = (path: string, method = 'GET', body?: unknown, auth = true) => app.request(path, {
        method, headers: { ...(auth ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
    })
    const create = async (path: string, body: unknown) => {
        const res = await request(path, 'POST', body)
        expect(res.status).toBe(201)
        return res.json() as Promise<any>
    }
    beforeAll(async () => {
        // Prevent a developer from accidentally pointing this suite at tournament data.
        const databaseName = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).pathname.slice(1) : process.env.PSQL_DATABASE
        if (!databaseName?.endsWith('_test')) throw new Error('Integration tests require a database name ending in _test')
        ;({ db, client } = await import('../src/db'))
        const { migrateDatabase } = await import('../src/db/migrate')
        await migrateDatabase()
        app = (await import('../src/index')).default
        const login = await request('/api/auth/login', 'POST', { username: process.env.MANAGER_USER ?? 'manager', password: process.env.MANAGER_PASSWORD }, false)
        expect(login.status).toBe(200)
        cookie = login.headers.get('set-cookie')!.split(';')[0]
        expect(cookie).not.toContain(process.env.SESSION_SECRET!)
        categoryId = (await create('/api/categories', { name })).id
        const form = new FormData(); form.set('name', name)
        const clubResponse = await app.request('/api/clubs', { method: 'POST', body: form, headers: { Cookie: cookie } })
        expect(clubResponse.status).toBe(201)
        clubId = ((await clubResponse.json()) as any).id
        home = (await create('/api/teams', { name: `${name}-home`, categoryId, clubId })).id
        away = (await create('/api/teams', { name: `${name}-away`, categoryId, clubId })).id
    })
    afterAll(async () => {
        if (!db) return
        // Only remove this suite's named fixtures; never truncate a database.
        await db.execute(sql`delete from points where set_id in (select id from sets where match_id in (select id from matches where category_id = ${categoryId}))`)
        await db.execute(sql`delete from sets where match_id in (select id from matches where category_id = ${categoryId})`)
        await db.execute(sql`delete from matches where category_id = ${categoryId}`)
        await db.execute(sql`delete from teams where category_id = ${categoryId}`)
        await db.execute(sql`delete from clubs where id = ${clubId}`)
        await db.execute(sql`delete from categories where id = ${categoryId}`)
        for (const path of paths) if (await Bun.file(path).exists()) await Bun.file(path).delete()
        await client.end()
    })
    test('readiness, API 404, invalid input, authorization and CSRF', async () => {
        expect((await request('/healthz')).status).toBe(200)
        expect((await request('/api/unknown')).status).toBe(404)
        expect((await request('/api/categories', 'POST', { name: 'unauthorized' }, false)).status).toBe(401)
        expect((await request('/api/categories', 'POST', { name: '' })).status).toBe(400)
        expect((await request('/api/matches/nope')).status).toBe(400)
        expect((await request('/api/matches?status=wrong')).status).toBe(400)
        const csrf = await app.request('/api/auth/logout', { method: 'POST', headers: { Origin: 'https://attacker.invalid' } })
        expect(csrf.status).toBe(403)
        expect((await request('/manager/', 'GET', undefined, false)).status).toBe(302)
        for (const path of ['/manager', '//manager/index.html', '/%256danager/index.html', '/%6danager/index.html', '/manager%2findex.html']) {
            const response = await request(path, 'GET', undefined, false)
            expect([302, 404]).toContain(response.status)
        }
        const expired = await sign({ sub: 'manager', exp: 1 }, process.env.SESSION_SECRET!, 'HS256')
        expect((await app.request('/api/auth/me', { headers: { Cookie: `session=${expired}` } })).status).toBe(401)
    })
    test('validates teams and creates match atomically', async () => {
        const data = { teamHomeId: home, teamAwayId: away, categoryId, court: 'court1', scheduledAt: new Date().toISOString() }
        expect((await request('/api/matches', 'POST', { ...data, teamAwayId: home })).status).toBe(400)
        matchId = (await create('/api/matches', data)).id
        const match: any = await (await request(`/api/matches/${matchId}`)).json()
        expect(match.sets).toHaveLength(1)
        setId = match.sets[0].id
        expect((await request('/api/points', 'POST', { setId, homeScored: true })).status).toBe(409)
        expect((await request(`/api/matches/${matchId}`, 'PUT', { status: 'in_progress' })).status).toBe(200)
    })
    test('twenty simultaneous points preserve every rally and reject stale undo', async () => {
        const results = await Promise.all(Array.from({ length: 20 }, (_, i) => request('/api/points', 'POST', { setId, homeScored: i % 2 === 0 })))
        for (const result of results) expect(result.status).toBe(201)
        const match: any = await (await request(`/api/matches/${matchId}`)).json()
        expect(match.sets[0].scoreHome).toBe(10); expect(match.sets[0].scoreAway).toBe(10)
        expect(match.sets[0].points).toHaveLength(20)
        expect((await request(`/api/points/${match.sets[0].points[0].id}`, 'DELETE')).status).toBe(409)
        expect((await request(`/api/points/${match.sets[0].points.at(-1).id}`, 'DELETE')).status).toBe(200)
        const list: any[] = await (await request(`/api/matches?categoryId=${categoryId}`)).json()
        expect(list[0].sets[0].scoreHome + list[0].sets[0].scoreAway).toBe(19)
        expect(list[0].sets[0].points).toBeUndefined()
    })
    test('rejects negative/fractional scores and duplicate set finish; cancellation creates playable replacement', async () => {
        expect((await request(`/api/sets/${setId}/finish`, 'POST', { scoreHome: -1, scoreAway: 1, status: 'finished_home' })).status).toBe(400)
        expect((await request('/api/points', 'POST', { setId, homeScored: 'false' })).status).toBe(400)
        const before: any = await (await request(`/api/matches/${matchId}`)).json()
        const expectedLastPointId = before.sets[0].points.at(-1)?.id ?? null
        const results = await Promise.all([1, 2].map(() => request(`/api/sets/${setId}/finish`, 'POST', { scoreHome: 25, scoreAway: 23, status: 'finished_home', expectedLastPointId })))
        expect(results.map(r => r.status).sort()).toEqual([200, 409])
        let match: any = await (await request(`/api/matches/${matchId}`)).json()
        expect(match.sets).toHaveLength(2)
        expect((await request(`/api/sets/${match.sets[1].id}`, 'PUT', { status: 'cancelled', expectedLastPointId: null })).status).toBe(200)
        match = await (await request(`/api/matches/${matchId}`)).json()
        expect(match.sets.filter((s: any) => s.status === 'in_progress')).toHaveLength(1)
        expect((await request(`/api/matches/${matchId}`, 'PUT', { status: 'finished_home' })).status).toBe(200)
        expect((await request('/api/points', 'POST', { setId: match.sets.at(-1).id, homeScored: true })).status).toBe(409)
    })
    test('stale close/cancel requests cannot overwrite a rally; fresh manual rulings remain allowed', async () => {
        const match = await create('/api/matches', { teamHomeId: home, teamAwayId: away, categoryId, court: 'court2', scheduledAt: new Date().toISOString() })
        await request(`/api/matches/${match.id}`, 'PUT', { status: 'in_progress' })
        let detail: any = await (await request(`/api/matches/${match.id}`)).json()
        const activeId = detail.sets[0].id
        const point = await create('/api/points', { setId: activeId, homeScored: true })
        const final = { scoreHome: 0, scoreAway: 0, status: 'finished_away' }
        expect((await request(`/api/sets/${activeId}/finish`, 'POST', final)).status).toBe(400)
        expect((await request(`/api/sets/${activeId}/finish`, 'POST', { ...final, expectedLastPointId: null })).status).toBe(409)
        expect((await request(`/api/sets/${activeId}`, 'PUT', { status: 'cancelled', expectedLastPointId: null })).status).toBe(409)
        detail = await (await request(`/api/matches/${match.id}`)).json()
        expect(detail.sets[0].status).toBe('in_progress')
        expect(detail.sets[0].scoreHome).toBe(1)
        expect(detail.sets[0].points).toHaveLength(1)
        expect((await request(`/api/sets/${activeId}/finish`, 'POST', { ...final, expectedLastPointId: point.id })).status).toBe(200)
        detail = await (await request(`/api/matches/${match.id}`)).json()
        expect(detail.sets[0].scoreHome).toBe(0)
        expect(detail.sets[0].status).toBe('finished_away')
        expect(detail.sets[0].points).toHaveLength(2)
    })
    test('login abuse from one client cannot block another; spoofed headers are ignored locally', async () => {
        const login = (peer: string, password: string, forwarded?: string) => app.request('/api/auth/login', {
            method: 'POST', headers: { 'Content-Type': 'application/json', ...(forwarded ? { 'X-Forwarded-For': forwarded } : {}) },
            body: JSON.stringify({ username: process.env.MANAGER_USER ?? 'manager', password }),
        }, { clientAddress: peer })
        for (let i = 0; i < 30; i++) expect((await login('198.51.100.10', 'invalid')).status).toBe(401)
        const blocked = await login('198.51.100.10', process.env.MANAGER_PASSWORD!)
        expect(blocked.status).toBe(429)
        expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0)
        expect((await login('198.51.100.10', 'invalid', '203.0.113.99')).status).toBe(429)
        expect((await login('198.51.100.20', process.env.MANAGER_PASSWORD!)).status).toBe(200)
        expect((await request('/api/auth/login', 'POST', { username: 'x'.repeat(5000), password: 'invalid' }, false)).status).toBe(413)
    })
    test('keeps fixture categories consistent when editing a team', async () => {
        const other = await create('/api/categories', { name: `${name}-other` })
        try {
            const response = await request(`/api/teams/${home}`, 'PUT', { name: `${name}-home`, clubId, categoryId: other.id })
            expect(response.status).toBe(409)
            const teamRows: any[] = await (await request('/api/teams')).json()
            expect(teamRows.find(t => t.id === home).categoryId).toBe(categoryId)
        } finally { await request(`/api/categories/${other.id}`, 'DELETE') }
    })
    test('logos validate bytes and use safe names; referenced records cannot be deleted', async () => {
        const bad = new FormData(); bad.set('name', name); bad.set('logo', new File(['<script>alert(1)</script>'], '../../bad.png', { type: 'image/png' }))
        expect((await app.request(`/api/clubs/${clubId}`, { method: 'PUT', body: bad, headers: { Cookie: cookie } })).status).toBe(400)
        const good = new FormData(); good.set('name', name)
        good.set('logo', new File([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jY9kAAAAASUVORK5CYII='), c => c.charCodeAt(0))], '../../valid.png', { type: 'image/png' }))
        const response = await app.request(`/api/clubs/${clubId}`, { method: 'PUT', body: good, headers: { Cookie: cookie } })
        expect(response.status).toBe(200)
        const club: any = await response.json()
        expect(club.logo).toMatch(/^\/uploads\/[\w-]+\.png$/)
        paths.push(`${process.env.UPLOAD_DIR ?? './static/uploads'}/${club.logo.split('/').at(-1)}`)
        expect((await request(club.logo)).headers.get('content-type')).toContain('image/png')
        expect((await request(`/api/clubs/${clubId}`, 'DELETE')).status).toBe(409)
    })
    test('rolls back new logos and removes replaced/deleted files without breaking shared references', async () => {
        const directory = process.env.UPLOAD_DIR ?? './static/uploads'
        const upload = (clubName: string) => {
            const body = new FormData(); body.set('name', clubName)
            body.set('logo', new File([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jY9kAAAAASUVORK5CYII='), c => c.charCodeAt(0))], 'logo.png', { type: 'image/png' }))
            return body
        }
        const save = (path: string, method: string, clubName: string) => app.request(path, { method, body: upload(clubName), headers: { Cookie: cookie } })
        const file = (url: string) => Bun.file(`${directory}/${url.split('/').at(-1)}`)
        const before = (await readdir(directory)).sort()
        expect((await save('/api/clubs', 'POST', name)).status).toBe(409)
        expect((await readdir(directory)).sort()).toEqual(before)
        expect((await save('/api/clubs/2000000000', 'PUT', name)).status).toBe(404)
        expect((await readdir(directory)).sort()).toEqual(before)
        const existing: any[] = await (await request('/api/clubs')).json()
        const old = existing.find(c => c.id === clubId).logo
        const replacement = await save(`/api/clubs/${clubId}`, 'PUT', name)
        expect(replacement.status).toBe(200)
        const current: any = await replacement.json()
        paths.push(`${directory}/${current.logo.split('/').at(-1)}`)
        expect(await file(old).exists()).toBe(false)
        expect(await file(current.logo).exists()).toBe(true)
        const body = new FormData(); body.set('name', `${name}-shared-logo`)
        const added = await app.request('/api/clubs', { method: 'POST', body, headers: { Cookie: cookie } })
        expect(added.status).toBe(201)
        const other: any = await added.json()
        try {
            await db.execute(sql`update clubs set logo = ${current.logo} where id = ${other.id}`)
            const response = await save(`/api/clubs/${clubId}`, 'PUT', name)
            expect(response.status).toBe(200)
            const next: any = await response.json()
            paths.push(`${directory}/${next.logo.split('/').at(-1)}`)
            expect(await file(current.logo).exists()).toBe(true)
            expect((await request(`/api/clubs/${other.id}`, 'DELETE')).status).toBe(200)
            expect(await file(current.logo).exists()).toBe(false)
            expect(await file(next.logo).exists()).toBe(true)
        } finally { await request(`/api/clubs/${other.id}`, 'DELETE') }
    })
    test('SSE establishes a live channel and receives update notifications', async () => {
        const controller = new AbortController()
        const response = await app.request('/api/events', { signal: controller.signal })
        expect(response.headers.get('content-type')).toContain('text/event-stream')
        const reader = response.body!.getReader()
        const first = await reader.read()
        expect(new TextDecoder().decode(first.value)).toContain('event: change')
        await request(`/api/categories/${categoryId}`, 'PUT', { name })
        const next = await reader.read()
        expect(new TextDecoder().decode(next.value)).toContain('data: refresh')
        controller.abort(); await reader.cancel()
    })
})

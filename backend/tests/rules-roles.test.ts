import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { sql } from 'drizzle-orm'

const integration = describe.skipIf(process.env.RUN_DB_TESTS !== 'true')
integration('roles, set rules, rotation and standings', () => {
    let app: typeof import('../src/index').default
    let db: typeof import('../src/db').db
    let client: typeof import('../src/db').client
    let admin: string, scorer: string
    let categoryId: number, clubId: number, home: number, away: number
    const name = `rules-${crypto.randomUUID().slice(0, 8)}`
    const scorerName = `${name}-scorer`
    const call = (cookie: string | null, path: string, method = 'GET', body?: unknown) => app.request(path, {
        method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
    })
    const json = async (cookie: string | null, path: string, method = 'GET', body?: unknown, status = method === 'POST' ? 201 : 200) => {
        const res = await call(cookie, path, method, body)
        if (res.status !== status) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`)
        return res.json() as Promise<any>
    }
    const login = async (username: string, password: string) => {
        const res = await call(null, '/api/auth/login', 'POST', { username, password })
        expect(res.status).toBe(200)
        return res.headers.get('set-cookie')!.split(';')[0]
    }
    const detail = (id: number) => json(null, `/api/matches/${id}`)
    const newMatch = async (rules?: object) => {
        const match = await json(admin, '/api/matches', 'POST', { teamHomeId: home, teamAwayId: away, categoryId, court: 'court1', scheduledAt: new Date().toISOString(), ...(rules ? { rules } : {}) })
        await json(scorer, `/api/matches/${match.id}`, 'PUT', { status: 'in_progress', expectedStatus: 'upcoming' })
        return match.id as number
    }
    const rally = async (matchId: number, homeScored: boolean, times = 1) => {
        let last: any
        for (let i = 0; i < times; i++) {
            const active = (await detail(matchId)).sets.find((s: any) => s.status === 'in_progress')
            last = await json(scorer, '/api/points', 'POST', { setId: active.id, homeScored })
        }
        return last
    }
    beforeAll(async () => {
        const databaseName = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).pathname.slice(1) : process.env.PSQL_DATABASE
        if (!databaseName?.endsWith('_test')) throw new Error('Integration tests require a database name ending in _test')
        ;({ db, client } = await import('../src/db'))
        await (await import('../src/db/migrate')).migrateDatabase()
        app = (await import('../src/index')).default
        admin = await login(process.env.MANAGER_USER ?? 'manager', process.env.MANAGER_PASSWORD!)
        await json(admin, '/api/users', 'POST', { username: scorerName, displayName: 'Planillero de prueba', role: 'scorer', password: 'scorer-password-1' })
        scorer = await login(scorerName, 'scorer-password-1')
        categoryId = (await json(admin, '/api/categories', 'POST', { name, bestOf: 3, setPoints: 5, tiebreakPoints: 3, minLead: 2, pointCap: null })).id
        const form = new FormData(); form.set('name', name)
        clubId = ((await (await app.request('/api/clubs', { method: 'POST', body: form, headers: { Cookie: admin } })).json()) as any).id
        home = (await json(admin, '/api/teams', 'POST', { name: `${name}-home`, categoryId, clubId })).id
        away = (await json(admin, '/api/teams', 'POST', { name: `${name}-away`, categoryId, clubId })).id
    })
    afterAll(async () => {
        if (!db) return
        await db.execute(sql`delete from points where set_id in (select id from sets where match_id in (select id from matches where category_id = ${categoryId}))`)
        await db.execute(sql`delete from sets where match_id in (select id from matches where category_id = ${categoryId})`)
        await db.execute(sql`delete from matches where category_id = ${categoryId}`)
        await db.execute(sql`delete from teams where category_id = ${categoryId}`)
        await db.execute(sql`delete from clubs where id = ${clubId}`)
        await db.execute(sql`delete from categories where id = ${categoryId}`)
        await db.execute(sql`delete from users where username like ${name + '%'}`)
        // The DB client is shared by every test file in this process; bun closes it on exit.
    })

    test('roles: public reads, scorers run matches, admins manage the tournament', async () => {
        expect((await json(scorer, '/api/auth/me')).role).toBe('scorer')
        expect((await call(null, '/api/standings')).status).toBe(200)
        expect((await call(null, '/api/points', 'POST', { setId: 1, homeScored: true })).status).toBe(401)
        expect((await call(scorer, '/api/categories', 'POST', { name: `${name}-x` })).status).toBe(403)
        expect((await call(scorer, '/api/users')).status).toBe(403)
        expect((await call(scorer, '/manager/categories.html')).status).toBe(302)
        expect((await call(scorer, '/manager/')).status).not.toBe(302)
        const match = await json(admin, '/api/matches', 'POST', { teamHomeId: home, teamAwayId: away, categoryId, court: 'court2', scheduledAt: new Date().toISOString() })
        expect(match.bestOf).toBe(3)
        expect(match.setPoints).toBe(5)
        expect((await call(scorer, `/api/matches/${match.id}`, 'PUT', { court: 'court1' })).status).toBe(403)
        expect((await call(scorer, `/api/matches/${match.id}`, 'PUT', { status: 'cancelled' })).status).toBe(403)
        expect((await call(scorer, `/api/matches/${match.id}`, 'PUT', { status: 'in_progress' })).status).toBe(200)
        const set = (await detail(match.id)).sets[0]
        expect((await call(scorer, `/api/sets/${set.id}`, 'PUT', { status: 'cancelled', expectedLastPointId: null })).status).toBe(403)
        expect((await call(scorer, `/api/matches/${match.id}`, 'DELETE')).status).toBe(403)
        const history: any[] = await json(scorer, `/api/matches/${match.id}/history`)
        expect(history[0].actor).toBe(scorerName)
    })

    test('category rules are copied to matches and validated', async () => {
        expect((await call(admin, '/api/categories', 'POST', { name: `${name}-even`, bestOf: 4 })).status).toBe(400)
        expect((await call(admin, '/api/categories', 'POST', { name: `${name}-cap`, setPoints: 25, pointCap: 20 })).status).toBe(400)
        const custom = await json(admin, '/api/matches', 'POST', { teamHomeId: home, teamAwayId: away, categoryId, court: 'court1', scheduledAt: new Date().toISOString(), rules: { bestOf: 5, setPoints: 25, tiebreakPoints: 15, minLead: 2, pointCap: null } })
        expect(custom.bestOf).toBe(5)
        await json(admin, `/api/categories/${categoryId}`, 'PUT', { name })
        const categories: any[] = await json(null, '/api/categories')
        expect(categories.find(c => c.id === categoryId).setPoints).toBe(5)
        await json(admin, `/api/matches/${custom.id}`, 'DELETE')
    })

    test('rallies close sets and the match automatically; undo reopens them', async () => {
        const id = await newMatch()
        await rally(id, true, 4)
        const closing = await rally(id, true)
        expect(closing.setWinner).toBe('home')
        let match = await detail(id)
        expect(match.sets.map((s: any) => s.status)).toEqual(['finished_home', 'in_progress'])
        // Undo across the automatic close: the empty next set disappears.
        await json(scorer, `/api/points/${closing.id}`, 'DELETE')
        match = await detail(id)
        expect(match.sets).toHaveLength(1)
        expect(match.sets[0]).toMatchObject({ status: 'in_progress', scoreHome: 4 })
        await rally(id, true)
        await rally(id, false, 5)
        match = await detail(id)
        expect(match.sets.map((s: any) => s.status)).toEqual(['finished_home', 'finished_away', 'in_progress'])
        // Deciding set to 3 with a two-point lead.
        await rally(id, true, 2); await rally(id, false, 2); await rally(id, true)
        expect((await detail(id)).status).toBe('in_progress')
        const final = await rally(id, true)
        expect(final.matchWinner).toBe('home')
        match = await detail(id)
        expect(match.status).toBe('finished_home')
        expect(match.sets).toHaveLength(3)
        expect((await call(scorer, '/api/points', 'POST', { setId: match.sets[2].id, homeScored: true })).status).toBe(409)
        // Undo the match-winning rally reopens the match.
        await json(scorer, `/api/points/${final.id}`, 'DELETE')
        match = await detail(id)
        expect(match.status).toBe('in_progress')
        expect(match.sets[2]).toMatchObject({ status: 'in_progress', scoreHome: 3, scoreAway: 2 })
        await rally(id, true)
        const standings: any[] = await json(null, `/api/standings?categoryId=${categoryId}`)
        const rows = standings[0].rows
        expect(rows[0]).toMatchObject({ id: home, points: 2, won: 1, setsWon: 2, setsLost: 1 })
        expect(rows[1]).toMatchObject({ id: away, points: 1, lost: 1 })
    })

    test('final scores entered at once must be valid for the rules', async () => {
        const id = await newMatch()
        const set = (await detail(id)).sets[0]
        expect((await call(scorer, `/api/sets/${set.id}/finish`, 'POST', { scoreHome: 8, scoreAway: 5, expectedLastPointId: null })).status).toBe(400)
        expect((await call(scorer, `/api/sets/${set.id}/finish`, 'POST', { scoreHome: 5, scoreAway: 3, status: 'finished_away', expectedLastPointId: null })).status).toBe(400)
        const result = await json(scorer, `/api/sets/${set.id}/finish`, 'POST', { scoreHome: 7, scoreAway: 5, expectedLastPointId: null }, 200)
        expect(result.setWinner).toBe('home')
        const second = (await detail(id)).sets[1]
        const done = await json(scorer, `/api/sets/${second.id}/finish`, 'POST', { scoreHome: 5, scoreAway: 0, expectedLastPointId: null }, 200)
        expect(done.matchWinner).toBe('home')
        // Admin corrections are rulings and cannot be undone from the scoreboard.
        const closed = (await detail(id)).sets[1]
        await json(admin, `/api/sets/${closed.id}/correct`, 'POST', { scoreHome: 5, scoreAway: 1, status: 'finished_home', expectedStatus: closed.status, expectedRevision: closed.revision, expectedLastPointId: closed.points.at(-1).id, reason: 'Planilla revisada' }, 200)
        const corrected = (await detail(id)).sets[1]
        expect((await call(scorer, `/api/points/${corrected.points.at(-1).id}`, 'DELETE')).status).toBe(409)
        expect((await call(scorer, `/api/sets/${closed.id}/correct`, 'POST', {})).status).toBe(400)
    })

    test('lineups rotate on side-out, substitutions apply in place, undo stays consistent', async () => {
        const id = await newMatch()
        const set = (await detail(id)).sets[0]
        expect((await call(scorer, `/api/sets/${set.id}/lineup`, 'PUT', { firstServeHome: true, home: [1, 2, 3, 4, 5, 5], away: null })).status).toBe(400)
        await json(scorer, `/api/sets/${set.id}/lineup`, 'PUT', { firstServeHome: true, home: [1, 2, 3, 4, 5, 6], away: [11, 12, 13, 14, 15, 16] })
        await rally(id, true)
        await rally(id, false)
        let current = (await detail(id)).sets[0]
        expect(current.rotation.serving).toBe('away')
        expect(current.rotation.positions.away).toEqual([12, 13, 14, 15, 16, 11])
        expect(current.rotation.positions.home).toEqual([1, 2, 3, 4, 5, 6])
        expect((await call(scorer, `/api/sets/${set.id}/substitutions`, 'POST', { side: 'home', playerOut: 7, playerIn: 8 })).status).toBe(409)
        const change = await json(scorer, `/api/sets/${set.id}/substitutions`, 'POST', { side: 'home', playerOut: 2, playerIn: 9 })
        // The rally before the change cannot be undone until the change is.
        expect((await call(scorer, `/api/points/${current.points.at(-1).id}`, 'DELETE')).status).toBe(409)
        const sideOut = await rally(id, true)
        current = (await detail(id)).sets[0]
        expect(current.rotation.positions.home).toEqual([9, 3, 4, 5, 6, 1])
        expect((await call(scorer, `/api/sets/${set.id}/substitutions/${change.id}`, 'DELETE')).status).toBe(409)
        await json(scorer, `/api/points/${sideOut.id}`, 'DELETE')
        await json(scorer, `/api/sets/${set.id}/substitutions/${change.id}`, 'DELETE')
        current = (await detail(id)).sets[0]
        expect(current.rotation.positions.home).toEqual([1, 2, 3, 4, 5, 6])
        expect(current.substitutions).toHaveLength(0)
        // Closing the set opens the next one with the serve alternated.
        await rally(id, true, 5)
        const next = (await detail(id)).sets[1]
        expect(next.firstServeHome).toBe(false)
    })

    test('revoking a user or changing their role reaches open sessions', async () => {
        const users = (await json(admin, '/api/users')).users as any[]
        const target = users.find(u => u.username === scorerName)
        expect(target.passwordHash).toBeUndefined()
        expect((await call(admin, '/api/users', 'POST', { username: process.env.MANAGER_USER ?? 'manager', displayName: 'x', role: 'admin', password: 'another-password' })).status).toBe(409)
        await json(admin, `/api/users/${target.id}`, 'PUT', { active: false })
        expect((await call(scorer, '/api/auth/me')).status).toBe(401)
        expect((await call(null, '/api/auth/login', 'POST', { username: scorerName, password: 'scorer-password-1' })).status).toBe(401)
        await json(admin, `/api/users/${target.id}`, 'PUT', { active: true, role: 'admin' })
        const promoted = await login(scorerName, 'scorer-password-1')
        expect((await json(promoted, '/api/auth/me')).role).toBe('admin')
        expect((await call(promoted, `/api/users/${target.id}`, 'PUT', { role: 'scorer' })).status).toBe(409)
        expect((await call(admin, '/api/users', 'POST', { username: 'ab', displayName: 'x', role: 'scorer', password: 'short' })).status).toBe(400)
    })
})

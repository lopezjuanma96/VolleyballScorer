// Executed inside the disposable app container, never against the tournament DB.
import { db, client } from './src/db'
import { categories, clubs, teams, matches, sets, points } from './src/db/schema'
const databaseName = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).pathname.slice(1) : process.env.PSQL_DATABASE
if (databaseName !== 'volleyball_load_test' || !process.env.TOURNAMENT_NAME?.startsWith('volleyball-load-')) throw new Error('Disposable load database required')
try {
    await db.transaction(async tx => {
        const cats = await tx.insert(categories).values(Array.from({ length: 6 }, (_, i) => ({ name: `Categoría ${i + 1}` }))).returning()
        const [club] = await tx.insert(clubs).values({ name: 'Club de prueba' }).returning()
        const teamRows = await tx.insert(teams).values(cats.flatMap(c => Array.from({ length: 8 }, (_, i) => ({ clubId: club.id, categoryId: c.id, name: `Equipo ${c.id}-${i + 1}` })))).returning()
        for (let i = 0; i < 120; i++) {
            const cat = cats[i % cats.length]
            const categoryTeams = teamRows.filter(t => t.categoryId === cat.id)
            const [match] = await tx.insert(matches).values({ categoryId: cat.id, teamHomeId: categoryTeams[0].id, teamAwayId: categoryTeams[1].id, court: i % 2 ? 'court2' : 'court1', scheduledAt: new Date(Date.UTC(2026, 10, 1, 12, i * 30)), status: i < 2 ? 'in_progress' : i < 82 ? 'finished_home' : 'upcoming' }).returning()
            for (let n = 1; n <= (i >= 2 && i < 82 ? 3 : 1); n++) {
                const [set] = await tx.insert(sets).values({ matchId: match.id, setNumber: n, status: i >= 2 && i < 82 ? 'finished_home' : 'in_progress' }).returning()
                if (i >= 2 && i < 82) await tx.insert(points).values(Array.from({ length: 45 }, (_, p) => ({ setId: set.id, scoreHome: Math.ceil((p + 1) * 25 / 45), scoreAway: Math.floor((p + 1) * 20 / 45), homeScored: p % 2 === 0 })))
            }
        }
    })
    console.info('Fixture: 120 matches, 6 categories, 48 teams, 240 completed sets, 10,800 historical score records, 2 live courts')
} finally { await client.end() }

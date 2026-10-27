import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { createClient } from './config'

export async function migrateDatabase() {
    const client = createClient(true)
    try {
        await migrate(drizzle(client), { migrationsFolder: './db/migrations' })
        console.info('Database migrations applied')
    } finally { await client.end() }
}
if (import.meta.main) await migrateDatabase()

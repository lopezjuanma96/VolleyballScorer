import postgres from 'postgres'

// DATABASE_URL works with managed PostgreSQL; PSQL_* preserves onprem setups.
export function createClient(migrations = false) {
    const options = { max: migrations ? 1 : 5, idle_timeout: 20, connect_timeout: 10, prepare: false, onnotice: () => {} }
    if (process.env.DATABASE_URL) return postgres(process.env.DATABASE_URL, options)
    return postgres({
        ...options,
        host: process.env.PSQL_HOST ?? 'localhost',
        port: Number(process.env.PSQL_PORT ?? 5432),
        database: process.env.PSQL_DATABASE ?? 'scorer',
        username: migrations ? (process.env.PSQL_ADMIN_USER ?? process.env.PSQL_USER ?? 'scorer') : (process.env.PSQL_USER ?? 'scorer'),
        password: migrations ? (process.env.PSQL_ADMIN_PASSWORD ?? process.env.PSQL_PASSWORD) : process.env.PSQL_PASSWORD,
    })
}

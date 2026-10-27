import { defineConfig } from 'drizzle-kit'

export default defineConfig({
    schema: './src/db/schema.ts', out: './db/migrations', dialect: 'postgresql',
    dbCredentials: process.env.DATABASE_URL ? { url: process.env.DATABASE_URL } : {
        host: process.env.PSQL_HOST ?? 'localhost', port: Number(process.env.PSQL_PORT ?? 5432),
        database: process.env.PSQL_DATABASE ?? 'scorer',
        user: process.env.PSQL_ADMIN_USER ?? process.env.PSQL_USER ?? 'scorer',
        password: process.env.PSQL_ADMIN_PASSWORD ?? process.env.PSQL_PASSWORD,
    },
})

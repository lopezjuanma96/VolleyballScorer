import { defineConfig } from 'drizzle-kit'

export default defineConfig({
    schema: './src/db/schema.ts',
    out: './db/migrations',
    dialect: 'postgresql',
    dbCredentials: {
        host: process.env.PSQL_HOST ?? 'localhost',
        port: Number(process.env.PSQL_PORT ?? 5432),
        database: process.env.PSQL_DATABASE!,
        user: process.env.PSQL_ADMIN_USER!,
        password: process.env.PSQL_ADMIN_PASSWORD!,
    },
})

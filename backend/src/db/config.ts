export const dbConfig = {
    host: process.env.PSQL_HOST ?? 'localhost',
    port: Number(process.env.PSQL_PORT ?? 5432),
    database: process.env.PSQL_DATABASE!,
    password: process.env.PSQL_PASSWORD!,
}

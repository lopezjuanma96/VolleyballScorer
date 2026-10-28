import { config } from './config'
import { migrateDatabase } from './db/migrate'
import { client } from './db'

if (config.AUTO_MIGRATE === 'true') await migrateDatabase()
const { default: app } = await import('./index')
const server = Bun.serve({
    fetch(request, server) { return app.fetch(request, { clientAddress: server.requestIP(request)?.address }) },
    port: config.PORT, hostname: '0.0.0.0', idleTimeout: 60,
})
console.info(`VolleyballScorer listening on :${server.port} (${config.DEPLOY_MODE})`)
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, async () => {
        server.stop(true)
        await client.end({ timeout: 5 })
        process.exit(0)
    })
}

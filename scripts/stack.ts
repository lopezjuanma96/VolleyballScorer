import { existsSync } from 'node:fs'

if (!existsSync('.env')) throw new Error('Primero ejecutá bun scripts/setup.ts o creá .env desde .env.example.')
const mode = process.env.DEPLOY_MODE ?? 'local'
if (!['local', 'onprem', 'cloud'].includes(mode)) throw new Error('DEPLOY_MODE debe ser local, onprem o cloud.')
if (process.argv.includes('up')) {
    if (mode !== 'local' && !process.env.PUBLIC_URL?.startsWith('https://')) throw new Error('Configurá PUBLIC_URL con el origen HTTPS público.')
    if (mode === 'onprem' && !process.env.NGROK_AUTHTOKEN) throw new Error('Configurá NGROK_AUTHTOKEN en .env.')
    if (mode === 'cloud' && new URL(process.env.PUBLIC_URL!).hostname !== process.env.DOMAIN) throw new Error('DOMAIN debe coincidir con el host de PUBLIC_URL.')
}
const proc = Bun.spawn(['docker', 'compose', ...process.argv.slice(2)], {
    env: { ...process.env, COMPOSE_PROFILES: mode === 'local' ? '' : mode },
    stdin: 'inherit', stdout: 'inherit', stderr: 'inherit',
})
process.exit(await proc.exited)

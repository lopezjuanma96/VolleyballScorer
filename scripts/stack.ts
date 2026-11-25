import { existsSync } from 'node:fs'

if (!existsSync('.env')) throw new Error('Primero ejecutá bun scripts/setup.ts o creá .env desde .env.example.')
const mode = process.env.DEPLOY_MODE ?? 'local'
if (!['local', 'onprem', 'cloud', 'edge'].includes(mode)) throw new Error('DEPLOY_MODE debe ser local, onprem, cloud o edge.')
// Services that exist in a single mode, as Compose profiles. edge uses the shared Caddy of the vps-ops repo.
const profiled: Record<string, string> = { onprem: 'ngrok', cloud: 'caddy' }
const files = ['-f', 'docker-compose.yml', ...(mode === 'edge' ? ['-f', 'deploy/compose.edge.yml'] : [])]
const args = process.argv.slice(2)
const command = args.find(arg => !arg.startsWith('-'))
const network = process.env.EDGE_NETWORK || 'edge'
const alias = process.env.EDGE_ALIAS || 'voley'

if (command === 'up') {
    if (mode !== 'local' && !process.env.PUBLIC_URL?.startsWith('https://')) throw new Error('Configurá PUBLIC_URL con el origen HTTPS público.')
    if (mode === 'onprem' && !process.env.NGROK_AUTHTOKEN) throw new Error('Configurá NGROK_AUTHTOKEN en .env.')
    if (mode === 'cloud' && new URL(process.env.PUBLIC_URL!).hostname !== process.env.DOMAIN) throw new Error('DOMAIN debe coincidir con el host de PUBLIC_URL.')
    if (mode === 'edge' && ['app', 'db'].includes(alias)) throw new Error('EDGE_ALIAS tiene que ser un nombre único en la red compartida (por ejemplo voley), no app ni db.')
}
if (mode === 'edge' && command && ['up', 'create', 'run', 'start', 'restart'].includes(command)) {
    const probe = Bun.spawnSync(['docker', 'network', 'inspect', network], { stdout: 'ignore', stderr: 'ignore' })
    if (probe.exitCode !== 0) throw new Error(`No existe la red Docker «${network}» del Caddy compartido. Creala una vez con: docker network create ${network}`)
}

const env = { ...process.env, COMPOSE_PROFILES: profiled[mode] ? mode : '' }
const compose = (composeArgs: string[], extra: Record<string, string> = {}) => Bun.spawn(['docker', 'compose', ...files, ...composeArgs], {
    env: { ...env, ...extra }, stdin: 'inherit', stdout: 'inherit', stderr: 'inherit',
}).exited
let code = await compose(args)
if (code === 0 && command === 'up' && args.includes('--remove-orphans')) {
    // Compose does not treat services of an inactive profile as orphans, so switching
    // modes (cloud → edge) would leave the old Caddy holding 80/443. Remove it explicitly.
    const stale = Object.entries(profiled).filter(([owner]) => owner !== mode).map(([, service]) => service)
    const allProfiles = { COMPOSE_PROFILES: Object.keys(profiled).join(',') }
    const leftover = Bun.spawnSync(['docker', 'compose', ...files, 'ps', '--all', '--quiet', ...stale], { env: { ...env, ...allProfiles } })
    if (leftover.stdout.toString().trim()) code = await compose(['rm', '--stop', '--force', ...stale], allProfiles)
}
process.exit(code)

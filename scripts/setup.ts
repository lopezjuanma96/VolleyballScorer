import { existsSync } from 'node:fs'

if (existsSync('.env')) {
    console.error('.env ya existe. Editalo directamente; no se sobrescribió.')
    process.exit(1)
}
const template = await Bun.file('.env.example').text()
const random = () => crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '')
const password = random().slice(0, 24)
await Bun.write('.env', template.replace('PSQL_PASSWORD=\n', `PSQL_PASSWORD=${random()}\n`).replace('MANAGER_PASSWORD=\n', `MANAGER_PASSWORD=${password}\n`).replace('SESSION_SECRET=\n', `SESSION_SECRET=${random()}\n`))
await Bun.$`chmod 600 .env`
console.info('Configuración local creada en .env. Usuario: manager. La contraseña está en MANAGER_PASSWORD.')

// Bun loads root .env; pass credentials to Python through the environment.
const args = process.argv.slice(2)
const proc = Bun.spawn(['python3', 'scripts/import-teams.py', ...args], { stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' })
process.exit(await proc.exited)

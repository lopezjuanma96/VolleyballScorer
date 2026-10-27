export {}
const children = [
    Bun.spawn(['bun', 'run', 'css', '--watch'], { stdout: 'inherit', stderr: 'inherit' }),
    Bun.spawn(['bun', '--watch', 'src/start.ts'], { stdout: 'inherit', stderr: 'inherit' }),
]
let stopping = false
function stop() {
    if (stopping) return
    stopping = true
    for (const child of children) child.kill('SIGTERM')
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
const exitCode = await Promise.race(children.map(child => child.exited))
stop()
await Promise.all(children.map(child => child.exited))
process.exit(exitCode)

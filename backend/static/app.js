window.App = {
    config: { name: 'Torneo de vóley', subtitle: 'Cada punto cuenta.', timeZone: 'America/Argentina/Cordoba' },
    escape(value) { return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]) },
    async fetch(url, options = {}) {
        try {
            const response = await fetch(url, { ...options, signal: options.signal ?? AbortSignal.timeout(15000) })
            if (response.status === 401 && location.pathname.startsWith('/manager')) location.assign('/login.html')
            if (!response.ok && options.method && options.method !== 'GET') {
                const body = await response.clone().json().catch(() => ({}))
                App.toast(body.error ?? 'No se pudo guardar el cambio.', true)
            }
            return response
        } catch (error) {
            App.toast('No hay conexión. Revisá la red e intentá otra vez.', true)
            throw error
        }
    },
    async json(url, options) {
        const response = await App.fetch(url, options)
        if (!response.ok) {
            const body = await response.json().catch(() => ({}))
            throw new Error(body.error ?? 'No se pudieron cargar los datos.')
        }
        return response.json()
    },
    time(value) { return new Date(value).toLocaleTimeString('es-AR', { timeZone: App.config.timeZone, hour: '2-digit', minute: '2-digit' }) },
    date(value) { return new Date(value).toLocaleDateString('es-AR', { timeZone: App.config.timeZone, day: 'numeric', month: 'short' }) },
    court(value) { return { court1: 'Cancha 1', court2: 'Cancha 2' }[value] ?? value },
    toast(message, error = false) {
        let toast = document.getElementById('toast')
        if (!toast) { toast = document.createElement('div'); toast.id = 'toast'; toast.setAttribute('role', 'status'); document.body.append(toast) }
        toast.textContent = message
        toast.className = error ? 'toast error' : 'toast'
        clearTimeout(App.toastTimer)
        App.toastTimer = setTimeout(() => { toast.classList.add('hidden') }, 6000)
    },
    watch(refresh) {
        let source, timer, busy = false, queued = false
        async function update() {
            if (busy) { queued = true; return }
            busy = true
            try { await refresh() } catch { App.toast('No se pudo actualizar. Conservamos el último marcador.', true) }
            finally { busy = false; if (queued) { queued = false; void update() } }
        }
        function connect() {
            source?.close()
            if (document.hidden || !navigator.onLine) return
            source = new EventSource('/api/events')
            source.addEventListener('change', () => { clearTimeout(timer); timer = setTimeout(update, 180) })
            source.onopen = () => { document.querySelectorAll('[data-connection]').forEach(el => { el.textContent = 'Actualización en vivo'; el.classList.remove('offline') }) }
            source.onerror = () => { document.querySelectorAll('[data-connection]').forEach(el => { el.textContent = 'Reconectando…'; el.classList.add('offline') }) }
        }
        document.addEventListener('visibilitychange', connect)
        window.addEventListener('online', connect)
        window.addEventListener('offline', () => { source?.close(); document.querySelectorAll('[data-connection]').forEach(el => { el.textContent = 'Sin conexión · último marcador'; el.classList.add('offline') }) })
        window.addEventListener('pagehide', () => { clearTimeout(timer); source?.close() })
        connect()
    },
    async init() {
        try {
            App.config = await App.json('/api/config')
            document.documentElement.style.setProperty('--accent', App.config.accent)
            document.querySelectorAll('[data-tournament-name]').forEach(el => { el.textContent = App.config.name })
            document.querySelectorAll('[data-tournament-subtitle]').forEach(el => { el.textContent = App.config.subtitle })
        } catch { /* The fixture has its own visible error state. */ }
    },
}
App.ready = App.init()
window.addEventListener('unhandledrejection', () => App.toast('No se pudo completar la operación. Intentá nuevamente.', true))
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('input, select').forEach(input => {
        if (input.type === 'hidden') return
        const label = input.closest('div')?.querySelector('label')
        if (label && !label.htmlFor) label.htmlFor = input.id
    })
    if (location.pathname.startsWith('/manager')) {
        document.body.classList.add('manager-page')
        const nav = document.createElement('nav'); nav.className = 'manager-nav'; nav.setAttribute('aria-label', 'Administración')
        nav.innerHTML = [['/manager/', 'Partidos'], ['/manager/categories.html', 'Categorías'], ['/manager/clubs.html', 'Clubes'], ['/manager/teams.html', 'Equipos'], ['/', 'Vista pública ↗']].map(([href, label]) => `<a href="${href}" ${location.pathname === href ? 'aria-current="page"' : ''}>${label}</a>`).join('')
        document.querySelector('header')?.append(nav)
    }
})

window.App = {
    config: { name: 'Torneo de vóley', subtitle: '', timeZone: 'America/Argentina/Cordoba', courts: 4 },
    session: null,
    escape(value) { return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]) },
    async fetch(url, options = {}) {
        try {
            const response = await fetch(url, { ...options, signal: options.signal ?? AbortSignal.timeout(15000) })
            if (response.status === 401 && location.pathname.startsWith('/manager/')) location.assign('/login.html')
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
    // JSON write helper; returns the Response so callers can branch on status.
    send(url, method, body) {
        return App.fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    },
    time(value) { return new Date(value).toLocaleTimeString('es-AR', { timeZone: App.config.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) },
    date(value) { return new Date(value).toLocaleDateString('es-AR', { timeZone: App.config.timeZone, day: 'numeric', month: 'short' }) },
    day(value) { return new Date(value).toLocaleDateString('es-AR', { timeZone: App.config.timeZone, weekday: 'long', day: 'numeric', month: 'long' }) },
    dayKey(value) { return new Date(value).toLocaleDateString('en-CA', { timeZone: App.config.timeZone }) },
    sameTimeZone(a, b) {
        // Some Intl implementations preserve the old Córdoba alias instead of canonicalizing it.
        const canonical = zone => {
            const name = new Intl.DateTimeFormat('es-AR', { timeZone: zone }).resolvedOptions().timeZone
            return name === 'America/Cordoba' ? 'America/Argentina/Cordoba' : name
        }
        return canonical(a) === canonical(b)
    },
    court(value) { return `Cancha ${value}` },
    // Courts from TOURNAMENT_COURTS; a match already on a higher court keeps it listed.
    courtOptions(selected) {
        const count = Math.max(App.config.courts ?? 4, Number(selected) || 0)
        return Array.from({ length: count }, (_, i) => `<option value="${i + 1}"${i + 1 === Number(selected) ? ' selected' : ''}>Cancha ${i + 1}</option>`).join('')
    },
    // Knockout phase and description, e.g. "Copa de Oro · Semifinal 1".
    matchTag(match) { return [match.phase?.name, match.label].filter(Boolean).join(' · ') },
    // A knockout side still waiting for an earlier result reads "Ganador de Semifinal 1", in italics.
    teamName(team) { return team.pending ? `<span class="pending">${App.escape(team.name)}</span>` : App.escape(team.name) },
    // Public match line (fixture and knockout brackets): time, both teams with sets, tag, category, court, status.
    matchRow(m, { showDate = false } = {}) {
        const esc = App.escape
        const winner = App.winner(m)
        const live = m.status === 'in_progress', upcoming = m.status === 'upcoming'
        const active = live && m.sets.find(s => s.status === 'in_progress')
        const score = side => upcoming || m.status === 'cancelled' ? '' : active ? (side === 'home' ? active.scoreHome : active.scoreAway) : App.setsWon(m, side)
        const line = side => {
            const team = side === 'home' ? m.teamHome : m.teamAway
            const sets = m.sets.filter(s => s.status === 'finished_home' || s.status === 'finished_away').map(s => side === 'home' ? s.scoreHome : s.scoreAway).join(' ')
            return `<div class="match-team ${winner === team ? 'won' : ''}"><span class="name">${App.teamName(team)}</span><span class="sets">${sets}</span><span class="score" data-bump="m${m.id}-${side}">${score(side)}</span></div>`
        }
        const status = live ? `<span class="badge badge-live"><span class="live-dot"></span>${active ? `Set ${active.setNumber}` : 'En juego'}</span>` : upcoming ? '' : `<span class="badge">${App.statusLabel(m.status)}</span>`
        const label = `${App.matchTag(m) ? `${App.matchTag(m)}: ` : ''}${m.teamHome.name} contra ${m.teamAway.name}${winner ? `. Ganó ${winner.name}` : live ? '. En juego' : ''}`
        const tag = App.matchTag(m)
        return `<a class="match-row ${live ? 'is-live' : ''}" href="/game.html?id=${m.id}" aria-label="${esc(label)}">
            <span class="match-time">${showDate ? `${App.date(m.scheduledAt)}<br>` : ''}${App.time(m.scheduledAt)}</span>
            <span class="match-teams">${line('home')}${line('away')}</span>
            <span class="match-meta">${tag ? `<span class="match-tag">${esc(tag)}</span>` : ''}<span>${esc(m.categoryName)} · ${App.court(m.court)}</span>${status}</span>
        </a>`
    },
    roundName(round, rounds) { return ['Final', 'Semifinal', 'Cuartos de final', 'Octavos de final', 'Dieciseisavos de final'][rounds - round] ?? `Ronda ${round}` },
    // Knockout bracket as rounds of match rows; the third-place match follows the final.
    bracket(phase, matches) {
        const rows = matches.filter(m => m.phase?.id === phase.id).sort((a, b) => a.round - b.round || a.slot - b.slot)
        const groups = new Map()
        for (const m of rows) {
            const name = m.round === phase.rounds && m.slot === 1 ? 'Tercer puesto' : App.roundName(m.round, phase.rounds)
            if (!groups.has(name)) groups.set(name, [])
            groups.get(name).push(m)
        }
        return [...groups].map(([name, list]) => `<h3 class="day">${App.escape(name)}</h3>${list.map(m => App.matchRow(m, { showDate: true })).join('')}`).join('')
    },
    // Rotation grid seen from the team's own side: net on top (4 3 2), baseline below (5 6 1).
    // positions[0] is position 1, the server. `content(i)` renders the cell for positions[i].
    COURT_ORDER: [3, 2, 1, 4, 5, 0],
    // `team` is { match, side }: the court takes that team's logo or side color.
    rotationCourt(content, { serving = false, label = '', team = null } = {}) {
        const cell = i => `<div class="${serving && i === 0 ? 'server' : ''}"><span class="pos">${i + 1}${serving && i === 0 ? ' · saca' : ''}</span>${content(i)}</div>`
        const bg = team ? App.teamBackground(team.match, team.side) : { cls: '', style: '' }
        return `<div class="court ${bg.cls}"${bg.style ? ` style="${bg.style}"` : ''}${label ? ` aria-label="${label}"` : ''}>${App.COURT_ORDER.map(cell).join('')}</div>`
    },
    // Each team's identity on the score and courts: its club logo, faded, or light red (home) / light blue (away).
    // Only server-issued upload paths become CSS urls.
    teamBackground(match, side) {
        const logo = (side === 'home' ? match.teamHome : match.teamAway)?.clubLogo
        const other = (side === 'home' ? match.teamAway : match.teamHome)?.clubLogo
        // Two teams of the same club would look alike: they keep the side colors instead.
        const safe = typeof logo === 'string' && /^\/uploads\/[\w.-]+$/.test(logo) && logo !== other ? logo : null
        return { cls: `team-bg team-${side}${safe ? ' has-logo' : ''}`, style: safe ? `--team-logo:url('${safe}')` : '' }
    },
    // Score split down the middle, one half per team, in the given left-to-right order.
    scoreBox(match, values, order = ['home', 'away']) {
        const half = side => { const bg = App.teamBackground(match, side); return `<span class="${bg.cls}"${bg.style ? ` style="${bg.style}"` : ''}><span data-bump="${match.id}-${side}">${values[side]}</span></span>` }
        return `<div class="score-box big" role="group" aria-label="${values[order[0]]}–${values[order[1]]}">${order.map(half).join('')}</div>`
    },
    // Text color for the tournament accent: ink on light accents, white on dark ones.
    accentInk(hex) {
        const channel = c => { const v = parseInt(c, 16) / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
        const [r, g, b] = (hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i) ?? [null, 'b9', 'ed', '64']).slice(1).map(channel)
        const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
        // Contrast against ink (#16181d, luminance ≈ 0.0094) versus white.
        return (luminance + 0.05) / (0.0094 + 0.05) >= 1.05 / (luminance + 0.05) ? '#16181d' : '#ffffff'
    },
    winner(match) { return match.status === 'finished_home' ? match.teamHome : match.status === 'finished_away' ? match.teamAway : null },
    setsWon(match, side) { return match.sets.filter(s => s.status === `finished_${side}`).length },
    rulesText(r) {
        const rule = (points, lead, cap) => `a ${points}, diferencia ${lead}${cap ? `, tope ${cap}` : ''}`
        const regular = rule(r.setPoints, r.minLead, r.pointCap)
        if (r.bestOf === 1) return `Un set ${regular}`
        // Rules saved before the tie-break had its own lead and cap share them with the other sets.
        const tiebreak = rule(r.tiebreakPoints, r.tiebreakMinLead ?? r.minLead, r.tiebreakPointCap === undefined ? r.pointCap : r.tiebreakPointCap)
        return tiebreak === regular ? `Mejor de ${r.bestOf} · todos los sets ${regular}` : `Mejor de ${r.bestOf} · sets ${regular} · desempate ${tiebreak}`
    },
    RULE_DEFAULTS: { bestOf: 3, setPoints: 25, minLead: 2, pointCap: null, tiebreakPoints: 15, tiebreakMinLead: 2, tiebreakPointCap: null },
    RULE_KEYS: ['bestOf', 'setPoints', 'minLead', 'pointCap', 'tiebreakPoints', 'tiebreakMinLead', 'tiebreakPointCap'],
    sameRules(a, b) { return App.RULE_KEYS.every(k => (a?.[k] ?? null) === (b?.[k] ?? null)) },
    // Set rules fields for categories, matches and phases, rendered into `root`. The deciding set
    // plays like the others unless "Desempate con reglas propias" is checked; then it has its own
    // target, lead and cap. Returns { fill(rules), read() }.
    ruleForm(root, prefix = 'rule') {
        const id = key => `${prefix}-${key}`
        const number = (key, label, min, max, cap) => `<div class="field"><label for="${id(key)}">${label}</label><input type="number" inputmode="numeric" id="${id(key)}" min="${min}" max="${max}"${cap ? ' placeholder="Sin tope"' : ''} />${cap ? '<span class="hint">Vacío = sin tope. Al llegar al tope gana quien va adelante.</span>' : ''}</div>`
        root.innerHTML = `<div class="form-grid">
                <div class="field"><label for="${id('bestOf')}">Formato</label><select id="${id('bestOf')}"><option value="1">Un set</option><option value="3">Mejor de 3</option><option value="5">Mejor de 5</option><option value="7">Mejor de 7</option></select></div>
                ${number('setPoints', 'Puntos por set', 3, 99)}${number('minLead', 'Diferencia mínima', 1, 5)}${number('pointCap', 'Tope de puntos', 4, 199, true)}
            </div>
            <div id="${id('tiebreak')}" class="stack-sm" style="margin-top:16px">
                <label class="check"><input type="checkbox" id="${id('tiebreakOwn')}" /> Desempate con reglas propias</label>
                <p class="small muted" data-tip="tiebreak-own">El desempate es el set decisivo: el 3.º en mejor de 3, el 5.º en mejor de 5. Sin marcar se juega igual que los demás sets.</p>
                <div id="${id('tiebreakFields')}" class="form-grid">${number('tiebreakPoints', 'Puntos del desempate', 3, 99)}${number('tiebreakMinLead', 'Diferencia del desempate', 1, 5)}${number('tiebreakPointCap', 'Tope del desempate', 4, 199, true)}</div>
            </div>`
        const $ = key => document.getElementById(id(key))
        const sync = () => {
            $('tiebreak').classList.toggle('hidden', $('bestOf').value === '1')
            $('tiebreakFields').classList.toggle('hidden', !$('tiebreakOwn').checked)
        }
        const value = key => $(key).value === '' ? null : Number($(key).value)
        $('bestOf').addEventListener('change', sync)
        $('tiebreakOwn').addEventListener('change', () => {
            // Checking it starts from the usual tie-break (to 15) rather than a copy of the other sets.
            if ($('tiebreakOwn').checked && value('tiebreakPoints') === value('setPoints')) {
                $('tiebreakPoints').value = App.RULE_DEFAULTS.tiebreakPoints
                $('tiebreakMinLead').value = $('minLead').value
                $('tiebreakPointCap').value = ''
            }
            sync()
        })
        return {
            fill(rules) {
                const r = { ...App.RULE_DEFAULTS, ...rules }
                for (const key of App.RULE_KEYS) $(key).value = r[key] ?? ''
                $('tiebreakOwn').checked = r.tiebreakPoints !== r.setPoints || r.tiebreakMinLead !== r.minLead || (r.tiebreakPointCap ?? null) !== (r.pointCap ?? null)
                sync()
            },
            read() {
                const r = { bestOf: value('bestOf'), setPoints: value('setPoints'), minLead: value('minLead'), pointCap: value('pointCap') }
                const own = $('tiebreakOwn').checked && r.bestOf > 1
                return { ...r, tiebreakPoints: own ? value('tiebreakPoints') : r.setPoints, tiebreakMinLead: own ? value('tiebreakMinLead') : r.minLead, tiebreakPointCap: own ? value('tiebreakPointCap') : r.pointCap }
            },
        }
    },
    statusLabel(status) { return { upcoming: 'Próximo', in_progress: 'En juego', finished_home: 'Final', finished_away: 'Final', cancelled: 'Cancelado' }[status] ?? status },
    // Milliseconds to read a text without hurry: toasts and info tips stay up about this long.
    readTime(text) { return Math.min(12000, Math.max(3500, 1500 + String(text).trim().split(/\s+/).length * 320)) },
    toast(message, error = false) {
        let toast = document.getElementById('toast')
        if (!toast) {
            toast = document.createElement('div'); toast.id = 'toast'; toast.setAttribute('role', 'status')
            toast.addEventListener('click', () => { clearTimeout(App.toastTimer); toast.classList.remove('show') })
            document.body.append(toast)
        }
        toast.textContent = message
        toast.className = error ? 'toast error' : 'toast'
        void toast.offsetWidth // Restart the entrance when a toast replaces another.
        toast.classList.add('show')
        clearTimeout(App.toastTimer)
        App.toastTimer = setTimeout(() => { toast.classList.remove('show') }, App.readTime(message) + (error ? 2000 : 0))
    },

    // --- Info tips ---
    // Explanations fold into an (i) next to what they explain. Write `<p class="small muted" data-tip="key">…</p>`
    // right after that line, or name the line's id in `data-tip-at`; App.scan turns it into a tip. The first time a
    // device meets a key, the text stays open while its line is on screen, about as long as it takes to read, and
    // then folds; the (i) opens and closes it after that. Pages re-render on every point, so state lives per key.
    tipState: new Map(), // key → { open, anchor, auto: null | { started, visible, hovered, note, timer, animation } }
    tipAnchors: new WeakMap(),
    tipIds: 0,
    tipSeen(key, mark = false) {
        let seen
        try { seen = new Set(JSON.parse(localStorage.getItem('tips-seen') ?? '[]')) } catch { seen = new Set() }
        if (!mark) return seen.has(key)
        seen.add(key)
        try { localStorage.setItem('tips-seen', JSON.stringify([...seen])) } catch { /* Private mode: it shows again next visit. */ }
    },
    tipObserver() {
        App.tipWatcher ??= new IntersectionObserver(entries => {
            for (const entry of entries) {
                const key = App.tipAnchors.get(entry.target), state = App.tipState.get(key)
                if (!state?.auto || state.anchor !== entry.target) continue
                state.auto.visible = entry.isIntersecting && entry.intersectionRatio >= 0.5
                if (state.auto.visible && !state.auto.started) { state.auto.started = true; state.open = true; App.paintTip(key); App.timeTip(key) }
                App.runTip(key)
            }
        }, { threshold: [0, 0.5, 1] })
        return App.tipWatcher
    },
    enhanceTip(el) {
        const key = el.dataset.tip
        el.removeAttribute('data-tip')
        const anchor = el.dataset.tipAt ? document.getElementById(el.dataset.tipAt) : el.previousElementSibling
        if (!/^[\w-]+$/.test(key ?? '') || !anchor) return // Without a line to attach to, the text simply stays visible.
        const note = document.createElement('div'), inner = document.createElement('div'), timer = document.createElement('span')
        note.className = 'tip-note'; note.id = `tip-${++App.tipIds}`; note.dataset.tipKey = key
        inner.className = 'tip-inner'; timer.className = 'tip-timer'
        el.replaceWith(note)
        inner.append(el, timer)
        note.append(inner)
        anchor.querySelectorAll(`:scope > .tip-btn[data-tip-key="${key}"]`).forEach(old => old.remove())
        const button = document.createElement('button')
        button.type = 'button'; button.className = 'tip-btn'; button.textContent = 'i'; button.dataset.tipKey = key
        button.setAttribute('aria-controls', note.id)
        button.setAttribute('aria-label', 'Más información')
        button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); App.toggleTip(key) })
        anchor.append(button)
        let state = App.tipState.get(key)
        if (!state) {
            const auto = !App.tipSeen(key) && typeof IntersectionObserver === 'function' && typeof timer.animate === 'function'
            state = { open: false, anchor: null, auto: auto ? { started: false, visible: false, hovered: false } : null }
            App.tipState.set(key, state)
        }
        App.paintTip(key)
        if (!state.auto) return
        if (state.anchor && state.anchor !== anchor) App.tipObserver().unobserve(state.anchor)
        state.anchor = anchor
        Object.assign(state.auto, { note, timer })
        App.tipAnchors.set(anchor, key)
        App.tipObserver().observe(anchor)
        note.addEventListener('pointerenter', () => { if (state.auto) { state.auto.hovered = true; App.runTip(key) } })
        note.addEventListener('pointerleave', () => { if (state.auto) { state.auto.hovered = false; App.runTip(key) } })
        if (state.auto.started) App.timeTip(key)
    },
    // The countdown bar is the timer: it pauses while the line is off screen, hovered or the tab is hidden.
    timeTip(key) {
        const auto = App.tipState.get(key)?.auto
        if (!auto?.timer) return
        const previous = auto.animation
        auto.duration ??= App.readTime(auto.note.textContent)
        auto.animation = auto.timer.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], { duration: auto.duration, easing: 'linear', fill: 'forwards' })
        if (previous) { auto.animation.currentTime = previous.currentTime; previous.cancel() }
        auto.animation.onfinish = () => App.endTip(key, false)
        App.runTip(key)
    },
    runTip(key) {
        const auto = App.tipState.get(key)?.auto
        if (!auto?.animation) return
        if (auto.visible && !auto.hovered && !document.hidden) auto.animation.play()
        else auto.animation.pause()
    },
    endTip(key, open) {
        const state = App.tipState.get(key)
        if (!state) return
        if (state.auto) {
            state.auto.animation?.cancel()
            if (state.anchor) App.tipObserver().unobserve(state.anchor)
            state.auto = null
        }
        state.open = open
        App.tipSeen(key, true)
        App.paintTip(key)
    },
    toggleTip(key) { App.endTip(key, !App.tipState.get(key)?.open) },
    paintTip(key) {
        const state = App.tipState.get(key)
        document.querySelectorAll(`.tip-note[data-tip-key="${key}"]`).forEach(note => {
            note.classList.toggle('open', state.open)
            note.classList.toggle('counting', Boolean(state.auto?.started))
        })
        document.querySelectorAll(`.tip-btn[data-tip-key="${key}"]`).forEach(button => button.setAttribute('aria-expanded', String(state.open)))
    },

    // A number marked `data-bump="key"` pops briefly when it changes between renders (a point, a set).
    bumped: new Map(),
    bump(el) {
        const key = el.dataset.bump, value = el.textContent
        const previous = App.bumped.get(key)
        App.bumped.set(key, value)
        if (previous !== undefined && previous !== value) el.classList.add('bump')
    },
    // Enhances markup as it appears, while the page is parsed or after a render.
    scan(root) {
        if (!root.querySelectorAll) return
        const all = selector => [...(root.matches?.(selector) ? [root] : []), ...root.querySelectorAll(selector)]
        all('[data-tip]').forEach(App.enhanceTip)
        all('[data-bump]').forEach(App.bump)
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
            source.addEventListener('change', () => {
                // Coalesce a burst without postponing refresh forever under sustained events.
                if (timer !== undefined) return
                timer = setTimeout(() => { timer = undefined; void update() }, 180)
            })
            source.onopen = () => { document.querySelectorAll('[data-connection]').forEach(el => { el.textContent = 'En vivo'; el.classList.remove('offline') }) }
            source.onerror = () => { document.querySelectorAll('[data-connection]').forEach(el => { el.textContent = 'Reconectando…'; el.classList.add('offline') }) }
        }
        document.addEventListener('visibilitychange', connect)
        window.addEventListener('online', connect)
        window.addEventListener('offline', () => { source?.close(); document.querySelectorAll('[data-connection]').forEach(el => { el.textContent = 'Sin conexión'; el.classList.add('offline') }) })
        window.addEventListener('pagehide', () => { clearTimeout(timer); timer = undefined; source?.close() })
        connect()
    },
    isAdmin() { return App.session?.role === 'admin' },
    async logout() {
        await App.fetch('/api/auth/logout', { method: 'POST' })
        location.assign('/login.html')
    },
    // One header for every page: public links, or the panel links allowed for the role.
    header() {
        const bar = document.querySelector?.('header.bar')
        if (!bar) return
        const here = location.pathname
        const link = ([href, label]) => `<a href="${href}" ${here === href || (href !== '/' && href !== '/manager/' && here.startsWith(href)) ? 'aria-current="page"' : ''}>${label}</a>`
        const manager = here.startsWith('/manager/')
        const links = manager
            ? [['/manager/', 'Partidos'], ...(App.isAdmin() ? [['/manager/phases.html', 'Eliminatorias'], ['/manager/categories.html', 'Categorías'], ['/manager/clubs.html', 'Clubes'], ['/manager/teams.html', 'Equipos']] : []), ...(App.session?.manager ? [['/manager/users.html', 'Usuarios']] : [])]
            : [['/', 'Partidos'], ['/standings.html', 'Posiciones']]
        const end = manager
            ? `<a href="/">Ver sitio</a><button type="button" onclick="App.logout()" title="${App.escape(App.session?.displayName ?? '')}">Salir</button>`
            : `<span class="connection" data-connection role="status"></span><a href="/manager/">Ingresar</a>`
        if (!manager && !document.querySelector('footer.footer')) document.body.insertAdjacentHTML('beforeend', `<footer class="footer"><span>${App.escape(App.config.name)}</span><a href="/privacy_policy">Política de privacidad</a></footer>`)
        bar.innerHTML = `<div class="bar-inner"><a class="brand" href="${manager ? '/manager/' : '/'}">${App.escape(App.config.name)}</a><nav class="nav" aria-label="Principal">${links.map(link).join('')}</nav><div class="bar-end">${end}</div></div>`
    },
    async init() {
        try {
            App.config = await App.json('/api/config')
            document.documentElement.style.setProperty('--accent', App.config.accent)
            document.documentElement.style.setProperty('--accent-ink', App.accentInk(App.config.accent))
        } catch { /* Pages have their own visible error state. */ }
        if (location.pathname.startsWith('/manager/')) {
            const response = await App.fetch('/api/auth/me')
            if (!response.ok) { location.assign('/login.html'); throw new Error('Iniciá sesión.') }
            App.session = await response.json()
        }
        App.header()
    },
}
if (typeof MutationObserver === 'function' && document.documentElement) {
    new MutationObserver(records => {
        for (const record of records) for (const node of record.addedNodes) if (node.nodeType === 1 && node.isConnected) App.scan(node)
    }).observe(document.documentElement, { childList: true, subtree: true })
    document.addEventListener('visibilitychange', () => App.tipState.forEach((_, key) => App.runTip(key)))
}
App.ready = App.init()
window.addEventListener('unhandledrejection', () => App.toast('No se pudo completar la operación. Intentá nuevamente.', true))

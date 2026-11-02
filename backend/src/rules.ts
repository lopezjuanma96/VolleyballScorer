export type Side = 'home' | 'away'
export type Rules = { bestOf: number; setPoints: number; tiebreakPoints: number; minLead: number; pointCap: number | null }
export type SetsWon = { home: number; away: number }

export const defaultRules: Rules = { bestOf: 3, setPoints: 25, tiebreakPoints: 15, minLead: 2, pointCap: null }
export const rulesOf = (row: Rules): Rules => ({ bestOf: row.bestOf, setPoints: row.setPoints, tiebreakPoints: row.tiebreakPoints, minLead: row.minLead, pointCap: row.pointCap })
export const setsToWin = (rules: Rules) => Math.ceil(rules.bestOf / 2)

// The deciding set (e.g. the 5th at 2–2) is played to tiebreakPoints.
export function setTarget(rules: Rules, won: SetsWon) {
    const needed = setsToWin(rules)
    return rules.bestOf > 1 && won.home === needed - 1 && won.away === needed - 1 ? rules.tiebreakPoints : rules.setPoints
}

// Winner of a set at this score, or null if it continues. Reaching pointCap wins outright.
export function setWinner(rules: Rules, won: SetsWon, home: number, away: number): Side | null {
    const target = setTarget(rules, won)
    const leader: Side = home > away ? 'home' : 'away'
    const high = Math.max(home, away), lead = Math.abs(home - away)
    if (lead === 0) return null
    if (high >= target && lead >= rules.minLead) return leader
    if (rules.pointCap !== null && high >= rules.pointCap) return leader
    return null
}

// A final score entered at once is valid only if the set can end exactly there:
// some sequence of rallies reaches it without ending earlier (25–23 yes, 28–25 no,
// nothing beyond a cap).
export function finalScoreWinner(rules: Rules, won: SetsWon, home: number, away: number): Side | null {
    const winner = setWinner(rules, won, home, away)
    if (!winner) return null
    const [w, l] = winner === 'home' ? [home, away] : [away, home]
    const ends = (a: number, b: number) => setWinner(rules, won, a, b) !== null
    // open[b] for the current row a: score a–b is reachable while the set is still in play.
    let open = new Array<boolean>(l + 1).fill(false)
    for (let a = 0; a < w; a++) {
        const next = new Array<boolean>(l + 1).fill(false)
        for (let b = 0; b <= l; b++) {
            const reached = (a === 0 && b === 0) || (a > 0 && open[b]) || (b > 0 && next[b - 1])
            next[b] = reached && !ends(a, b)
        }
        open = next
    }
    // The winner scores the last rally from w-1 to w.
    return open[l] ? winner : null
}

export function matchWinner(rules: Rules, won: SetsWon): Side | null {
    const needed = setsToWin(rules)
    return won.home >= needed ? 'home' : won.away >= needed ? 'away' : null
}

// Table points: winner earns bestOf − sets lost, loser earns sets won.
// Best of 3: 3/0 (2–0) or 2/1 (2–1). Best of 5: 5/0, 4/1, 3/2.
// A result ruled by the organization that the sets do not support (walkover,
// abandonment, reversal) is administrative: bestOf for the winner, 0 for the loser.
export function tablePoints(rules: Rules, winnerSets: number, loserSets: number) {
    const needed = setsToWin(rules)
    if (winnerSets < needed || loserSets >= needed) return { winner: rules.bestOf, loser: 0 }
    return { winner: rules.bestOf - loserSets, loser: loserSets }
}

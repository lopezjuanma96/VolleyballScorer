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

// A final score entered at once is valid only if the set ends there and did not
// already end one point earlier (25–23 yes, 28–25 no).
export function finalScoreWinner(rules: Rules, won: SetsWon, home: number, away: number): Side | null {
    const winner = setWinner(rules, won, home, away)
    if (!winner) return null
    const previous = winner === 'home' ? setWinner(rules, won, home - 1, away) : setWinner(rules, won, home, away - 1)
    return previous ? null : winner
}

export function matchWinner(rules: Rules, won: SetsWon): Side | null {
    const needed = setsToWin(rules)
    return won.home >= needed ? 'home' : won.away >= needed ? 'away' : null
}

// Table points: winner earns bestOf − sets lost, loser earns sets won.
// Best of 3: 3/0 (2–0) or 2/1 (2–1). Best of 5: 5/0, 4/1, 3/2.
export function tablePoints(rules: Rules, loserSets: number) {
    const lost = Math.max(0, Math.min(loserSets, setsToWin(rules) - 1))
    return { winner: rules.bestOf - lost, loser: lost }
}

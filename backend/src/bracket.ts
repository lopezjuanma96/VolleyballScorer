// Knockout bracket ("winner stays"): pure planning, no database.
//
// Teams come in seed order (seed 1 first). The bracket has the next power of two
// slots; the missing teams are byes for the best seeds, who go straight to the
// second round. Seeds meet as in any standard draw (1 v 8, 4 v 5, 2 v 7, 3 v 6),
// so the two best seeds can only meet in the final.

export type Source = { seed: number } | { from: string; loser: boolean }
export type PlannedMatch = { key: string; round: number; slot: number; label: string; home: Source; away: Source }
export type Bracket = { rounds: number; matches: PlannedMatch[]; thirdPlaceAvailable: boolean }

export const matchKey = (round: number, slot: number) => `${round}-${slot}`

// Seed per bracket line for `size` lines: [1, 2] → [1, 4, 2, 3] → [1, 8, 4, 5, 2, 7, 3, 6] …
export function seedOrder(size: number): number[] {
    let order = [1]
    while (order.length < size) {
        const next = order.length * 2 + 1
        order = order.flatMap(seed => [seed, next - seed])
    }
    return order
}

export function roundName(round: number, rounds: number) {
    return ['Final', 'Semifinal', 'Cuartos de final', 'Octavos de final', 'Dieciseisavos de final'][rounds - round] ?? `Ronda ${round}`
}

const shortRound = (round: number, rounds: number) => ['Final', 'Semifinal', 'Cuartos', 'Octavos', 'Dieciseisavos'][rounds - round] ?? `Ronda ${round}`

// A third-place match needs two semifinal losers, so no semifinal can be a bye.
export function planBracket(teamCount: number, thirdPlace: boolean): Bracket {
    if (!Number.isInteger(teamCount) || teamCount < 2 || teamCount > 32) throw new RangeError('Entre 2 y 32 equipos.')
    let size = 2
    while (size < teamCount) size *= 2
    const rounds = Math.log2(size)
    const matches: PlannedMatch[] = []
    let entries: Source[] = seedOrder(size).map(seed => ({ seed }))
    for (let round = 1; round <= rounds; round++) {
        const next: Source[] = []
        const played: PlannedMatch[] = []
        for (let slot = 0; slot < entries.length / 2; slot++) {
            const home = entries[slot * 2], away = entries[slot * 2 + 1]
            // Only the first round has byes: the best seeds face a seed that does not exist.
            if ('seed' in away && away.seed > teamCount) { next.push(home); continue }
            const match = { key: matchKey(round, slot), round, slot, label: '', home, away }
            played.push(match)
            next.push({ from: match.key, loser: false })
        }
        played.forEach((match, i) => { match.label = played.length > 1 ? `${shortRound(round, rounds)} ${i + 1}` : shortRound(round, rounds) })
        matches.push(...played)
        entries = next
    }
    const final = matches.find(m => m.round === rounds)!
    const thirdPlaceAvailable = rounds >= 2 && 'from' in final.home && 'from' in final.away
    if (thirdPlace && thirdPlaceAvailable) {
        const loserOf = (source: Source): Source => ({ from: (source as { from: string }).from, loser: true })
        matches.push({ key: matchKey(rounds, 1), round: rounds, slot: 1, label: 'Tercer puesto', home: loserOf(final.home), away: loserOf(final.away) })
    }
    return { rounds, matches, thirdPlaceAvailable }
}

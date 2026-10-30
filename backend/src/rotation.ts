import type { Side } from './rules'

export type Substitution = { side: Side; afterRallies: number; playerOut: number; playerIn: number }
export type RotationInput = {
    firstServeHome: boolean | null
    lineups: Partial<Record<Side, number[]>>
    // homeScored for each rally of the set, in order. Final/correction entries are excluded.
    rallies: boolean[]
    substitutions: Substitution[]
}
export type RotationState = {
    serving: Side | null
    // Jersey numbers in positions I..VI; position I serves.
    positions: Record<Side, number[] | null>
    rotations: Record<Side, number>
}

// Clockwise: the player in II moves to I and serves next.
export const rotate = (positions: number[]) => [...positions.slice(1), positions[0]]

// Replays the set: a team rotates each time it wins a rally on the opponent's serve.
export function rotationState({ firstServeHome, lineups, rallies, substitutions }: RotationInput): RotationState {
    const positions: Record<Side, number[] | null> = { home: lineups.home ? [...lineups.home] : null, away: lineups.away ? [...lineups.away] : null }
    const rotations = { home: 0, away: 0 }
    let serving: Side | null = firstServeHome === null ? null : firstServeHome ? 'home' : 'away'
    const applySubstitutions = (count: number) => {
        for (const change of substitutions) {
            const lineup = positions[change.side]
            if (change.afterRallies !== count || !lineup) continue
            const index = lineup.indexOf(change.playerOut)
            if (index >= 0) lineup[index] = change.playerIn
        }
    }
    if (serving === null) {
        // Without the toss the serve order, and therefore the rotation, is unknown.
        for (let count = 0; count <= rallies.length; count++) applySubstitutions(count)
        return { serving, positions, rotations }
    }
    rallies.forEach((homeScored, index) => {
        applySubstitutions(index)
        const scorer: Side = homeScored ? 'home' : 'away'
        if (scorer !== serving) {
            rotations[scorer]++
            const lineup = positions[scorer]
            if (lineup) positions[scorer] = rotate(lineup)
        }
        serving = scorer
    })
    applySubstitutions(rallies.length)
    return { serving, positions, rotations }
}

// Substitutions must stay consistent with a (possibly edited) starting lineup:
// each one takes out a player on court and brings in one who is not.
export function substitutionsFit(lineup: number[] | null, changes: Pick<Substitution, 'playerOut' | 'playerIn'>[]) {
    if (!lineup) return changes.length === 0
    const court = [...lineup]
    for (const change of changes) {
        const index = court.indexOf(change.playerOut)
        if (index < 0 || court.includes(change.playerIn)) return false
        court[index] = change.playerIn
    }
    return true
}

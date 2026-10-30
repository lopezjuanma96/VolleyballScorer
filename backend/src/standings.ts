import { tablePoints, type Rules } from './rules'

export type StandingTeam = { id: number; name: string; clubName: string; clubLogo: string | null }
export type StandingMatch = Rules & {
    status: string
    teamHomeId: number
    teamAwayId: number
    sets: { status: string; scoreHome: number; scoreAway: number }[]
}
export type StandingRow = StandingTeam & {
    played: number; won: number; lost: number
    setsWon: number; setsLost: number
    pointsFor: number; pointsAgainst: number
    points: number
}

const ratio = (a: number, b: number) => b === 0 ? (a === 0 ? 0 : Infinity) : a / b

// Only finished matches count. The official result is the match status, so a
// walkover ruled by the organization still awards the winner's table points.
export function standings(teams: StandingTeam[], matches: StandingMatch[]): StandingRow[] {
    const rows = new Map<number, StandingRow>(teams.map(team => [team.id, { ...team, played: 0, won: 0, lost: 0, setsWon: 0, setsLost: 0, pointsFor: 0, pointsAgainst: 0, points: 0 }]))
    for (const match of matches) {
        if (match.status !== 'finished_home' && match.status !== 'finished_away') continue
        const home = rows.get(match.teamHomeId), away = rows.get(match.teamAwayId)
        if (!home || !away) continue
        const finished = match.sets.filter(s => s.status === 'finished_home' || s.status === 'finished_away')
        const setsHome = finished.filter(s => s.status === 'finished_home').length
        const setsAway = finished.length - setsHome
        const homeWon = match.status === 'finished_home'
        const award = tablePoints(match, homeWon ? setsAway : setsHome)
        for (const [row, mine, theirs, winner] of [[home, setsHome, setsAway, homeWon], [away, setsAway, setsHome, !homeWon]] as const) {
            row.played++
            if (winner) row.won++; else row.lost++
            row.points += winner ? award.winner : award.loser
            row.setsWon += mine; row.setsLost += theirs
        }
        for (const set of finished) {
            home.pointsFor += set.scoreHome; home.pointsAgainst += set.scoreAway
            away.pointsFor += set.scoreAway; away.pointsAgainst += set.scoreHome
        }
    }
    // Points, then wins, set ratio, rally-point ratio and name.
    return [...rows.values()].sort((a, b) => b.points - a.points || b.won - a.won
        || ratio(b.setsWon, b.setsLost) - ratio(a.setsWon, a.setsLost)
        || ratio(b.pointsFor, b.pointsAgainst) - ratio(a.pointsFor, a.pointsAgainst)
        || a.name.localeCompare(b.name, 'es'))
}

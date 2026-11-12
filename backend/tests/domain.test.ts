import { describe, expect, test } from 'bun:test'
import { defaultRules, finalScoreWinner, matchWinner, setRule, setWinner, tablePoints } from '../src/rules'
import { planBracket, seedOrder } from '../src/bracket'
import { rotate, rotationState, substitutionsFit } from '../src/rotation'
import { standings } from '../src/standings'

const bo5 = { ...defaultRules, bestOf: 5 }
const zero = { home: 0, away: 0 }

describe('set rules', () => {
    test('sets need the target and a two-point lead', () => {
        expect(setWinner(defaultRules, zero, 24, 23)).toBeNull()
        expect(setWinner(defaultRules, zero, 25, 23)).toBe('home')
        expect(setWinner(defaultRules, zero, 25, 24)).toBeNull()
        expect(setWinner(defaultRules, zero, 30, 32)).toBe('away')
    })
    test('the deciding set uses tiebreak points', () => {
        expect(setRule(defaultRules, { home: 1, away: 1 }).target).toBe(15)
        expect(setRule(defaultRules, { home: 1, away: 0 }).target).toBe(25)
        expect(setRule(bo5, { home: 2, away: 2 }).target).toBe(15)
        expect(setRule({ ...defaultRules, bestOf: 1 }, zero).target).toBe(25)
        expect(setWinner(defaultRules, { home: 1, away: 1 }, 15, 13)).toBe('home')
    })
    test('the deciding set has its own lead and cap', () => {
        const rules = { ...defaultRules, pointCap: 27, tiebreakPoints: 15, tiebreakMinLead: 2, tiebreakPointCap: 17 }
        const decider = { home: 1, away: 1 }
        expect(setWinner(rules, zero, 17, 16)).toBeNull()
        expect(setWinner(rules, zero, 27, 26)).toBe('home')
        expect(setWinner(rules, decider, 16, 16)).toBeNull()
        expect(setWinner(rules, decider, 17, 16)).toBe('home')
        expect(finalScoreWinner(rules, decider, 18, 16)).toBeNull()
        const golden = { ...defaultRules, tiebreakMinLead: 1 }
        expect(setWinner(golden, decider, 15, 14)).toBe('home')
        expect(setWinner(golden, zero, 25, 24)).toBeNull()
    })
    test('a point cap ends the set without the lead', () => {
        const capped = { ...defaultRules, pointCap: 27 }
        expect(setWinner(capped, zero, 26, 26)).toBeNull()
        expect(setWinner(capped, zero, 27, 26)).toBe('home')
    })
    test('final scores must be reachable and terminal', () => {
        expect(finalScoreWinner(defaultRules, zero, 25, 23)).toBe('home')
        expect(finalScoreWinner(defaultRules, zero, 25, 0)).toBe('home')
        expect(finalScoreWinner(defaultRules, zero, 26, 28)).toBe('away')
        expect(finalScoreWinner(defaultRules, zero, 28, 25)).toBeNull()
        expect(finalScoreWinner(defaultRules, zero, 25, 24)).toBeNull()
        expect(finalScoreWinner(defaultRules, zero, 20, 18)).toBeNull()
    })
    test('final scores beyond a cap or after an earlier end are unreachable', () => {
        const short = { ...defaultRules, setPoints: 5, tiebreakPoints: 3 }
        expect(finalScoreWinner({ ...short, pointCap: 7 }, zero, 7, 6)).toBe('home')
        expect(finalScoreWinner({ ...short, pointCap: 7 }, zero, 8, 7)).toBeNull()
        expect(finalScoreWinner({ ...short, minLead: 1 }, zero, 8, 7)).toBeNull()
        expect(finalScoreWinner({ ...short, minLead: 1 }, zero, 5, 4)).toBe('home')
        expect(finalScoreWinner(defaultRules, zero, 0, 25)).toBe('away')
    })
    test('match winner and table points', () => {
        expect(matchWinner(defaultRules, { home: 2, away: 1 })).toBe('home')
        expect(matchWinner(bo5, { home: 2, away: 2 })).toBeNull()
        expect(tablePoints(defaultRules, 2, 0)).toEqual({ winner: 3, loser: 0 })
        expect(tablePoints(defaultRules, 2, 1)).toEqual({ winner: 2, loser: 1 })
        expect([0, 1, 2].map(lost => tablePoints(bo5, 3, lost))).toEqual([{ winner: 5, loser: 0 }, { winner: 4, loser: 1 }, { winner: 3, loser: 2 }])
        // Rulings the sets do not support are administrative.
        expect(tablePoints(defaultRules, 0, 2)).toEqual({ winner: 3, loser: 0 })
        expect(tablePoints(defaultRules, 1, 0)).toEqual({ winner: 3, loser: 0 })
    })
})

describe('rotation', () => {
    const home = [1, 2, 3, 4, 5, 6], away = [11, 12, 13, 14, 15, 16]
    test('rotates clockwise only on side-out', () => {
        expect(rotate(home)).toEqual([2, 3, 4, 5, 6, 1])
        // Home serves; home wins (no rotation), away wins (away rotates), away wins, home wins (home rotates).
        const state = rotationState({ firstServeHome: true, lineups: { home, away }, rallies: [true, false, false, true], substitutions: [] })
        expect(state.serving).toBe('home')
        expect(state.rotations).toEqual({ home: 1, away: 1 })
        expect(state.positions.home).toEqual([2, 3, 4, 5, 6, 1])
        expect(state.positions.away).toEqual([12, 13, 14, 15, 16, 11])
    })
    test('the receiving team rotates on its first point', () => {
        const state = rotationState({ firstServeHome: false, lineups: { home }, rallies: [true], substitutions: [] })
        expect(state.positions.home).toEqual([2, 3, 4, 5, 6, 1])
        expect(state.positions.away).toBeNull()
    })
    test('substitutions replace the player in place at the recorded moment', () => {
        const state = rotationState({ firstServeHome: true, lineups: { home, away }, rallies: [false, true], substitutions: [{ side: 'home', afterRallies: 1, playerOut: 1, playerIn: 9 }] })
        expect(state.positions.home).toEqual([2, 3, 4, 5, 6, 9])
    })
    test('lineup edits must keep recorded substitutions valid', () => {
        expect(substitutionsFit(home, [{ playerOut: 1, playerIn: 7 }])).toBe(true)
        expect(substitutionsFit([1, 7, 3, 4, 5, 6], [{ playerOut: 1, playerIn: 7 }])).toBe(false)
        expect(substitutionsFit([9, 2, 3, 4, 5, 6], [{ playerOut: 1, playerIn: 7 }])).toBe(false)
        expect(substitutionsFit(null, [{ playerOut: 1, playerIn: 7 }])).toBe(false)
        expect(substitutionsFit(null, [])).toBe(true)
    })
    test('without the toss there is no derived rotation', () => {
        const state = rotationState({ firstServeHome: null, lineups: { home }, rallies: [false, true, false], substitutions: [] })
        expect(state.serving).toBeNull()
        expect(state.positions.home).toEqual(home)
    })
})

describe('standings', () => {
    const teams = [1, 2, 3].map(id => ({ id, name: `T${id}`, clubName: 'C', clubLogo: null }))
    const set = (status: string, scoreHome: number, scoreAway: number) => ({ status, scoreHome, scoreAway })
    test('awards points by sets and orders the table', () => {
        const rows = standings(teams, [
            { ...defaultRules, status: 'finished_home', teamHomeId: 1, teamAwayId: 2, sets: [set('finished_home', 25, 20), set('finished_away', 22, 25), set('finished_home', 15, 10)] },
            { ...defaultRules, status: 'finished_away', teamHomeId: 1, teamAwayId: 3, sets: [set('finished_away', 10, 25), set('cancelled', 3, 1), set('finished_away', 11, 25)] },
            { ...defaultRules, status: 'in_progress', teamHomeId: 2, teamAwayId: 3, sets: [set('finished_home', 25, 0)] },
        ])
        expect(rows.map(r => [r.id, r.points, r.played])).toEqual([[3, 3, 1], [1, 2, 2], [2, 1, 1]])
        expect(rows[1]).toMatchObject({ won: 1, lost: 1, setsWon: 2, setsLost: 3, pointsFor: 83, pointsAgainst: 105 })
    })
    test('a ruled walkover without sets still gives full points', () => {
        const rows = standings(teams.slice(0, 2), [{ ...defaultRules, status: 'finished_away', teamHomeId: 1, teamAwayId: 2, sets: [] }])
        expect(rows[0]).toMatchObject({ id: 2, points: 3, won: 1 })
        expect(rows[1]).toMatchObject({ id: 1, points: 0, lost: 1 })
    })
    test('an official result reversed against the sets is administrative', () => {
        const rows = standings(teams.slice(0, 2), [{ ...defaultRules, status: 'finished_away', teamHomeId: 1, teamAwayId: 2, sets: [set('finished_home', 25, 20), set('finished_home', 25, 20)] }])
        expect(rows[0]).toMatchObject({ id: 2, points: 3, won: 1, setsWon: 0, setsLost: 2 })
        expect(rows[1]).toMatchObject({ id: 1, points: 0, lost: 1 })
    })
})

describe('knockout bracket', () => {
    test('seeds meet as in a standard draw', () => {
        expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6])
    })
    test('a full bracket of eight', () => {
        const { rounds, matches } = planBracket(8, true)
        expect(rounds).toBe(3)
        expect(matches.map(m => m.label)).toEqual(['Cuartos 1', 'Cuartos 2', 'Cuartos 3', 'Cuartos 4', 'Semifinal 1', 'Semifinal 2', 'Final', 'Tercer puesto'])
        expect(matches[0]).toMatchObject({ home: { seed: 1 }, away: { seed: 8 } })
        expect(matches[4]).toMatchObject({ home: { from: '1-0', loser: false }, away: { from: '1-1', loser: false } })
        expect(matches[7]).toMatchObject({ round: 3, slot: 1, home: { from: '2-0', loser: true }, away: { from: '2-1', loser: true } })
    })
    test('the best seeds get the byes', () => {
        const { matches, thirdPlaceAvailable } = planBracket(6, false)
        expect(matches.filter(m => m.round === 1).map(m => [m.home, m.away])).toEqual([[{ seed: 4 }, { seed: 5 }], [{ seed: 3 }, { seed: 6 }]])
        expect(matches.find(m => m.label === 'Semifinal 1')).toMatchObject({ home: { seed: 1 }, away: { from: '1-1' } })
        expect(thirdPlaceAvailable).toBe(true)
    })
    test('no third place when a finalist skipped the semifinal', () => {
        const { matches, thirdPlaceAvailable } = planBracket(3, true)
        expect(thirdPlaceAvailable).toBe(false)
        expect(matches.map(m => m.label)).toEqual(['Semifinal', 'Final'])
        expect(planBracket(2, true).matches.map(m => m.label)).toEqual(['Final'])
    })
})

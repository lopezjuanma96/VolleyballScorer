import { pgTable, pgEnum, serial, varchar, integer, boolean, timestamp, index, uniqueIndex, jsonb, check } from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'

// --- Enums ---

export const matchStatusEnum = pgEnum('match_status', [
    'upcoming',
    'in_progress',
    'finished_home',
    'finished_away',
    'cancelled',
])

export const setStatusEnum = pgEnum('set_status', [
    'in_progress',
    'finished_home',
    'finished_away',
    'cancelled',
])

export const userRoleEnum = pgEnum('user_role', ['admin', 'scorer'])
// rally: one scored point; final: score entered at once; correction: administrative ruling.
export const pointKindEnum = pgEnum('point_kind', ['rally', 'final', 'correction'])
export const teamSideEnum = pgEnum('team_side', ['home', 'away'])

// Set rules. Categories hold defaults; each match keeps its own copy so later
// category edits never reinterpret matches already scheduled or played.
const ruleColumns = () => ({
    bestOf: integer('best_of').notNull().default(3),
    setPoints: integer('set_points').notNull().default(25),
    minLead: integer('min_lead').notNull().default(2),
    pointCap: integer('point_cap'),
    // Deciding set. Playing it like the others means repeating the values above.
    tiebreakPoints: integer('tiebreak_points').notNull().default(15),
    tiebreakMinLead: integer('tiebreak_min_lead').notNull().default(2),
    tiebreakPointCap: integer('tiebreak_point_cap'),
})

// --- Tables ---

export const users = pgTable('users', {
    id: serial('id').primaryKey(),
    // Organization members sign in with Google; only this verified email is accepted.
    // Stored lowercase. The .env manager is not a row here.
    email: varchar('email', { length: 254 }).notNull().unique(),
    displayName: varchar('display_name', { length: 100 }).notNull(),
    role: userRoleEnum('role').notNull(),
    active: boolean('active').notNull().default(true),
    // Bumped on email, role or access changes: open sessions stop working.
    sessionVersion: integer('session_version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const clubs = pgTable('clubs', {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 100 }).notNull().unique(),
    logo: varchar('logo', { length: 255 }),
})

export const categories = pgTable('categories', {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 100 }).notNull().unique(),
    ...ruleColumns(),
})

export const teams = pgTable('teams', {
    id: serial('id').primaryKey(),
    clubId: integer('club_id').notNull().references(() => clubs.id),
    categoryId: integer('category_id').notNull().references(() => categories.id),
    name: varchar('name', { length: 100 }).notNull(),
})

// Knockout phase ("fase eliminatoria") of a category: the organization picks the
// teams in seed order from the standings; its matches form a winner-advances bracket.
// A category may run several phases at once (e.g. gold and silver cups).
export const phases = pgTable('phases', {
    id: serial('id').primaryKey(),
    categoryId: integer('category_id').notNull().references(() => categories.id),
    name: varchar('name', { length: 100 }).notNull(),
    // Seed order: teamIds[0] is seed 1.
    teamIds: integer('team_ids').array().notNull(),
    thirdPlace: boolean('third_place').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [index('phases_category_idx').on(table.categoryId)])

export const matches = pgTable('matches', {
    id: serial('id').primaryKey(),
    // Null only in a phase match waiting for the winner (or loser) of an earlier one.
    teamHomeId: integer('team_home_id').references(() => teams.id),
    teamAwayId: integer('team_away_id').references(() => teams.id),
    categoryId: integer('category_id').notNull().references(() => categories.id),
    court: integer('court').notNull(),
    scheduledAt: timestamp('scheduled_at').notNull(),
    status: matchStatusEnum('status').notNull().default('upcoming'),
    ...ruleColumns(),
    // Only the member holding the match scores it (session username: email, or the
    // .env manager name). Free when null. Kept after the match ends so undo still works.
    claimedBy: varchar('claimed_by', { length: 254 }),
    claimedName: varchar('claimed_name', { length: 100 }),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    // Free text shown with the match, e.g. "Semifinal 1".
    label: varchar('label', { length: 100 }),
    // Knockout bracket: round 1 is the first round; slot orders matches in a round.
    // A side with a source match takes its winner (its loser in the third-place match).
    phaseId: integer('phase_id').references(() => phases.id),
    round: integer('round'),
    slot: integer('slot'),
    homeFromMatchId: integer('home_from_match_id'),
    awayFromMatchId: integer('away_from_match_id'),
    fromLosers: boolean('from_losers').notNull().default(false),
}, table => [
    index('matches_category_schedule_idx').on(table.categoryId, table.scheduledAt),
    index('matches_phase_idx').on(table.phaseId),
    check('matches_court_range', sql`${table.court} between 1 and 20`),
    check('matches_teams_known', sql`${table.phaseId} is not null or (${table.teamHomeId} is not null and ${table.teamAwayId} is not null)`),
])

export const sets = pgTable('sets', {
    id: serial('id').primaryKey(),
    matchId: integer('match_id').notNull().references(() => matches.id),
    setNumber: integer('set_number').notNull(),
    status: setStatusEnum('status').notNull().default('in_progress'),
    revision: integer('revision').notNull().default(0),
    // Null until the scorer records the toss; rotation needs it.
    firstServeHome: boolean('first_serve_home'),
}, table => [uniqueIndex('sets_match_number_idx').on(table.matchId, table.setNumber), index('sets_match_idx').on(table.matchId)])

// Starting lineup: jersey numbers in positions I..VI (I serves). The current
// rotation is derived from rallies, so undo never leaves stale rotation state.
export const setLineups = pgTable('set_lineups', {
    id: serial('id').primaryKey(),
    setId: integer('set_id').notNull().references(() => sets.id, { onDelete: 'cascade' }),
    side: teamSideEnum('side').notNull(),
    positions: integer('positions').array().notNull(),
}, table => [uniqueIndex('set_lineups_set_side_idx').on(table.setId, table.side), check('set_lineups_six', sql`cardinality(${table.positions}) = 6`)])

export const substitutions = pgTable('substitutions', {
    id: serial('id').primaryKey(),
    setId: integer('set_id').notNull().references(() => sets.id, { onDelete: 'cascade' }),
    side: teamSideEnum('side').notNull(),
    // Number of rallies already played in the set when the change happened.
    afterRallies: integer('after_rallies').notNull(),
    playerOut: integer('player_out').notNull(),
    playerIn: integer('player_in').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [index('substitutions_set_idx').on(table.setId, table.id)])

export const scoringAudit = pgTable('scoring_audit', {
    id: serial('id').primaryKey(),
    matchId: integer('match_id').notNull().references(() => matches.id, { onDelete: 'cascade' }),
    setId: integer('set_id').references(() => sets.id, { onDelete: 'cascade' }),
    action: varchar('action', { length: 40 }).notNull(),
    actor: varchar('actor', { length: 100 }).notNull(),
    reason: varchar('reason', { length: 500 }).notNull(),
    before: jsonb('before').notNull(),
    after: jsonb('after').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [index('scoring_audit_match_idx').on(table.matchId, table.id)])

export const points = pgTable('points', {
    id: serial('id').primaryKey(),
    setId: integer('set_id').notNull().references(() => sets.id),
    scoreHome: integer('score_home').notNull(),
    scoreAway: integer('score_away').notNull(),
    homeScored: boolean('home_scored').notNull(),
    kind: pointKindEnum('kind').notNull().default('rally'),
}, table => [index('points_set_id_idx').on(table.setId, table.id)])

// --- Relations ---

export const clubsRelations = relations(clubs, ({ many }) => ({
    teams: many(teams),
}))

export const categoriesRelations = relations(categories, ({ many }) => ({
    teams: many(teams),
    matches: many(matches),
    phases: many(phases),
}))

export const phasesRelations = relations(phases, ({ one, many }) => ({
    category: one(categories, { fields: [phases.categoryId], references: [categories.id] }),
    matches: many(matches),
}))

export const teamsRelations = relations(teams, ({ one, many }) => ({
    club: one(clubs, { fields: [teams.clubId], references: [clubs.id] }),
    category: one(categories, { fields: [teams.categoryId], references: [categories.id] }),
    homeMatches: many(matches, { relationName: 'homeTeam' }),
    awayMatches: many(matches, { relationName: 'awayTeam' }),
}))

export const matchesRelations = relations(matches, ({ one, many }) => ({
    teamHome: one(teams, { fields: [matches.teamHomeId], references: [teams.id], relationName: 'homeTeam' }),
    teamAway: one(teams, { fields: [matches.teamAwayId], references: [teams.id], relationName: 'awayTeam' }),
    category: one(categories, { fields: [matches.categoryId], references: [categories.id] }),
    phase: one(phases, { fields: [matches.phaseId], references: [phases.id] }),
    sets: many(sets),
}))

export const setsRelations = relations(sets, ({ one, many }) => ({
    match: one(matches, { fields: [sets.matchId], references: [matches.id] }),
    points: many(points),
    lineups: many(setLineups),
    substitutions: many(substitutions),
}))

export const setLineupsRelations = relations(setLineups, ({ one }) => ({
    set: one(sets, { fields: [setLineups.setId], references: [sets.id] }),
}))

export const substitutionsRelations = relations(substitutions, ({ one }) => ({
    set: one(sets, { fields: [substitutions.setId], references: [sets.id] }),
}))

export const pointsRelations = relations(points, ({ one }) => ({
    set: one(sets, { fields: [points.setId], references: [sets.id] }),
}))

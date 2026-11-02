import { pgTable, pgEnum, serial, varchar, integer, boolean, timestamp, index, uniqueIndex, jsonb, check } from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'

// --- Enums ---

export const courtEnum = pgEnum('court', ['court1', 'court2'])

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
    tiebreakPoints: integer('tiebreak_points').notNull().default(15),
    minLead: integer('min_lead').notNull().default(2),
    pointCap: integer('point_cap'),
})

// --- Tables ---

export const users = pgTable('users', {
    id: serial('id').primaryKey(),
    username: varchar('username', { length: 50 }).notNull().unique(),
    displayName: varchar('display_name', { length: 100 }).notNull(),
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    role: userRoleEnum('role').notNull(),
    active: boolean('active').notNull().default(true),
    // Bumped on password, role or access changes: open sessions stop working.
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

export const matches = pgTable('matches', {
    id: serial('id').primaryKey(),
    teamHomeId: integer('team_home_id').notNull().references(() => teams.id),
    teamAwayId: integer('team_away_id').notNull().references(() => teams.id),
    categoryId: integer('category_id').notNull().references(() => categories.id),
    court: courtEnum('court').notNull(),
    scheduledAt: timestamp('scheduled_at').notNull(),
    status: matchStatusEnum('status').notNull().default('upcoming'),
    ...ruleColumns(),
}, table => [index('matches_category_schedule_idx').on(table.categoryId, table.scheduledAt)])

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

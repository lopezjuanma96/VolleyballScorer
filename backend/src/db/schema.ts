import { pgTable, pgEnum, serial, varchar, integer, boolean, timestamp, index, uniqueIndex, jsonb } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

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

// --- Tables ---

export const clubs = pgTable('clubs', {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 100 }).notNull().unique(),
    logo: varchar('logo', { length: 255 }),
})

export const categories = pgTable('categories', {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 100 }).notNull().unique(),
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
}, table => [index('matches_category_schedule_idx').on(table.categoryId, table.scheduledAt)])

export const sets = pgTable('sets', {
    id: serial('id').primaryKey(),
    matchId: integer('match_id').notNull().references(() => matches.id),
    setNumber: integer('set_number').notNull(),
    status: setStatusEnum('status').notNull().default('in_progress'),
    revision: integer('revision').notNull().default(0),
}, table => [uniqueIndex('sets_match_number_idx').on(table.matchId, table.setNumber), index('sets_match_idx').on(table.matchId)])

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
}))

export const pointsRelations = relations(points, ({ one }) => ({
    set: one(sets, { fields: [points.setId], references: [sets.id] }),
}))

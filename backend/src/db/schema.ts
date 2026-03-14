import { pgTable, pgEnum, serial, varchar, integer, boolean, timestamp } from 'drizzle-orm/pg-core'

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
})

export const categories = pgTable('categories', {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 100 }).notNull().unique(),
})

export const teams = pgTable('teams', {
    id: serial('id').primaryKey(),
    clubId: integer('club_id').notNull().references(() => clubs.id),
    categoryId: integer('category_id').notNull().references(() => categories.id),
})

export const matches = pgTable('matches', {
    id: serial('id').primaryKey(),
    teamHomeId: integer('team_home_id').notNull().references(() => teams.id),
    teamAwayId: integer('team_away_id').notNull().references(() => teams.id),
    categoryId: integer('category_id').notNull().references(() => categories.id),
    court: courtEnum('court').notNull(),
    scheduledAt: timestamp('scheduled_at').notNull(),
    status: matchStatusEnum('status').notNull().default('upcoming'),
})

export const sets = pgTable('sets', {
    id: serial('id').primaryKey(),
    matchId: integer('match_id').notNull().references(() => matches.id),
    setNumber: integer('set_number').notNull(),
    status: setStatusEnum('status').notNull().default('in_progress'),
})

export const points = pgTable('points', {
    id: serial('id').primaryKey(),
    setId: integer('set_id').notNull().references(() => sets.id),
    scoreHome: integer('score_home').notNull(),
    scoreAway: integer('score_away').notNull(),
    homeScored: boolean('home_scored').notNull(),
})

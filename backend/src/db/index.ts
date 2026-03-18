import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'
import { dbConfig } from './config'

const client = postgres({ ...dbConfig, username: process.env.PSQL_USER })

export const db = drizzle(client, { schema })

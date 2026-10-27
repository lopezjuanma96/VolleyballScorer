import { drizzle } from 'drizzle-orm/postgres-js'
import * as schema from './schema'
import { createClient } from './config'

export const client = createClient()
export const db = drizzle(client, { schema })

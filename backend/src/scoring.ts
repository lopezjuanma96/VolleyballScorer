import { HTTPException } from 'hono/http-exception'
import { eq } from 'drizzle-orm'
import { db } from './db'
import { matches, sets } from './db/schema'
export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

// Always lock match before set, also used by match status updates. Points and set
// transitions serialize across managers without overwriting another rally.
export async function lockActiveSet(tx: Transaction, id: number) {
    const [lookup] = await tx.select().from(sets).where(eq(sets.id, id))
    if (!lookup) throw new HTTPException(404, { message: 'Set no encontrado.' })
    const [match] = await tx.select().from(matches).where(eq(matches.id, lookup.matchId)).for('update')
    const [set] = await tx.select().from(sets).where(eq(sets.id, id)).for('update')
    if (!match || !set) throw new HTTPException(404, { message: 'Partido no encontrado.' })
    if (match.status !== 'in_progress' || set.status !== 'in_progress') {
        throw new HTTPException(409, { message: 'El partido y el set deben estar en juego. Actualizá la pantalla.' })
    }
    return set
}

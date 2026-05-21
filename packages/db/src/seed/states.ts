import { createDb } from '../index'
import { states } from '../schema/states'
import { STATES_SEED } from './data'

async function seed() {
  const dataDir = process.env['PGLITE_DATA_DIR'] ?? './DB'
  const db = createDb(dataDir)
  await db.insert(states).values([...STATES_SEED]).onConflictDoNothing()
  console.log(`Seeded ${STATES_SEED.length} states`)
  process.exit(0)
}

seed().catch((err) => {
  console.error(err)
  process.exit(1)
})

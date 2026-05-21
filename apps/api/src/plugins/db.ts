import fp from 'fastify-plugin'
import type { FastifyInstance } from 'fastify'
import { createDb, migrateDb, ensureSeeded, type Db } from '@sfs/db'

declare module 'fastify' {
  interface FastifyInstance {
    db: Db
  }
}

export default fp(async (app: FastifyInstance) => {
  const dataDir = process.env['PGLITE_DATA_DIR'] ?? './DB'
  const db = createDb(dataDir)
  await migrateDb(db)
  await ensureSeeded(db)
  app.decorate('db', db)
})

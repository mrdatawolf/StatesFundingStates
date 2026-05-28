import Fastify from 'fastify'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import dbPlugin from './plugins/db.js'
import ingestRoutes from './routes/ingest.js'
import balanceRoutes from './routes/balances.js'
import votingRoutes from './routes/voting.js'

const app = Fastify({ logger: true })

await app.register(cors, { origin: true })
await app.register(multipart)
await app.register(dbPlugin)
await app.register(ingestRoutes)
await app.register(balanceRoutes)
await app.register(votingRoutes)

app.get('/health', async () => ({ status: 'ok' }))

const host = process.env['API_HOST'] ?? '0.0.0.0'
const port = parseInt(process.env['API_PORT'] ?? '3001', 10)

await app.listen({ host, port })

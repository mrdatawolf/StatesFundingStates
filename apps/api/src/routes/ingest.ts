import type { FastifyInstance } from 'fastify'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { collectUsaSpending, collectIrsSoi, collectIrsSoiBatch, collectCensusPopulation, downloadIrsSoiYear } from '@sfs/collectors'
import { computeBalances } from '@sfs/processor'
import { ingestRuns } from '@sfs/db'
import { desc } from 'drizzle-orm'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const IRS_DATA_BASE = join(REPO_ROOT, 'data', 'irs-soi')

export default async function ingestRoutes(app: FastifyInstance) {
  // Trigger a USASpending fetch for a given fiscal year.
  // Precondition: fiscalYear query param is a valid integer in [1990..currentYear]
  app.post<{ Body: { fiscalYear: number } }>('/ingest/usa-spending', async (req, reply) => {
    const { fiscalYear } = req.body
    if (!Number.isInteger(fiscalYear)) {
      return reply.status(400).send({ error: 'fiscalYear must be an integer' })
    }

    const result = await collectUsaSpending(app.db, fiscalYear)
    return reply.status(202).send(result)
  })

  // Accept an IRS SOI file upload for a given fiscal year and state.
  // Precondition: ?year and ?fips query params are valid; body is multipart with a single file (CSV or Excel)
  app.post<{ Querystring: { year: string; fips?: string } }>('/ingest/irs-soi', async (req, reply) => {
    const fiscalYear = parseInt(req.query.year, 10)
    if (isNaN(fiscalYear)) {
      return reply.status(400).send({ error: 'year query param is required and must be an integer' })
    }

    const data = await req.file()
    if (!data) return reply.status(400).send({ error: 'No file uploaded' })

    const buffer = await data.toBuffer()
    const result = await collectIrsSoi(app.db, fiscalYear, buffer, data.mimetype, req.query.fips)
    return reply.status(202).send(result)
  })

  // Download all IRS Data Book state files for a fiscal year and ingest them.
  // Precondition: ?year query param is a valid integer in [2020..currentYear]
  // Postcondition: files saved to data/irs-soi/{year}/; rawTaxReceipts rows written for parsed states
  app.post<{ Querystring: { year: string } }>('/ingest/irs-soi/scrape', async (req, reply) => {
    const fiscalYear = parseInt(req.query.year, 10)
    if (isNaN(fiscalYear) || fiscalYear < 2020) {
      return reply.status(400).send({ error: 'year query param must be an integer >= 2020' })
    }

    const filesDir = join(IRS_DATA_BASE, String(fiscalYear))
    const scrape = await downloadIrsSoiYear(fiscalYear, filesDir)
    const ingest = await collectIrsSoiBatch(app.db, fiscalYear, filesDir)

    return reply.status(202).send({ scrape, ingest })
  })

  // Trigger a Census population fetch for a given year.
  app.post<{ Body: { censusYear: number } }>('/ingest/census', async (req, reply) => {
    const { censusYear } = req.body
    if (!Number.isInteger(censusYear)) {
      return reply.status(400).send({ error: 'censusYear must be an integer' })
    }

    const apiKey = process.env['CENSUS_API_KEY'] ?? ''
    const result = await collectCensusPopulation(app.db, censusYear, apiKey)
    return reply.status(202).send(result)
  })

  // Trigger balance computation for a fiscal year.
  // Precondition: complete ingest runs exist for both usa_spending and irs_soi for this year
  app.post<{ Body: { fiscalYear: number } }>('/ingest/compute', async (req, reply) => {
    const { fiscalYear } = req.body
    if (!Number.isInteger(fiscalYear)) {
      return reply.status(400).send({ error: 'fiscalYear must be an integer' })
    }

    const result = await computeBalances(app.db, fiscalYear)
    return reply.send(result)
  })

  // List all ingest runs, most recent first.
  app.get('/ingest/runs', async (_req, reply) => {
    const runs = await app.db
      .select()
      .from(ingestRuns)
      .orderBy(desc(ingestRuns.startedAt))
      .limit(100)
    return reply.send(runs)
  })
}

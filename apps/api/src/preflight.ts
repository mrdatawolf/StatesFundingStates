import { execSync } from 'child_process'
import { existsSync, readdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const migrationsDir = join(root, 'packages/db/migrations')

const hasMigrations =
  existsSync(migrationsDir) &&
  readdirSync(migrationsDir).some((f) => f.endsWith('.sql'))

if (!hasMigrations) {
  console.log('[preflight] No migration files found — generating from schema...')
  execSync('pnpm --filter @sfs/db generate', { cwd: root, stdio: 'inherit' })
  console.log('[preflight] Migrations generated.')
}

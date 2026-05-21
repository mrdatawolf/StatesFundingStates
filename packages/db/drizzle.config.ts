import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './migrations',
  dialect: 'postgresql',
  driver: 'pglite',
  dbCredentials: {
    url: process.env['PGLITE_DATA_DIR'] ?? './DB',
  },
})

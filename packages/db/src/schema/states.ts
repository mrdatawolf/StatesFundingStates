import { pgTable, char, varchar } from 'drizzle-orm/pg-core'

export const states = pgTable('states', {
  fips: char('fips', { length: 2 }).primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  abbreviation: char('abbreviation', { length: 2 }).notNull().unique(),
})

export type State = typeof states.$inferSelect

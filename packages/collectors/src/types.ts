export interface CollectorResult {
  ingestRunId: string
  rowsWritten: number
}

// Normalized record shape that each collector must produce before writing to DB.
// Postcondition of every collector: all fields are present and amountCents >= 0.
export interface RawSpendingRecord {
  stateFips: string
  fiscalYear: number
  category: 'grants' | 'contracts' | 'loans' | 'direct_payments' | 'insurance'
  amountCents: number
}

export interface RawTaxRecord {
  stateFips: string
  fiscalYear: number
  taxType: 'individual_income' | 'corporate' | 'payroll' | 'excise' | 'estate'
  amountCents: number
}

export interface RawPopulationRecord {
  stateFips: string
  censusYear: number
  population: number
}

export interface RawVotingRecord {
  stateFips: string
  electionYear: number
  demVotes: number
  repVotes: number
  otherVotes: number
  totalVotes: number
}

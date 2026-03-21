import { useQuery } from '@tanstack/react-query'
import { UseCustomQueryOptions } from 'types'
import { executeSql, ExecuteSqlError } from '../sql/execute-sql-query'
import { databaseKeys } from './keys'

export type DatabaseMigration = {
  version: string
  name?: string
  statements?: string[]
}

export const getMigrationsSql = () => {
  const sql = /* SQL */ `
    select
      *
    from supabase_migrations.schema_migrations sm
    order by sm.version desc
  `.trim()

  return sql
}

export type MigrationsVariables = {
  projectRef?: string
  connectionString?: string | null
}

export async function getMigrations(
  { projectRef, connectionString }: MigrationsVariables,
  signal?: AbortSignal
) {
  const sql = getMigrationsSql()

  try {
    const { result } = await executeSql(
      { projectRef, connectionString, sql, queryKey: ['migrations'] },
      signal
    )

    return result as DatabaseMigration[]
  } catch (error) {
    console.log('MIGRATION ERROR:', error, (error as any).message)
    const errString = String((error as any).message || (error as any).error || JSON.stringify(error))
    if (
      errString.includes(
        'relation "supabase_migrations.schema_migrations" does not exist'
      )
    ) {
      return []
    }

    // Display the exact error in the UI temporarily for debugging
    throw new Error(`DEBUG_ERROR: ${errString}`)
  }
}

export type MigrationsData = Awaited<ReturnType<typeof getMigrations>>
export type MigrationsError = ExecuteSqlError

export const useMigrationsQuery = <TData = MigrationsData>(
  { projectRef, connectionString }: MigrationsVariables,
  { enabled = true, ...options }: UseCustomQueryOptions<MigrationsData, MigrationsError, TData> = {}
) =>
  useQuery<MigrationsData, MigrationsError, TData>({
    queryKey: databaseKeys.migrations(projectRef),
    queryFn: ({ signal }) => getMigrations({ projectRef, connectionString }, signal),
    enabled: enabled && typeof projectRef !== 'undefined',
    ...options,
  })

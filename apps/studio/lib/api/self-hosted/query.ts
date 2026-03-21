import { PG_META_URL } from 'lib/constants/index'
import { constructHeaders } from '../apiHelpers'
import { PgMetaDatabaseError, databaseErrorSchema, WrappedResult } from './types'
import { assertSelfHosted, encryptString, getConnectionString } from './util'

export type QueryOptions = {
  query: string
  parameters?: unknown[]
  readOnly?: boolean
  headers?: HeadersInit
}

// [VOCOSTAR] Self-hosted: pg-meta has its own DB connection via env vars
const IS_SELF_HOSTED = process.env.NEXT_PUBLIC_IS_SELF_HOSTED === 'true'

/**
 * Executes a SQL query against the self-hosted Postgres instance via pg-meta service.
 *
 * _Only call this from server-side self-hosted code._
 */
export async function executeQuery<T = unknown>({
  query,
  parameters,
  readOnly = false,
  headers,
}: QueryOptions): Promise<WrappedResult<T[]>> {
  assertSelfHosted()

  const requestBody: { query: string; parameters?: unknown[] } = { query }
  if (parameters !== undefined) {
    requestBody.parameters = parameters
  }

  // [VOCOSTAR] In IS_SELF_HOSTED mode, pg-meta connects to its own DB via env vars.
  // Do NOT send x-connection-encrypted: pg-meta would try to use it instead of its env vars,
  // causing auth failures (wrong key/host/port from outside Docker network).
  const headersToSend: Record<string, string> = IS_SELF_HOSTED
    ? {
        ...(headers as Record<string, string>),
        'Content-Type': 'application/json',
      }
    : {
        ...(headers as Record<string, string>),
        'Content-Type': 'application/json',
        'x-connection-encrypted': encryptString(getConnectionString({ readOnly })),
      }

  const response = await fetch(`${PG_META_URL}/query`, {
    method: 'POST',
    headers: constructHeaders(headersToSend),
    body: JSON.stringify(requestBody),
  })

  try {
    const result = await response.json()

    if (!response.ok) {
      // [VOCOSTAR] pg-meta returns different error formats depending on the error type.
      // Try to parse the standard format first, then fall back to a generic error.
      try {
        const { message, code, formattedError } = databaseErrorSchema.parse(result)
        const error = new PgMetaDatabaseError(message, code, response.status, formattedError)
        return { data: undefined, error }
      } catch {
        // pg-meta returned a non-standard error format (e.g., {error: "..."})
        const errorMessage = result?.message || result?.error || JSON.stringify(result)
        const error = new PgMetaDatabaseError(
          String(errorMessage),
          String(result?.code || response.status),
          response.status,
          String(result?.formattedError || errorMessage)
        )
        return { data: undefined, error }
      }
    }

    return { data: result, error: undefined }
  } catch (error) {
    if (error instanceof Error) {
      return { data: undefined, error }
    }
    throw error
  }
}

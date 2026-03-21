import crypto from 'crypto-js'
import { IS_PLATFORM } from 'lib/constants'
import {
  ENCRYPTION_KEY,
  POSTGRES_DATABASE,
  POSTGRES_HOST,
  POSTGRES_PASSWORD,
  POSTGRES_PORT,
  POSTGRES_USER_READ_WRITE,
  POSTGRES_USER_READ_ONLY,
} from './constants'

/**
 * Asserts that the current environment is self-hosted.
 * [VOCOSTAR] Also accepts IS_SELF_HOSTED=true when IS_PLATFORM=true (bypass mode)
 */
export function assertSelfHosted() {
  const isSelfHosted = process.env.NEXT_PUBLIC_IS_SELF_HOSTED === 'true'
  if (IS_PLATFORM && !isSelfHosted) {
    throw new Error('This function can only be called in self-hosted environments')
  }
}

export function encryptString(stringToEncrypt: string): string {
  return crypto.AES.encrypt(stringToEncrypt, ENCRYPTION_KEY).toString()
}

export function getConnectionString({ readOnly }: { readOnly: boolean }) {
  const postgresUser = readOnly ? POSTGRES_USER_READ_ONLY : POSTGRES_USER_READ_WRITE

  return `postgresql://${postgresUser}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DATABASE}`
}

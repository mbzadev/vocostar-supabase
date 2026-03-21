import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { uuidv4 } from 'lib/helpers'

const API_KEYS_FILE_PATH = path.join(process.cwd(), '.api_keys.json')

export interface APIKey {
  id: string
  name: string
  api_key: string
  type: 'publishable' | 'secret'
  hash: string
  prefix: string
  description?: string
  created_at?: string
}

function base64url(str: string | Buffer): string {
  const base64 = typeof str === 'string' ? Buffer.from(str).toString('base64') : str.toString('base64');
  return base64.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function signJwt(payload: object, secret: string): string {
  const header = { alg: 'HS256', typ: 'JWT' }
  const encodedHeader = base64url(JSON.stringify(header))
  const encodedPayload = base64url(JSON.stringify(payload))
  const signatureString = `${encodedHeader}.${encodedPayload}`
  const signature = crypto.createHmac('sha256', secret).update(signatureString).digest()
  const encodedSignature = base64url(signature)
  return `${signatureString}.${encodedSignature}`
}

function readLocalKeys(): APIKey[] {
  if (!fs.existsSync(API_KEYS_FILE_PATH)) {
    return []
  }
  try {
    const data = fs.readFileSync(API_KEYS_FILE_PATH, 'utf-8')
    return JSON.parse(data) as APIKey[]
  } catch (error) {
    console.error('Failed to read .api_keys.json', error)
    return []
  }
}

function writeLocalKeys(keys: APIKey[]): void {
  fs.writeFileSync(API_KEYS_FILE_PATH, JSON.stringify(keys, null, 2), 'utf-8')
}

export function getAPIKeys(): APIKey[] {
  return readLocalKeys()
}

export function createAPIKey(payload: { name: string; type: 'publishable' | 'secret'; description?: string }): APIKey {
  const secret = process.env.AUTH_JWT_SECRET
  if (!secret) {
    throw new Error('AUTH_JWT_SECRET is not defined')
  }

  const role = payload.type === 'secret' ? 'service_role' : 'anon'
  
  const jwtPayload = {
    role,
    iss: 'supabase',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365 * 10, // 10 years
    jti: crypto.randomBytes(16).toString('hex')
  }

  const jwt = signJwt(jwtPayload, secret)
  const id = uuidv4()

  const newKey: APIKey = {
    id,
    name: payload.name,
    api_key: jwt,
    type: payload.type,
    hash: crypto.createHash('sha256').update(jwt).digest('hex'),
    prefix: jwt.substring(0, 10),
    description: payload.description,
    created_at: new Date().toISOString()
  }

  const keys = readLocalKeys()
  keys.push(newKey)
  writeLocalKeys(keys)

  return newKey
}

export function deleteAPIKey(id: string): void {
  const keys = readLocalKeys()
  const filtered = keys.filter(k => k.id !== id)
  writeLocalKeys(filtered)
}

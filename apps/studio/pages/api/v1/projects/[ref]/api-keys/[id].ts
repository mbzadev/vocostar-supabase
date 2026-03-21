import { NextApiRequest, NextApiResponse } from 'next'
import apiWrapper from 'lib/api/apiWrapper'
import { deleteAPIKey, getAPIKeys } from 'lib/api/self-hosted/api-keys'

export default function handlerWithErrorCatching(req: NextApiRequest, res: NextApiResponse) {
  return apiWrapper(req, res, handler)
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { method } = req

  switch (method) {
    case 'GET':
      return handleGet(req, res)
    case 'DELETE':
      return handleDelete(req, res)
    default:
      res.setHeader('Allow', ['GET', 'DELETE'])
      res.status(405).json({ data: null, error: { message: `Method ${method} Not Allowed` } })
  }
}

const handleGet = async (req: NextApiRequest, res: NextApiResponse) => {
  const { id } = req.query
  if (typeof id !== 'string') {
    return res.status(400).json({ error: { message: 'Invalid ID' } })
  }

  const customKeys = getAPIKeys()
  const key = customKeys.find((k) => k.id === id)
  
  if (!key) {
    // If it's a default key like "default-anon" or "default-service-role", we can return a dummy structure for now
    // or just search the environment values
    const defaultKeys = [
      { id: 'default-anon', api_key: process.env.SUPABASE_ANON_KEY ?? '', name: 'anon', type: 'publishable' },
      { id: 'default-service-role', api_key: process.env.SUPABASE_SERVICE_KEY ?? '', name: 'service_role', type: 'secret' },
    ]
    const defaultKey = defaultKeys.find((k) => k.id === id)
    if (defaultKey) return res.status(200).json(defaultKey)

    return res.status(404).json({ error: { message: 'API Key not found' } })
  }

  return res.status(200).json(key)
}

const handleDelete = async (req: NextApiRequest, res: NextApiResponse) => {
  const { id } = req.query
  if (typeof id !== 'string') {
    return res.status(400).json({ error: { message: 'Invalid ID' } })
  }

  try {
    deleteAPIKey(id)
    return res.status(200).json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return res.status(500).json({ error: { message } })
  }
}

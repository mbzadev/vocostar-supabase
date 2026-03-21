import { NextApiRequest, NextApiResponse } from 'next'

import { components } from 'api-types'
import apiWrapper from 'lib/api/apiWrapper'

type ProjectAppConfig = components['schemas']['ProjectSettingsResponse']['app_config'] & {
  protocol?: string
}
export type ProjectSettings = components['schemas']['ProjectSettingsResponse'] & {
  app_config?: ProjectAppConfig
}

export default function handlerWithErrorCatching(req: NextApiRequest, res: NextApiResponse) {
  console.log('[API KEYS] Entered handlerWithErrorCatching')
  return apiWrapper(req, res, handler)
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { method } = req
  console.log('[API KEYS] In handler, method:', method)

  switch (method) {
    case 'GET':
      return handleGetAll(req, res)
    case 'POST':
      return handlePost(req, res)
    default:
      res.setHeader('Allow', ['GET', 'POST'])
      res.status(405).json({ data: null, error: { message: `Method ${method} Not Allowed` } })
  }
}

import { getAPIKeys, createAPIKey } from 'lib/api/self-hosted/api-keys'

const handleGetAll = async (req: NextApiRequest, res: NextApiResponse) => {
  console.log('[API KEYS] In handleGetAll')
  const defaultKeys = [
    {
      name: 'anon',
      api_key: process.env.SUPABASE_ANON_KEY ?? '',
      id: 'default-anon',
      type: 'publishable',
      hash: '',
      prefix: '',
      description: 'Legacy anon API key',
    },
    {
      name: 'service_role',
      api_key: process.env.SUPABASE_SERVICE_KEY ?? '',
      id: 'default-service-role',
      type: 'secret',
      hash: '',
      prefix: '',
      description: 'Legacy service_role API key',
    },
  ]

  console.log('[API KEYS] Calling getAPIKeys')
  const customKeys = getAPIKeys()
  console.log('[API KEYS] Got customKeys', customKeys)
  return res.status(200).json([...defaultKeys, ...customKeys])
}

const handlePost = async (req: NextApiRequest, res: NextApiResponse) => {
  const { name, type, description } = req.body
  try {
    const newKey = createAPIKey({ name, type, description })
    return res.status(200).json(newKey)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return res.status(500).json({ error: { message } })
  }
}

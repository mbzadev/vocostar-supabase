import { NextApiRequest, NextApiResponse } from 'next'
import apiWrapper from 'lib/api/apiWrapper'

// [VOCOSTAR] Self-hosted: proxy auth hooks config to GoTrue admin API

const GOTRUE_URL = process.env.GOTRUE_ADMIN_URL || 'http://localhost:9999'
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || ''

export default (req: NextApiRequest, res: NextApiResponse) => apiWrapper(req, res, handler)

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { method } = req

  switch (method) {
    case 'PATCH':
    case 'PUT':
      return handleUpdate(req, res)
    default:
      res.setHeader('Allow', ['PATCH', 'PUT'])
      res.status(405).json({ data: null, error: { message: `Method ${method} Not Allowed` } })
  }
}

const handleUpdate = async (req: NextApiRequest, res: NextApiResponse) => {
  try {
    const response = await fetch(`${GOTRUE_URL}/admin/config`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req.body),
    })

    if (!response.ok) {
      const error = await response.text()
      return res.status(response.status).json({ error: { message: error } })
    }

    const data = await response.json()
    return res.status(200).json(data)
  } catch (err: any) {
    return res.status(500).json({ error: { message: err.message } })
  }
}

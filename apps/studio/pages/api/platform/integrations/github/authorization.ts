import { NextApiRequest, NextApiResponse } from 'next'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  // On self-hosted instances, we bypass the actual GitHub OAuth code exchange.
  // The cloud platform uses its proprietary OAuth app. Here, we just return a 200 OK
  // so the authorization flow "completes" successfully in the UI without crashing.
  return res.status(200).json({ success: true, message: 'Self-hosted GitHub authorization bypassed.' })
}

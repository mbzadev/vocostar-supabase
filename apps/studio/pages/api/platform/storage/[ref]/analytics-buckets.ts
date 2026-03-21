import { NextApiRequest, NextApiResponse } from 'next'
import apiWrapper from 'lib/api/apiWrapper'
import { executeQuery } from 'lib/api/self-hosted/query'

export default function handlerWithErrorCatching(req: NextApiRequest, res: NextApiResponse) {
  return apiWrapper(req, res, handler)
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { method } = req

  switch (method) {
    case 'GET':
      return handleGet(req, res)
    case 'POST':
      return handlePost(req, res)
    case 'DELETE':
      return handleDelete(req, res)
    default:
      res.setHeader('Allow', ['GET', 'POST', 'DELETE'])
      res.status(405).json({ data: null, error: { message: `Method ${method} Not Allowed` } })
  }
}

const handleGet = async (req: NextApiRequest, res: NextApiResponse) => {
  const { ref } = req.query
  if (typeof ref !== 'string') {
    return res.status(400).json({ error: { message: 'Invalid ref' } })
  }

  try {
    // Query storage.buckets on self-hosted instances to find buckets marked as analytics
    const query = `SELECT id, name, created_at FROM storage.buckets WHERE name LIKE 'analytics_bucket_%'`
    const result = await executeQuery({ query })

    if (result.error) {
      return res.status(200).json({ data: [] })
    }

    const buckets = result.data?.map((b: any) => ({
      name: b.name.replace('analytics_bucket_', ''),
      created_at: b.created_at,
    })) || []

    return res.status(200).json({ data: buckets })
  } catch (error) {
    return res.status(200).json({ data: [] })
  }
}

const handlePost = async (req: NextApiRequest, res: NextApiResponse) => {
  const { ref } = req.query
  const { bucketName } = req.body

  if (typeof ref !== 'string' || typeof bucketName !== 'string') {
    return res.status(400).json({ error: { message: 'Invalid request' } })
  }

  try {
    const prefixedName = `analytics_bucket_${bucketName}`
    const query = `INSERT INTO storage.buckets (id, name, public) VALUES ('${prefixedName}', '${prefixedName}', false) RETURNING id, name, created_at`
    const result = await executeQuery({ query })

    if (result.error) {
       return res.status(500).json({ error: { message: result.error.message }})
    }

    return res.status(200).json({ data: { name: bucketName } })
  } catch (error: any) {
    return res.status(500).json({ error: { message: error.message || 'Unknown error' } })
  }
}

const handleDelete = async (req: NextApiRequest, res: NextApiResponse) => {
  const { ref, name } = req.query
  // Note: API might pass the bucket name differently for DELETE, assuming 'name' or 'bucketName'
  const bucketToDelete = name || req.body?.bucketName || req.query.bucketName
  
  if (typeof ref !== 'string' || typeof bucketToDelete !== 'string') {
    return res.status(400).json({ error: { message: 'Invalid request' } })
  }

  try {
    const prefixedName = `analytics_bucket_${bucketToDelete}`
    const query = `DELETE FROM storage.buckets WHERE id = '${prefixedName}'`
    const result = await executeQuery({ query })

    if (result.error) {
       return res.status(500).json({ error: { message: result.error.message }})
    }

    return res.status(200).json({ data: { name: bucketToDelete } })
  } catch (error: any) {
    return res.status(500).json({ error: { message: error.message || 'Unknown error' } })
  }
}

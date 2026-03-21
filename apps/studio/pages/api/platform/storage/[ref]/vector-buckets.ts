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
    // Query storage.buckets on self-hosted instances to find buckets marked as vectors
    const query = `SELECT id, name, created_at FROM storage.buckets WHERE name LIKE 'vector_bucket_%'`
    const result = await executeQuery({ query })

    if (result.error) {
      // If storage.buckets doesn't exist or table error
      return res.status(200).json({ vectorBuckets: [] })
    }

    const vectorBuckets = result.data?.map((b: any) => ({
      vectorBucketName: b.name.replace('vector_bucket_', ''),
      creationTime: Math.floor(new Date(b.created_at).getTime() / 1000).toString(),
    })) || []

    return res.status(200).json({ vectorBuckets })
  } catch (error) {
    return res.status(200).json({ vectorBuckets: [] })
  }
}

const handlePost = async (req: NextApiRequest, res: NextApiResponse) => {
  const { ref } = req.query
  const { bucketName } = req.body

  if (typeof ref !== 'string' || typeof bucketName !== 'string') {
    return res.status(400).json({ error: { message: 'Invalid request' } })
  }

  try {
    const prefixedName = `vector_bucket_${bucketName}`
    const query = `INSERT INTO storage.buckets (id, name, public) VALUES ('${prefixedName}', '${prefixedName}', false) RETURNING id, name, created_at`
    const result = await executeQuery({ query })

    if (result.error) {
       return res.status(500).json({ error: { message: result.error.message }})
    }

    return res.status(200).json({ name: bucketName })
  } catch (error: any) {
    return res.status(500).json({ error: { message: error.message || 'Unknown error' } })
  }
}

const handleDelete = async (req: NextApiRequest, res: NextApiResponse) => {
  const { ref, bucketName } = req.query
  if (typeof ref !== 'string' || typeof bucketName !== 'string') {
    return res.status(400).json({ error: { message: 'Invalid request' } })
  }

  try {
    const prefixedName = `vector_bucket_${bucketName}`
    const query = `DELETE FROM storage.buckets WHERE id = '${prefixedName}'`
    const result = await executeQuery({ query })

    if (result.error) {
       return res.status(500).json({ error: { message: result.error.message }})
    }

    return res.status(200).json({ name: bucketName })
  } catch (error: any) {
    return res.status(500).json({ error: { message: error.message || 'Unknown error' } })
  }
}

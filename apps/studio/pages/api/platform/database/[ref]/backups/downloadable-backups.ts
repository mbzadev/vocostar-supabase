import { NextApiRequest, NextApiResponse } from 'next'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  // Safely fallback if variables are missing
  const endpoint = process.env.GLOBAL_S3_ENDPOINT || ''
  const region = process.env.WALG_S3_REGION || 'auto'
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID || ''
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY || ''
  const bucketName = process.env.GLOBAL_S3_BUCKET || ''
  
  // This is passed from the frontend UI when a user clicks "Download"
  const fileKey = req.query.backup as string

  if (!endpoint || !accessKeyId || !secretAccessKey || !bucketName) {
    console.warn('Missing R2/S3 credentials for backup downloads.')
    return res.status(400).json({ error: 'Storage credentials not configured.' })
  }

  if (!fileKey) {
    return res.status(400).json({ error: 'Missing backup file key.' })
  }

  try {
    const s3 = new S3Client({
      region,
      endpoint,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
      forcePathStyle: process.env.AWS_S3_FORCE_PATH_STYLE === 'true',
    })

    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: fileKey,
    })

    // Generate a pre-signed URL valid for 1 hour
    const presignedUrl = await getSignedUrl(s3, command, { expiresIn: 3600 })

    // Return the URL as an array of items, as expected by the UI
    return res.status(200).json([
      {
        download_url: presignedUrl,
        file_name: fileKey.split('/').pop() || fileKey,
        inserted_at: new Date().toISOString(), // Mocked timestamp
      }
    ])
  } catch (error) {
    console.error('Failed to generate presigned URL for R2 backup:', error)
    return res.status(500).json({ error: 'Failed to generate download link.' })
  }
}

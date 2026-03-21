import { NextApiRequest, NextApiResponse } from 'next'
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  // Safely fallback if variables are missing so we don't crash
  const endpoint = process.env.GLOBAL_S3_ENDPOINT || ''
  const region = process.env.WALG_S3_REGION || 'auto'
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID || ''
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY || ''
  const bucketName = process.env.GLOBAL_S3_BUCKET || ''
  
  // Example WALG_S3_PREFIX: "s3://app-vocostar/backups/postgres" 
  // We need the prefix path inside the bucket, e.g., "backups/postgres"
  const prefixUrl = process.env.WALG_S3_PREFIX || ''
  let folderPrefix = ''
  if (prefixUrl.startsWith('s3://' + bucketName + '/')) {
    folderPrefix = prefixUrl.replace('s3://' + bucketName + '/', '')
  }

  if (!endpoint || !accessKeyId || !secretAccessKey || !bucketName) {
    console.warn('Missing R2/S3 credentials in environment variables for Self-Hosted backups.')
    return res.status(200).json({ backups: [], pitr_enabled: false })
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

    const command = new ListObjectsV2Command({
      Bucket: bucketName,
      Prefix: folderPrefix,
    })

    const response = await s3.send(command)

    // Map S3 objects to the DatabaseBackup schema expected by Studio
    const backups = (response.Contents || [])
      // Filter out empty directories or non-backup files if needed
      .filter((obj) => obj.Size && obj.Size > 0)
      .map((obj, index) => {
        return {
          id: index, // Fake ID for React keys
          project_id: req.query.ref as string,
          inserted_at: obj.LastModified?.toISOString() || new Date().toISOString(),
          isPhysicalBackup: false, // UI prop
          status: 'COMPLETED',
          physicalBackupData: {
            // Include file size or path if we want to expose it in UI
            file: obj.Key,
            size: obj.Size,
          }
        }
      })

    // Sort descending by date
    backups.sort((a, b) => new Date(b.inserted_at).valueOf() - new Date(a.inserted_at).valueOf())

    return res.status(200).json({
      backups,
      region,
      status: 'COMPLETED',
      pitr_enabled: false // PITR is a separate feature, for scheduled backups this is false
    })
  } catch (error) {
    console.error('Failed to fetch backups from R2:', error)
    // Return empty array instead of 500 to prevent UI crash, but log the error
    return res.status(200).json({ backups: [], pitr_enabled: false })
  }
}

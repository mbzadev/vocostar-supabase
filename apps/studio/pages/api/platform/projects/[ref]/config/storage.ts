import { NextApiRequest, NextApiResponse } from 'next'
import apiWrapper from 'lib/api/apiWrapper'

// [VOCOSTAR] Self-hosted: Storage config handler
// Returns the StorageConfigResponse schema structure expected by project-storage-config-query.ts
// Must include features.icebergCatalog and features.vectorBuckets to avoid TypeError
export default (req: NextApiRequest, res: NextApiResponse) => apiWrapper(req, res, handler)

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { method } = req

  switch (method) {
    case 'GET':
      return handleGet(req, res)
    case 'PATCH':
    case 'PUT':
      return handleUpdate(req, res)
    default:
      res.setHeader('Allow', ['GET', 'PATCH', 'PUT'])
      res.status(405).json({ data: null, error: { message: `Method ${method} Not Allowed` } })
  }
}

const handleGet = async (req: NextApiRequest, res: NextApiResponse) => {
  // Return full StorageConfigResponse structure matching what the Studio expects
  // See: data/config/project-storage-config-query.ts - useIsAnalyticsBucketsEnabled and useIsVectorBucketsEnabled
  // See: components/interfaces/Storage/StorageSettings/CreateCredentialModal.tsx - isS3ConnectionEnabled
  return res.status(200).json({
    // S3 protocol config
    region: process.env.AWS_REGION || 'local',
    endpoint: '',
    bucket: '',
    global_s3_force_path_style: false,
    global_s3_protocol: '',
    credentials: {
      access_key: '',
      secret_key: '',
    },
    enabled: false, // S3 protocol toggle (not S3 storage itself)
    // Features - required to avoid TypeErrors in multiple components
    features: {
      icebergCatalog: {
        enabled: false,
      },
      vectorBuckets: {
        enabled: false,
      },
      s3Protocol: {
        enabled: false,
      },
    },
  })
}

const handleUpdate = async (req: NextApiRequest, res: NextApiResponse) => {
  // In self-hosted, storage configuration is done via env vars
  // We return success but the actual config is in the container
  return res.status(200).json({
    ...req.body,
    features: req.body?.features || {
      icebergCatalog: { enabled: false },
      vectorBuckets: { enabled: false },
    },
  })
}

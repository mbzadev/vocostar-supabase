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
    // For Edge Functions secrets, we query the Vault
    const query = `SELECT id, name, description, secret, decrypted_secret, key_id, created_at, updated_at FROM vault.decrypted_secrets`
    const result = await executeQuery({ query })

    if (result.error) {
      return res.status(200).json([])
    }

    const secrets = result.data?.map((item: unknown) => {
      const s = item as Record<string, unknown>
      return {
        name: s.name as string,
        value: s.decrypted_secret as string,
      }
    }) || []

    return res.status(200).json(secrets)
  } catch (error) {
    return res.status(200).json([])
  }
}

const handlePost = async (req: NextApiRequest, res: NextApiResponse) => {
  const { ref } = req.query
  const secrets = req.body // array of { name: string, value: string }

  if (typeof ref !== 'string' || !Array.isArray(secrets)) {
    return res.status(400).json({ error: { message: 'Invalid request' } })
  }

  try {
    for (const secret of secrets) {
      const { name, value } = secret
      
      // Upsert into vault (if exists, update, otherwise insert)
      // Since Vault doesn't have an easy UPSERT on name alone (name isn't PK), we do a simple check
      const checkQuery = `SELECT id FROM vault.decrypted_secrets WHERE name = '${name}'`
      const checkResult = await executeQuery({ query: checkQuery })

      if (checkResult.data && checkResult.data.length > 0) {
        // Update
        const id = (checkResult.data[0] as Record<string, unknown>).id
        const updateQuery = `UPDATE vault.secrets SET secret = '${value}' WHERE id = '${id}'`
        await executeQuery({ query: updateQuery })
      } else {
        // Insert
        // NOTE: vault.insert_secret(secret, name, description) is the typical way, but we'll try the direct SQL
        const insertQuery = `SELECT vault.create_secret('${value}', '${name}')`
        await executeQuery({ query: insertQuery })
      }
    }

    return res.status(200).json(secrets)
  } catch (error: unknown) {
    const errObj = error instanceof Error ? error : new Error(String(error))
    return res.status(500).json({ error: { message: errObj.message || 'Unknown error' } })
  }
}

const handleDelete = async (req: NextApiRequest, res: NextApiResponse) => {
  const { ref } = req.query
  const names = req.body // array of secret names

  if (typeof ref !== 'string' || !Array.isArray(names)) {
    return res.status(400).json({ error: { message: 'Invalid request' } })
  }

  try {
    for (const name of names) {
      // vault.secrets might not be directly deletable by name without a function,
      // but if the name is unique, we can attempt it.
      // Usually, self-hosted vault doesn't expose a `delete_secret_by_name` RPC default.
      // So we delete by name matching in `decrypted_secrets` view or directly in `secrets`.
      // The safest way is to find the ID first and delete from secrets.
      const checkQuery = `SELECT id FROM vault.decrypted_secrets WHERE name = '${name}'`
      const checkResult = await executeQuery({ query: checkQuery })

      if (checkResult.data && checkResult.data.length > 0) {
        const id = (checkResult.data[0] as Record<string, unknown>).id
        const deleteQuery = `DELETE FROM vault.secrets WHERE id = '${id}'`
        await executeQuery({ query: deleteQuery })
      }
    }

    return res.status(200).json(null)
  } catch (error: unknown) {
    const errObj = error instanceof Error ? error : new Error(String(error))
    return res.status(500).json({ error: { message: errObj.message || 'Unknown error' } })
  }
}


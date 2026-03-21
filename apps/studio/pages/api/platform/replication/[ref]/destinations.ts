import { NextApiRequest, NextApiResponse } from 'next'
import { PG_META_URL } from 'lib/constants'

/**
 * Self-Hosted Logical Replication Destinations
 * Instead of querying the Cloud Platform, we use pg-meta to query
 * PostgreSQL's `pg_publication` table to surface external logical replication slots.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  const { ref } = req.query as { ref: string }

  try {
    // We use pg-meta to query the pg_publication table to see what is already configured
    const query = `
      SELECT pubname as name, oid as id
      FROM pg_publication;
    `
    // Use native Node.js fetch
    const pgMetaRes = await fetch(`${PG_META_URL}/query?query=${encodeURIComponent(query)}`, {
      headers: {
        'x-supabase-project-ref': ref,
      },
    })

    if (!pgMetaRes.ok) {
      console.error('Failed to fetch pg_publication from pg-meta:', await pgMetaRes.text())
      return res.status(200).json({ destinations: [] })
    }

    const pgData = await pgMetaRes.json()
    const publications = pgData || []

    // Map publications to the expected Studio 'Destination' format (fake BigQuery schema for generic compatibility)
    // The Studio UI expects BigQuery or Iceberg configs. To trick it into displaying our custom publications,
    // we use a generic placeholder format.
    const destinations = publications.map((pub: any) => ({
      id: pub.id,
      name: pub.name,
      tenant_id: ref,
      config: {
        big_query: {
          project_id: 'PostgreSQL Native Publication',
          dataset_id: pub.name,
          service_account_key: 'N/A'
        }
      }
    }))

    return res.status(200).json({ destinations })
  } catch (err) {
    console.error('Error fetching replication destinations:', err)
    return res.status(200).json({ destinations: [] })
  }
}

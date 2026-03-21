import { NextApiRequest, NextApiResponse } from 'next'
import { PG_META_URL } from 'lib/constants'

/**
 * Self-Hosted Logical Replication Pipelines
 * We use pg-meta to query `pg_publication_tables` to map existing Postgres
 * logical replication configs to the Studio Pipeline UI.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  const { ref } = req.query as { ref: string }

  try {
    const query = `
      SELECT pubname, schemaname, tablename
      FROM pg_publication_tables;
    `
    // Use native Node.js fetch
    const pgMetaRes = await fetch(`${PG_META_URL}/query?query=${encodeURIComponent(query)}`, {
      headers: {
        'x-supabase-project-ref': ref,
      },
    })

    if (!pgMetaRes.ok) {
      console.error('Failed to fetch pg_publication_tables from pg-meta:', await pgMetaRes.text())
      return res.status(200).json({ pipelines: [] })
    }

    const pgData = await pgMetaRes.json()
    const tables = pgData || []

    // Group tables by publication to construct pipelines
    const pubMap = new Map()
    for (const t of tables) {
      if (!pubMap.has(t.pubname)) { pubMap.set(t.pubname, []) }
      pubMap.get(t.pubname).push(t)
    }

    // Generate pipelines matching the Supabase OpenAPI spec
    const pipelines = Array.from(pubMap.entries()).map(([pubname, pubTables], index) => {
      return {
        id: index + 1000,
        source_id: 1, // mocked source
        source_name: 'PostgreSQL Database',
        destination_id: index + 2000,
        destination_name: pubname,
        replicator_id: index + 3000,
        tenant_id: ref,
        config: {
          publication_name: pubname,
          max_copy_connections_per_table: 2,
          max_table_sync_workers: 4,
          invalidated_slot_behavior: 'error'
        }
      }
    })

    return res.status(200).json({ pipelines })
  } catch (err) {
    console.error('Error fetching replication pipelines:', err)
    return res.status(200).json({ pipelines: [] })
  }
}

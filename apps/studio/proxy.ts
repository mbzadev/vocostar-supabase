import { IS_PLATFORM } from 'lib/constants'
import type { NextRequest } from 'next/server'

export const config = {
  matcher: '/api/:function*',
}

// [Joshen] Return 404 for all next.js API endpoints EXCEPT the ones we use in hosted:
const HOSTED_SUPPORTED_API_URLS = [
  '/ai/sql/generate-v4',
  '/ai/sql/policy',
  '/ai/feedback/rate',
  '/ai/code/complete',
  '/ai/sql/cron-v2',
  '/ai/sql/title-v2',
  '/ai/sql/filter-v1',
  '/ai/onboarding/design',
  '/ai/feedback/classify',
  '/ai/docs',
  '/get-ip-address',
  '/get-utc-time',
  '/get-deployment-commit',
  '/check-cname',
  '/edge-functions/test',
  '/edge-functions/body',
  '/generate-attachment-url',
  '/incident-status',
  '/incident-banner',
  '/status-override',
  '/api/integrations/stripe-sync',
  '/content/graphql',
]

// [VOCOSTAR] IS_SELF_HOSTED: on lit la var d'env directement car IS_SELF_HOSTED const n'est pas
// disponible dans le Edge runtime. On bypasse le blocage pour laisser les handlers self-hosted répondre.
const IS_SELF_HOSTED = process.env.NEXT_PUBLIC_IS_SELF_HOSTED === 'true'

export function proxy(request: NextRequest) {
  // [VOCOSTAR] Self-hosted: bypass everything and let route handlers handle it
  return
}

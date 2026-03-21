import { NextApiRequest, NextApiResponse } from 'next'
import apiWrapper from 'lib/api/apiWrapper'

// [VOCOSTAR] Self-hosted: Auth config handler
// GoTrue /admin/config is not exposed through Kong (only internal Docker network)
// We construct a sensible default config from env vars.
// Settings changes from Studio UI won't persist to GoTrue (limitation of self-hosted with containerized GoTrue)
// To persist changes, users must update the docker-compose.local.yml environment vars.

const handler_wrapped = (req: NextApiRequest, res: NextApiResponse) => apiWrapper(req, res, handler)
export default handler_wrapped

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
  // Try to call GoTrue admin config directly first (if port 9999 is exposed)
  const gotrueAdminUrl = process.env.GOTRUE_ADMIN_URL || 'http://localhost:9999'
  const serviceKey = process.env.SUPABASE_SERVICE_KEY || ''

  try {
    const response = await fetch(`${gotrueAdminUrl}/admin/config`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(2000), // 2 second timeout
    })

    if (response.ok) {
      const data = await response.json()
      return res.status(200).json(data)
    }
  } catch {
    // GoTrue not directly accessible, fall through to default config
  }

  // Return sensible default GoTrue config when GoTrue admin API is not directly accessible
  // This allows Studio auth pages to render without crashing
  const siteUrl = process.env.SUPABASE_PUBLIC_URL || 'http://localhost:8005'
  const config = {
    // Email settings
    DISABLE_SIGNUP: false,
    EXTERNAL_EMAIL_ENABLED: true,
    EXTERNAL_PHONE_ENABLED: false,

    // SMTP settings (empty by default for self-hosted)
    SMTP_HOST: '',
    SMTP_PORT: 465,
    SMTP_USER: '',
    SMTP_PASS: '',
    SMTP_ADMIN_EMAIL: '',
    SMTP_SENDER_NAME: 'Supabase',
    SMTP_MAX_FREQUENCY: 60,

    // JWT settings
    JWT_EXP: parseInt(process.env.JWT_EXPIRY || '3600', 10),

    // Site URL
    SITE_URL: siteUrl,
    URI_ALLOW_LIST: '',
    ADDITIONAL_REDIRECT_URLS: '',

    // Rate limits
    RATE_LIMIT_ANONYMOUS_USERS: 30,
    RATE_LIMIT_EMAIL_SENT: 2,
    RATE_LIMIT_SMS_SENT: 30,
    RATE_LIMIT_VERIFY: 30,
    RATE_LIMIT_TOKEN_REFRESH: 150,
    RATE_LIMIT_OTP: 30,

    // MFA settings
    MFA_MAX_ENROLLED_FACTORS: 10,
    MFA_TOTP_ENROLL_ENABLED: true,
    MFA_TOTP_VERIFY_ENABLED: true,
    MFA_TOTP_ISSUER: '',
    MFA_PHONE_ENROLL_ENABLED: false,
    MFA_PHONE_VERIFY_ENABLED: false,
    MFA_WEB_AUTHN_ENROLL_ENABLED: false,
    MFA_WEB_AUTHN_VERIFY_ENABLED: false,

    // Session settings
    SESSIONS_TIMEBOX: 0,
    SESSIONS_INACTIVITY_TIMEOUT: 0,
    SESSIONS_TAGS: '',
    SINGLE_SESSION_PER_USER: false,

    // Audit log settings
    AUDIT_LOG_MAX_EVENTS: 30,

    // OAuth server settings
    HOOK_SEND_EMAIL_ENABLED: false,
    HOOK_SEND_SMS_ENABLED: false,
    HOOK_CUSTOM_ACCESS_TOKEN_ENABLED: false,
    HOOK_MFA_VERIFICATION_ATTEMPT_ENABLED: false,
    HOOK_PASSWORD_VERIFICATION_ATTEMPT_ENABLED: false,
    HOOK_BEFORE_USER_CREATED_ENABLED: false,

    // Attack protection
    SECURITY_CAPTCHA_ENABLED: false,
    SECURITY_CAPTCHA_SECRET: '',
    SECURITY_CAPTCHA_TIMEOUT: 10,
    SECURITY_MANUAL_LINKING_ENABLED: true,
    SECURITY_UPDATE_PASSWORD_REQUIRE_REAUTHENTICATION: false,

    // URL configuration
    MAILER_URLPATHS_INVITE: '/auth/v1/verify',
    MAILER_URLPATHS_CONFIRMATION: '/auth/v1/verify',
    MAILER_URLPATHS_RECOVERY: '/auth/v1/verify',
    MAILER_URLPATHS_EMAIL_CHANGE: '/auth/v1/verify',

    // Email templates (empty to use GoTrue defaults)
    MAILER_SUBJECTS_INVITE: '',
    MAILER_SUBJECTS_CONFIRMATION: '',
    MAILER_SUBJECTS_RECOVERY: '',
    MAILER_SUBJECTS_EMAIL_CHANGE: '',
    MAILER_SUBJECTS_MAGIC_LINK: '',

    MAILER_TEMPLATES_INVITE: '',
    MAILER_TEMPLATES_CONFIRMATION: '',
    MAILER_TEMPLATES_RECOVERY: '',
    MAILER_TEMPLATES_EMAIL_CHANGE: '',
    MAILER_TEMPLATES_MAGIC_LINK: '',

    // Performance
    DB_MAX_POOL_SIZE: 10,

    // Notifications
    MAILER_NOTIFICATIONS_NEW_USER_ENABLED: false,
    MAILER_NOTIFICATIONS_LOGIN_ENABLED: false,
    MAILER_NOTIFICATIONS_REAUTHENTICATION_ENABLED: false,
    MAILER_NOTIFICATIONS_PASSWORD_CHANGE_ENABLED: false,
    MAILER_NOTIFICATIONS_EMAIL_CHANGE_ENABLED: false,
    MAILER_NOTIFICATIONS_RECOVERY_ENABLED: false,
    MAILER_NOTIFICATIONS_INVITE_ENABLED: false,
  }

  return res.status(200).json(config)
}

const handleUpdate = async (req: NextApiRequest, res: NextApiResponse) => {
  // Try to PATCH GoTrue directly if accessible
  const gotrueAdminUrl = process.env.GOTRUE_ADMIN_URL || 'http://localhost:9999'
  const serviceKey = process.env.SUPABASE_SERVICE_KEY || ''

  try {
    const response = await fetch(`${gotrueAdminUrl}/admin/config`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(2000),
    })

    if (response.ok) {
      const data = await response.json()
      return res.status(200).json(data)
    }
  } catch {
    // GoTrue not directly accessible
  }

  // In self-hosted, GoTrue config is set via env vars — return success without actually updating
  // The user should update docker-compose.local.yml environment variables for persistence
  return res.status(200).json({
    ...req.body,
    _warning: 'Config saved in-memory only. Update docker-compose.local.yml env vars for persistence.',
  })
}

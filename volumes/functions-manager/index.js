/**
 * Supabase Edge Functions Manager
 * Uses ONLY Node.js built-in modules — zero npm dependencies needed.
 * Handles multipart/form-data manually.
 * Supports: deploy, list, delete functions + secrets CRUD
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = 8085;
const FUNCTIONS_DIR = process.env.EDGE_FUNCTIONS_DIR || '/app/functions';
const SECRETS_FILE = path.join(FUNCTIONS_DIR, '.secrets.json');
const SECRETS_ENV_FILE = path.join(FUNCTIONS_DIR, 'secrets.env');

// GoTrue admin API proxy
const GOTRUE_HOST = process.env.GOTRUE_HOST || 'supabase-auth';
const GOTRUE_PORT = parseInt(process.env.GOTRUE_PORT || '9999');
const SERVICE_ROLE_KEY = process.env.SERVICE_ROLE_KEY || '';

function httpRequest(method, host, port, path, body, extraHeaders) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : '';
    const opts = {
      hostname: host, port, path, method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
        'Content-Length': Buffer.byteLength(bodyStr),
        ...extraHeaders,
      },
    };
    const req = http.request(opts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const text = Buffer.concat(chunks).toString();
          resolve({ status: res.statusCode, data: text ? JSON.parse(text) : {} });
        } catch(e) {
          resolve({ status: res.statusCode, data: {} });
        }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// GoTrue config → env var mapping (for auto-apply on Studio PATCH)
// ---------------------------------------------------------------------------
const GOTRUE_ENV_FILE = path.join(FUNCTIONS_DIR, '.env.gotrue');

const CONFIG_TO_GOTRUE_ENV = {
  // Core
  site_url: 'GOTRUE_SITE_URL',
  uri_allow_list: 'GOTRUE_URI_ALLOW_LIST',
  disable_signup: 'GOTRUE_DISABLE_SIGNUP',
  jwt_exp: 'GOTRUE_JWT_EXP',
  // Email
  external_email_enabled: 'GOTRUE_EXTERNAL_EMAIL_ENABLED',
  mailer_autoconfirm: 'GOTRUE_MAILER_AUTOCONFIRM',
  mailer_secure_email_change_enabled: 'GOTRUE_MAILER_SECURE_EMAIL_CHANGE_ENABLED',
  mailer_otp_exp: 'GOTRUE_MAILER_OTP_EXP',
  rate_limit_email_sent: 'GOTRUE_RATE_LIMIT_EMAIL_SENT',
  // Phone / SMS
  external_phone_enabled: 'GOTRUE_EXTERNAL_PHONE_ENABLED',
  phone_autoconfirm: 'GOTRUE_SMS_AUTOCONFIRM',
  sms_otp_exp: 'GOTRUE_SMS_OTP_EXP',
  sms_otp_length: 'GOTRUE_SMS_OTP_LENGTH',
  rate_limit_sms_sent: 'GOTRUE_RATE_LIMIT_SMS_SENT',
  // SMTP
  smtp_admin_email: 'GOTRUE_SMTP_ADMIN_EMAIL',
  smtp_host: 'GOTRUE_SMTP_HOST',
  smtp_port: 'GOTRUE_SMTP_PORT',
  smtp_user: 'GOTRUE_SMTP_USER',
  smtp_pass: 'GOTRUE_SMTP_PASS',
  smtp_sender_name: 'GOTRUE_SMTP_SENDER_NAME',
  smtp_max_frequency: 'GOTRUE_SMTP_MAX_FREQUENCY',
  // Anonymous / manual linking
  external_anonymous_users_enabled: 'GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED',
  security_manual_linking_enabled: 'GOTRUE_SECURITY_MANUAL_LINKING_ENABLED',
  // Password
  password_min_length: 'GOTRUE_PASSWORD_MIN_LENGTH',
  // MFA
  mfa_totp_enroll_enabled: 'GOTRUE_MFA_TOTP_ENROLL_ENABLED',
  mfa_totp_verify_enabled: 'GOTRUE_MFA_TOTP_VERIFY_ENABLED',
  mfa_phone_enroll_enabled: 'GOTRUE_MFA_PHONE_ENROLL_ENABLED',
  mfa_phone_verify_enabled: 'GOTRUE_MFA_PHONE_VERIFY_ENABLED',
  mfa_max_enrolled_factors: 'GOTRUE_MFA_MAX_ENROLLED_FACTORS',
  // Sessions / rate limits
  sessions_timebox: 'GOTRUE_SESSIONS_TIMEBOX',
  sessions_inactivity_timeout: 'GOTRUE_SESSIONS_INACTIVITY_TIMEOUT',
  // OAuth providers
  external_google_enabled: 'GOTRUE_EXTERNAL_GOOGLE_ENABLED',
  external_google_client_id: 'GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID',
  external_google_secret: 'GOTRUE_EXTERNAL_GOOGLE_SECRET',
  external_apple_enabled: 'GOTRUE_EXTERNAL_APPLE_ENABLED',
  external_apple_client_id: 'GOTRUE_EXTERNAL_APPLE_CLIENT_ID',
  external_apple_secret: 'GOTRUE_EXTERNAL_APPLE_SECRET',
  external_github_enabled: 'GOTRUE_EXTERNAL_GITHUB_ENABLED',
  external_github_client_id: 'GOTRUE_EXTERNAL_GITHUB_CLIENT_ID',
  external_github_secret: 'GOTRUE_EXTERNAL_GITHUB_SECRET',
  external_discord_enabled: 'GOTRUE_EXTERNAL_DISCORD_ENABLED',
  external_discord_client_id: 'GOTRUE_EXTERNAL_DISCORD_CLIENT_ID',
  external_discord_secret: 'GOTRUE_EXTERNAL_DISCORD_SECRET',
  external_facebook_enabled: 'GOTRUE_EXTERNAL_FACEBOOK_ENABLED',
  external_facebook_client_id: 'GOTRUE_EXTERNAL_FACEBOOK_CLIENT_ID',
  external_facebook_secret: 'GOTRUE_EXTERNAL_FACEBOOK_SECRET',
  external_twitter_enabled: 'GOTRUE_EXTERNAL_TWITTER_ENABLED',
  external_twitter_client_id: 'GOTRUE_EXTERNAL_TWITTER_CLIENT_ID',
  external_twitter_secret: 'GOTRUE_EXTERNAL_TWITTER_SECRET',
  external_azure_enabled: 'GOTRUE_EXTERNAL_AZURE_ENABLED',
  external_azure_client_id: 'GOTRUE_EXTERNAL_AZURE_CLIENT_ID',
  external_azure_secret: 'GOTRUE_EXTERNAL_AZURE_SECRET',
  external_gitlab_enabled: 'GOTRUE_EXTERNAL_GITLAB_ENABLED',
  external_gitlab_client_id: 'GOTRUE_EXTERNAL_GITLAB_CLIENT_ID',
  external_gitlab_secret: 'GOTRUE_EXTERNAL_GITLAB_SECRET',
  external_bitbucket_enabled: 'GOTRUE_EXTERNAL_BITBUCKET_ENABLED',
  external_bitbucket_client_id: 'GOTRUE_EXTERNAL_BITBUCKET_CLIENT_ID',
  external_bitbucket_secret: 'GOTRUE_EXTERNAL_BITBUCKET_SECRET',
  external_linkedin_oidc_enabled: 'GOTRUE_EXTERNAL_LINKEDIN_OIDC_ENABLED',
  external_linkedin_oidc_client_id: 'GOTRUE_EXTERNAL_LINKEDIN_OIDC_CLIENT_ID',
  external_linkedin_oidc_secret: 'GOTRUE_EXTERNAL_LINKEDIN_OIDC_SECRET',
  external_notion_enabled: 'GOTRUE_EXTERNAL_NOTION_ENABLED',
  external_notion_client_id: 'GOTRUE_EXTERNAL_NOTION_CLIENT_ID',
  external_notion_secret: 'GOTRUE_EXTERNAL_NOTION_SECRET',
  external_slack_oidc_enabled: 'GOTRUE_EXTERNAL_SLACK_OIDC_ENABLED',
  external_slack_oidc_client_id: 'GOTRUE_EXTERNAL_SLACK_OIDC_CLIENT_ID',
  external_slack_oidc_secret: 'GOTRUE_EXTERNAL_SLACK_OIDC_SECRET',
  external_spotify_enabled: 'GOTRUE_EXTERNAL_SPOTIFY_ENABLED',
  external_spotify_client_id: 'GOTRUE_EXTERNAL_SPOTIFY_CLIENT_ID',
  external_spotify_secret: 'GOTRUE_EXTERNAL_SPOTIFY_SECRET',
  external_twitch_enabled: 'GOTRUE_EXTERNAL_TWITCH_ENABLED',
  external_twitch_client_id: 'GOTRUE_EXTERNAL_TWITCH_CLIENT_ID',
  external_twitch_secret: 'GOTRUE_EXTERNAL_TWITCH_SECRET',
  external_zoom_enabled: 'GOTRUE_EXTERNAL_ZOOM_ENABLED',
  external_zoom_client_id: 'GOTRUE_EXTERNAL_ZOOM_CLIENT_ID',
  external_zoom_secret: 'GOTRUE_EXTERNAL_ZOOM_SECRET',
};

function writeGoTrueEnvFile(overlay) {
  try {
    const lines = [
      '# GoTrue config override — auto-generated by functions-manager',
      '# Do not edit manually. Changes are overwritten when you save settings in Studio.',
      '',
    ];
    for (const [studioKey, envKey] of Object.entries(CONFIG_TO_GOTRUE_ENV)) {
      if (overlay[studioKey] !== undefined && overlay[studioKey] !== null && overlay[studioKey] !== '') {
        const val = typeof overlay[studioKey] === 'boolean'
          ? String(overlay[studioKey])
          : String(overlay[studioKey]);
        lines.push(`${envKey}=${val}`);
      }
    }
    fs.writeFileSync(GOTRUE_ENV_FILE, lines.join('\n') + '\n');
    console.log(`writeGoTrueEnvFile → wrote ${lines.length - 3} override(s) to .env.gotrue`);
  } catch (err) {
    console.error(`writeGoTrueEnvFile error: ${err.message}`);
  }
}

function dockerRestart(containerName) {
  return new Promise((resolve, reject) => {
    const opts = {
      socketPath: '/var/run/docker.sock',
      path: `/containers/${containerName}/restart?t=5`,
      method: 'POST',
      headers: { 'Content-Length': 0 },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end();
  });
}


function loadSecrets() {
  try {
    if (fs.existsSync(SECRETS_FILE)) {
      return JSON.parse(fs.readFileSync(SECRETS_FILE, 'utf8'));
    }
  } catch (e) { /* ignore */ }
  return {};
}

function saveSecrets(secrets) {
  fs.mkdirSync(FUNCTIONS_DIR, { recursive: true });
  fs.writeFileSync(SECRETS_FILE, JSON.stringify(secrets, null, 2));
  // Also write .env format for edge-runtime --env-file
  const envLines = Object.entries(secrets)
    .map(([k, v]) => `${k}=${String(v).replace(/\n/g, '\\n')}`)
    .join('\n');
  fs.writeFileSync(SECRETS_ENV_FILE, envLines ? envLines + '\n' : '');
  console.log('Updated secrets.env with', Object.keys(secrets).length, 'secret(s)');
}

// ---------------------------------------------------------------------------
// Function metadata helpers (.meta.json per function dir)
// ---------------------------------------------------------------------------
function loadMeta(slug) {
  try {
    const mp = path.join(FUNCTIONS_DIR, slug, '.meta.json');
    if (fs.existsSync(mp)) return JSON.parse(fs.readFileSync(mp, 'utf8'));
  } catch (e) { /* ignore */ }
  return {};
}

function saveMeta(slug, meta) {
  const mp = path.join(FUNCTIONS_DIR, slug, '.meta.json');
  fs.writeFileSync(mp, JSON.stringify(meta, null, 2));
}

// ---------------------------------------------------------------------------
// Multipart parser
// ---------------------------------------------------------------------------
function parseMultipart(boundary, body) {
  const result = { fields: {}, files: [] };
  const boundaryBuf = Buffer.from('--' + boundary);
  const parts = [];
  let start = 0;
  while (true) {
    const idx = body.indexOf(boundaryBuf, start);
    if (idx === -1) break;
    if (start > 0) parts.push(body.slice(start, idx - 2));
    start = idx + boundaryBuf.length + 2;
  }
  for (const part of parts) {
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;
    const headerStr = part.slice(0, headerEnd).toString();
    const bodyPart = part.slice(headerEnd + 4);
    const cdMatch = headerStr.match(/Content-Disposition:[^\r\n]*name="([^"]+)"/i);
    if (!cdMatch) continue;
    const name = cdMatch[1];
    const filenameMatch = headerStr.match(/filename="([^"]+)"/i);
    if (filenameMatch) {
      result.files.push({ fieldname: name, originalname: filenameMatch[1], buffer: bodyPart });
    } else {
      result.fields[name] = bodyPart.toString();
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// JSON body reader
// ---------------------------------------------------------------------------
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

// ---------------------------------------------------------------------------
// HTTP Server
// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const json = (status, obj) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };

  // Health check
  if (req.method === 'GET' && pathname === '/health') {
    return json(200, { status: 'ok' });
  }

  // -----------------------------------------------------------------------
  // PLATFORM AUTH CONFIG FILE (shared by /api/platform/ and /api/v1/ routes)
  // -----------------------------------------------------------------------
  const AUTH_CONFIG_FILE = path.join(FUNCTIONS_DIR, '.auth-config.json');

  function loadAuthConfigOverlay() {
    try {
      if (fs.existsSync(AUTH_CONFIG_FILE)) return JSON.parse(fs.readFileSync(AUTH_CONFIG_FILE, 'utf8'));
    } catch (e) { /* ignore */ }
    return {};
  }

  function getAuthConfig() {
    const e = process.env;
    const base = {
      site_url: e.SITE_URL || '',
      uri_allow_list: e.ADDITIONAL_REDIRECT_URLS || e.URI_ALLOW_LIST || '',
      disable_signup: e.DISABLE_SIGNUP === 'true',
      enable_signup: e.DISABLE_SIGNUP !== 'true',
      jwt_exp: parseInt(e.JWT_EXPIRY || e.JWT_EXP || '3600'),
      mailer_autoconfirm: e.ENABLE_EMAIL_AUTOCONFIRM === 'true',
      mailer_secure_email_change_enabled: e.MAILER_SECURE_EMAIL_CHANGE_ENABLED !== 'false',
      external_email_enabled: e.ENABLE_EMAIL_SIGNUP !== 'false',
      external_phone_enabled: e.ENABLE_PHONE_SIGNUP === 'true',
      phone_autoconfirm: e.ENABLE_PHONE_AUTOCONFIRM === 'true',
      smtp_admin_email: e.SMTP_ADMIN_EMAIL || '',
      smtp_host: e.SMTP_HOST || '',
      smtp_port: e.SMTP_PORT || '465',
      smtp_user: e.SMTP_USER || '',
      smtp_pass: e.SMTP_PASS || '',
      smtp_sender_name: e.SMTP_SENDER_NAME || '',
      smtp_max_frequency: parseInt(e.SMTP_MAX_FREQUENCY || '60'),
      rate_limit_email_sent: parseInt(e.RATE_LIMIT_EMAIL_SENT || '2'),
      rate_limit_sms_sent: parseInt(e.RATE_LIMIT_SMS_SENT || '30'),
      rate_limit_anonymous_users: parseInt(e.RATE_LIMIT_ANONYMOUS_USERS || '0'),
      rate_limit_token_refresh: parseInt(e.RATE_LIMIT_TOKEN_REFRESH || '150'),
      rate_limit_otp: parseInt(e.RATE_LIMIT_OTP || '30'),
      rate_limit_verify: parseInt(e.RATE_LIMIT_VERIFY || '30'),
      external_anonymous_users_enabled: e.ENABLE_ANONYMOUS_USERS === 'true',
      security_manual_linking_enabled: e.SECURITY_MANUAL_LINKING_ENABLED === 'true',
      password_min_length: parseInt(e.PASSWORD_MIN_LENGTH || '6'),
      password_required_characters: e.PASSWORD_REQUIRED_CHARACTERS || '',
      mailer_otp_exp: parseInt(e.MAILER_OTP_EXP || '3600'),
      sms_otp_exp: parseInt(e.SMS_OTP_EXP || '60'),
      sms_otp_length: parseInt(e.SMS_OTP_LENGTH || '6'),
      // Providers
      external_google_enabled: e.GOOGLE_ENABLED === 'true',
      external_google_client_id: (e.GOOGLE_CLIENT_ID || '').split(',')[0].trim(),
      external_google_secret: e.GOOGLE_SECRET || '',
      external_apple_enabled: e.APPLE_ENABLED === 'true',
      external_apple_client_id: e.APPLE_CLIENT_ID || '',
      external_apple_secret: e.APPLE_SECRET || '',
      external_github_enabled: e.GITHUB_ENABLED === 'true',
      external_github_client_id: e.GITHUB_CLIENT_ID || '',
      external_github_secret: e.GITHUB_SECRET || '',
      external_discord_enabled: e.DISCORD_ENABLED === 'true',
      external_discord_client_id: e.DISCORD_CLIENT_ID || '',
      external_discord_secret: e.DISCORD_SECRET || '',
      external_facebook_enabled: e.FACEBOOK_ENABLED === 'true',
      external_facebook_client_id: e.FACEBOOK_CLIENT_ID || '',
      external_facebook_secret: e.FACEBOOK_SECRET || '',
      external_twitter_enabled: e.TWITTER_ENABLED === 'true',
      external_twitter_client_id: e.TWITTER_CLIENT_ID || '',
      external_twitter_secret: e.TWITTER_SECRET || '',
      external_azure_enabled: e.AZURE_ENABLED === 'true',
      external_azure_client_id: e.AZURE_CLIENT_ID || '',
      external_azure_secret: e.AZURE_SECRET || '',
      external_gitlab_enabled: e.GITLAB_ENABLED === 'true',
      external_gitlab_client_id: e.GITLAB_CLIENT_ID || '',
      external_gitlab_secret: e.GITLAB_SECRET || '',
      external_bitbucket_enabled: e.BITBUCKET_ENABLED === 'true',
      external_bitbucket_client_id: e.BITBUCKET_CLIENT_ID || '',
      external_bitbucket_secret: e.BITBUCKET_SECRET || '',
      external_linkedin_oidc_enabled: e.LINKEDIN_ENABLED === 'true',
      external_linkedin_oidc_client_id: e.LINKEDIN_CLIENT_ID || '',
      external_linkedin_oidc_secret: e.LINKEDIN_SECRET || '',
      external_spotify_enabled: e.SPOTIFY_ENABLED === 'true',
      external_spotify_client_id: e.SPOTIFY_CLIENT_ID || '',
      external_spotify_secret: e.SPOTIFY_SECRET || '',
      external_slack_oidc_enabled: e.SLACK_ENABLED === 'true',
      external_slack_oidc_client_id: e.SLACK_CLIENT_ID || '',
      external_slack_oidc_secret: e.SLACK_SECRET || '',
      external_twitch_enabled: e.TWITCH_ENABLED === 'true',
      external_twitch_client_id: e.TWITCH_CLIENT_ID || '',
      external_twitch_secret: e.TWITCH_SECRET || '',
      // MFA
      mfa_totp_enroll_enabled: e.MFA_TOTP_ENROLL_ENABLED !== 'false',
      mfa_totp_verify_enabled: e.MFA_TOTP_VERIFY_ENABLED !== 'false',
      mfa_phone_enroll_enabled: e.MFA_PHONE_ENROLL_ENABLED === 'true',
      mfa_phone_verify_enabled: e.MFA_PHONE_VERIFY_ENABLED === 'true',
      mfa_max_enrolled_factors: parseInt(e.MFA_MAX_ENROLLED_FACTORS || '10'),
      // Sessions
      sessions_timebox: parseInt(e.SESSIONS_TIMEBOX || '0'),
      sessions_inactivity_timeout: parseInt(e.SESSIONS_INACTIVITY_TIMEOUT || '0'),
      sessions_single_per_user: e.SESSIONS_SINGLE_PER_USER === 'true',
      // Auth Hooks
      hooks: {
        custom_access_token: { enabled: e.HOOK_CUSTOM_ACCESS_TOKEN_ENABLED === 'true', uri: e.HOOK_CUSTOM_ACCESS_TOKEN_URI || '', secrets: '' },
        send_sms: { enabled: e.HOOK_SEND_SMS_ENABLED === 'true', uri: e.HOOK_SEND_SMS_URI || '', secrets: '' },
        send_email: { enabled: e.HOOK_SEND_EMAIL_ENABLED === 'true', uri: e.HOOK_SEND_EMAIL_URI || '', secrets: '' },
        mfa_verification_attempt: { enabled: e.HOOK_MFA_VERIFICATION_ATTEMPT_ENABLED === 'true', uri: e.HOOK_MFA_VERIFICATION_ATTEMPT_URI || '', secrets: '' },
        password_verification_attempt: { enabled: e.HOOK_PASSWORD_VERIFICATION_ATTEMPT_ENABLED === 'true', uri: e.HOOK_PASSWORD_VERIFICATION_ATTEMPT_URI || '', secrets: '' },
      },
    };
    return Object.assign({}, base, loadAuthConfigOverlay());
  }

  // -----------------------------------------------------------------------
  // PLATFORM API: /api/platform/* (Studio management API, intercepted at Kong)
  // -----------------------------------------------------------------------

  // Notifications - Studio polls for system notifications
  if (pathname === '/api/platform/notifications') {
    return json(200, []);
  }

  // Platform auth config: GET/PATCH /api/platform/auth/:ref/config
  const platformAuthConfigMatch = pathname.match(/^\/api\/platform\/auth\/([^/]+)\/config$/);
  if (platformAuthConfigMatch) {
    if (req.method === 'GET') {
      console.log('Platform auth config GET → env-based');
      return json(200, getAuthConfig());
    }
    if (req.method === 'PATCH' || req.method === 'PUT') {
      try {
        const body = await readBody(req);
        const updates = JSON.parse(body.toString());
        const overlay = loadAuthConfigOverlay();
        // Flatten hooks if provided
        if (updates.hooks) {
          Object.assign(overlay, { hooks: Object.assign({}, (overlay.hooks || {}), updates.hooks) });
          delete updates.hooks;
        }
        Object.assign(overlay, updates);
        fs.writeFileSync(AUTH_CONFIG_FILE, JSON.stringify(overlay, null, 2));
        console.log('Platform auth config PATCH → saved', Object.keys(updates).length, 'field(s)');

        // Write GoTrue env var override file so auth container picks up changes on restart
        writeGoTrueEnvFile(overlay);

        // Restart the auth container so it picks up the new .env.gotrue file
        const containerName = process.env.DOCKER_AUTH_CONTAINER || 'supabase-auth';
        dockerRestart(containerName)
          .then(status => console.log(`Docker restart ${containerName} → ${status}`))
          .catch(err => console.error(`Docker restart ${containerName} failed: ${err.message}`));

        return json(200, getAuthConfig());
      } catch (err) {
        return json(500, { error: err.message });
      }
    }
    return json(405, { error: 'Method not allowed' });
  }

  // Platform auth users: /api/platform/auth/:ref/users[/:id][/factors]
  const platformAuthUsersMatch = pathname.match(/^\/api\/platform\/auth\/([^/]+)\/users(\/[^/]+)?(\/factors)?$/);
  if (platformAuthUsersMatch) {
    const userId = (platformAuthUsersMatch[2] || '').replace('/', '');
    const isFactors = !!platformAuthUsersMatch[3];
    const goPath = userId ? `/admin/users/${userId}${isFactors ? '/factors' : ''}` : '/admin/users';
    try {
      const qs = url.search || '';
      const body = req.method !== 'GET' && req.method !== 'DELETE' ? await readBody(req) : null;
      const bodyObj = body && body.length ? JSON.parse(body.toString()) : null;
      const r = await httpRequest(req.method, GOTRUE_HOST, GOTRUE_PORT, goPath + qs, bodyObj);
      console.log(`Platform auth users ${req.method} ${goPath} → GoTrue: ${r.status}`);
      return json(r.status, r.data);
    } catch (err) {
      return json(502, { error: err.message });
    }
  }

  // Platform auth audit logs: /api/platform/auth/:ref/audit_log_events
  const platformAuditMatch = pathname.match(/^\/api\/platform\/auth\/([^/]+)\/audit_log_events$/);
  if (platformAuditMatch) {
    try {
      const qs = url.search || '';
      const r = await httpRequest('GET', GOTRUE_HOST, GOTRUE_PORT, '/admin/audit' + qs);
      return json(r.status < 400 ? 200 : r.status, r.data);
    } catch (err) {
      return json(200, { total: 0, result: [] });
    }
  }

  // Platform projects / API keys: /api/v1/projects/:ref/api-keys
  const apiKeysMatch = pathname.match(/^\/api\/v1\/projects\/([^/]+)\/api-keys$/);
  if (apiKeysMatch) {
    return json(200, [
      { name: 'anon', api_key: process.env.ANON_KEY || '', tags: 'anon' },
      { name: 'service_role', api_key: SERVICE_ROLE_KEY, tags: 'service_role', is_secret: true },
    ]);
  }

  // Branches: GET /api/v1/projects/:ref/branches
  const branchesMatch = pathname.match(/^\/api\/v1\/projects\/([^/]+)\/branches\/?$/);
  if (branchesMatch) {
    return json(200, []);
  }

  // Project health: GET /api/v1/projects/:ref/health
  const healthMatch = pathname.match(/^\/api\/v1\/projects\/([^/]+)\/health\/?$/);
  if (healthMatch) {
    // Return healthy status for all requested services
    const services = ['auth', 'realtime', 'rest', 'storage', 'db'];
    return json(200, services.map(name => ({ name, healthy: true })));
  }


  // -------------------------------------------------------------------------
  // RESOURCE WARNINGS: /api/platform/projects-resource-warnings
  // Must be before the /api/platform/projects catch-all!
  // -------------------------------------------------------------------------
  if (pathname.startsWith('/api/platform/projects-resource-warnings')) {
    return json(200, []);
  }

  // -------------------------------------------------------------------------
  // NOTIFICATIONS: /api/platform/notifications
  // -------------------------------------------------------------------------
  if (pathname.startsWith('/api/platform/notifications')) {
    // The Studio uses useInfiniteQuery on notifications.
    // getNextPageParam does (a ?? []).length — if response is object {data:[]} not array,
    // then (object ?? []) returns the object, and object.length = undefined → crashes.
    // Must return a plain array of notifications (empty = no notifications to show).
    if (req.method === 'GET') return json(200, []);
    return json(200, {});
  }


  // -------------------------------------------------------------------------
  // ADVISORS: /api/platform/projects/:ref/advisors / run-lints / performance
  // These are non-project platform routes that use startsWith match
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // CONTENT (SQL snippets, observability reports): /api/platform/projects/:ref/content
  // The observability page accesses m?.content.filter() — m must have a .content array
  // The SQL editor also uses this endpoint for saved queries
  // -------------------------------------------------------------------------
  if (pathname.match(/^\/api\/platform\/projects\/([^/]+)\/content/)) {
    if (req.method === 'GET') {
      return json(200, { content: [], type: 'folder', id: 'root', name: 'root' });
    }
    // POST — create a new snippet
    return json(200, { id: Date.now().toString(), content: [], type: 'folder' });
  }

  if (pathname === '/api/platform/profile') {
    return json(200, { id: 'default', primary_email: 'admin@localhost', username: 'admin', free_project_limit: 2, is_admin: true });
  }

  // Storage config endpoint — includes all fields Studio needs (list_v2, s3, etc.)
  const storageConfigMatch = pathname.match(/^\/api\/platform\/projects\/([^/]+)\/config\/storage$/);
  if (storageConfigMatch) {
    return json(200, {
      features: {
        vectorBuckets: { enabled: false },
        imageTransformation: { enabled: true },
      },
      fileSizeLimit: 52428800,
      storageS3Enabled: false,
      // S3-compatible storage settings
      s3Protocol: {
        enabled: false,
        acl_enabled: false,
        default_acl: 'private',
        list_v2: true,   // ← This prevents storage/files/settings crash
      },
    });
  }

  // Storage S3 access keys — /api/platform/storage/:ref/s3-access-keys
  if (pathname.match(/^\/api\/platform\/storage\/[^/]+\/s3-access-keys/)) {
    return json(200, []);
  }

  // Storage S3 config — /api/platform/storage/:ref/config
  // NOTE: this is different from /api/platform/projects/:ref/config/storage
  if (pathname.match(/^\/api\/platform\/storage\/[^/]+\/(config|s3-config)/)) {
    return json(200, { s3: { enabled: false }, features: { list_v2: true }, fileSizeLimit: 52428800 });
  }

  // Vector buckets endpoint — returns empty list to avoid crash
  const vectorBucketsMatch = pathname.match(/^\/api\/platform\/storage\/([^/]+)\/vector-buckets$/);
  if (vectorBucketsMatch) {
    return json(200, { vectorBuckets: [] });
  }

  // GoTrue session endpoints — prevent 404 from triggering redirect loop
  if (pathname.match(/^\/api\/platform\/gotrue\/session\/?$/) || pathname.match(/^\/api\/platform\/gotrue\/token\/?$/)) {
    const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIiwiZW1haWwiOiJhZG1pbkBsb2NhbGhvc3QiLCJyb2xlIjoiYXV0aGVudGljYXRlZCIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzcyMjMzMjAwLCJleHAiOjE5Mjk5OTk2MDB9.placeholder';
    return json(200, {
      access_token: token,
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(Date.now()/1000) + 3600,
      refresh_token: 'local-refresh-token',
      user: {
        id: '00000000-0000-0000-0000-000000000001',
        email: 'admin@localhost',
        role: 'authenticated',
        aud: 'authenticated',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        user_metadata: {},
        app_metadata: { provider: 'email', providers: ['email'] },
      }
    });
  }

  // /api/v1/projects — list all projects  
  if (pathname === '/api/v1/projects' || pathname === '/api/v1/projects/') {
    return json(200, [{
      id: 'default', name: 'Default Project', ref: 'default', status: 'ACTIVE_HEALTHY',
      region: 'local', organization_id: 'default-org', cloud_provider: 'none',
      inserted_at: '2024-01-01T00:00:00Z'
    }]);
  }

  // Platform organizations: entitlements endpoint — unlocks plan-gated features like Auth Hooks

  if (pathname.match(/^\/api\/platform\/organizations\/[^/]+\/entitlements$/)) {
    return json(200, {
      entitlements: [
        {
          feature: { key: 'auth.hooks' },
          hasAccess: true,
          type: 'set',
          config: {
            set: [
              'HOOK_SEND_SMS',
              'HOOK_SEND_EMAIL',
              'HOOK_CUSTOM_ACCESS_TOKEN',
              'HOOK_MFA_VERIFICATION_ATTEMPT',
              'HOOK_PASSWORD_VERIFICATION_ATTEMPT',
              'HOOK_BEFORE_USER_CREATED',
            ],
          },
        },
        { feature: { key: 'auth.user_sessions' }, hasAccess: true, type: 'bool' },
        { feature: { key: 'project_scoped_roles' }, hasAccess: true, type: 'bool' },
      ],
    });
  }

  // Platform organizations: subscription/billing endpoints
  if (pathname.match(/^\/api\/platform\/organizations\/[^/]+\/(billing\/)?subscription$/)) {
    return json(200, {
      plan: { id: 'team', name: 'Team' },
      tier: { key: 'team', name: 'Team' },
      billing_cycle_anchor: null,
      current_period_end: null,
      status: 'active',
      addons: [],
    });
  }

  // Platform organizations list
  if (pathname.startsWith('/api/platform/organizations')) {
    return json(200, [{
      id: 'default-org',
      name: 'Default Organization',
      slug: 'default-org-slug',
      billing_email: 'admin@localhost',
      members: [],
      plan: { id: 'team', name: 'Team' },
      subscription_id: null,
      stripe_customer_id: null,
      opted_into_beta: false,
      notification_id: null,
      restriction_status: null,
      restriction_data: {},
      is_owner: true,
      is_member: true,
    }]);
  }

  // Platform projects
  const projectsSettingsMatch = pathname.match(/^\/api\/platform\/projects\/([^/]+)\/settings$/);
  if (projectsSettingsMatch) {
    const ref = projectsSettingsMatch[1];
    return json(200, {
      project: { id: ref, name: 'Default Project', ref, status: 'ACTIVE_HEALTHY', region: 'local' },
      db: { host: process.env.POSTGRES_HOST || 'localhost', port: parseInt(process.env.POSTGRES_PORT || '54327'), name: process.env.POSTGRES_DB || 'postgres', version: '15' },
      anon_key: process.env.ANON_KEY || '',
      service_key: process.env.SERVICE_ROLE_KEY || '',
      supabase_url: process.env.SUPABASE_PUBLIC_URL || 'http://localhost:8000',
      endpoint: process.env.SUPABASE_PUBLIC_URL || 'http://localhost:8000',
    });
  }
  if (pathname.match(/^\/api\/(platform|v1)\/projects\/([^/]+)$/)) {
    const base = process.env.SUPABASE_PUBLIC_URL || 'http://localhost:8000';
    return json(200, {
      id: 'default', name: 'Default Project', ref: 'default',
      status: 'ACTIVE_HEALTHY', region: 'local',
      organization_id: 'default-org', cloud_provider: 'none',
      db_host: process.env.POSTGRES_HOST || 'db',
      db_port: parseInt(process.env.POSTGRES_PORT || '5432'),
      db_name: process.env.POSTGRES_DB || 'postgres',
      db_user: 'supabase_admin',
      inserted_at: '2024-01-01T00:00:00Z',
      subscription_tier: 'TEAM',
      kps_enabled: false,
      anon_key: process.env.ANON_KEY || '',
      service_key: process.env.SERVICE_ROLE_KEY || '',
      supabase_url: base,
      endpoint: base,
      authUrl: `${base}/auth/v1`,
      restUrl: `${base}/rest/v1`,
      realtimeUrl: `${base}/realtime/v1`,
      storageUrl: `${base}/storage/v1`,
    });
  }
  // Temporary API key for OAuth Apps and other pages that need a client key
  const tmpApiKeyMatch = pathname.match(/^\/api\/platform\/projects\/([^/]+)\/api-keys\/temporary$/);
  if (tmpApiKeyMatch) {
    return json(200, {
      api_key: SERVICE_ROLE_KEY,
      name: 'temporary_service_role',
      tags: 'service_role',
      key: SERVICE_ROLE_KEY,
      endpoint: process.env.SUPABASE_PUBLIC_URL || 'http://localhost:8000',
    });
  }

  // -------------------------------------------------------------------------
  // DATABASES: GET /api/platform/projects/:ref/databases
  // -------------------------------------------------------------------------
  if (pathname.match(/^\/api\/platform\/projects\/([^/]+)\/databases\/?$/)) {
    const base = process.env.SUPABASE_PUBLIC_URL || 'http://localhost:8000';
    return json(200, [{
      identifier: 'default',
      status: 'ACTIVE_HEALTHY',
      region: 'local',
      db_host: process.env.POSTGRES_HOST || 'db',
      db_port: parseInt(process.env.POSTGRES_PORT || '5432'),
      db_name: process.env.POSTGRES_DB || 'postgres',
      db_user: 'supabase_admin',
      inserted_at: '2024-01-01T00:00:00Z',
      size: { memory_bytes: 1073741824, cpu_cores: 2, disk_volume_size_gb: 8, disk_iops: 250 },
      supabase_url: base,
    }]);
  }

  // -------------------------------------------------------------------------
  // SERVICE VERSIONS: GET /api/platform/projects/:ref/service-versions
  // -------------------------------------------------------------------------
  if (pathname.match(/^\/api\/platform\/projects\/([^/]+)\/service-versions\/?$/)) {
    return json(200, [
      { name: 'supabase-studio', version: 'latest' },
      { name: 'postgrest', version: '12.2.0' },
      { name: 'gotrue', version: '2.162.0' },
      { name: 'realtime', version: '2.33.70' },
      { name: 'storage', version: '1.11.14' },
      { name: 'pg-meta', version: '0.83.0' },
      { name: 'edge-runtime', version: '1.62.2' },
      { name: 'analytics', version: '1.4.0' },
    ]);
  }

  // -------------------------------------------------------------------------
  // BILLING / ADDONS: GET /api/platform/projects/:ref/billing/addons
  // -------------------------------------------------------------------------
  if (pathname.match(/^\/api\/(platform|v1)\/projects\/([^/]+)\/(billing\/addons|addons)\/?$/)) {
    return json(200, { selected_addons: [], available_addons: [] });
  }

  // Billing credit balance / invoices 
  if (pathname.match(/^\/api\/(platform|v1)\/projects\/([^/]+)\/billing\/.+$/)) {
    return json(200, []);
  }


  if (pathname.match(/^\/api\/platform\/projects\/([^/]+)\/infra-monitoring/)) {
    return json(200, {
      data: [],
    });
  }

  // -------------------------------------------------------------------------
  // REPLICATION: /api/platform/replication/:ref/...
  // -------------------------------------------------------------------------
  const replicationMatch = pathname.match(/^\/api\/platform\/replication\/([^/]+)\/(destinations|pipelines|sources)\/?$/);
  if (replicationMatch) {
    const type = replicationMatch[2]; // destinations, pipelines, or sources
    return json(200, {
      [type]: []
    });
  }

  // -------------------------------------------------------------------------
  // BACKUPS: GET /api/platform/projects/:ref/backups
  // -------------------------------------------------------------------------
  if (pathname.match(/^\/api\/platform\/projects\/([^/]+)\/backups$/)) {
    return json(200, {
      backups: [],
      pitr_enabled: false,
      physical_backups_enabled: false,
      walg_enabled: false,
      earliestPhysicalBackupDateUnix: null,
    });
  }

  // -------------------------------------------------------------------------
  // READ REPLICAS: GET /api/platform/projects/:ref/read-replicas
  // -------------------------------------------------------------------------
  if (pathname.match(/^\/api\/platform\/projects\/([^/]+)\/read-replicas/)) {
    return json(200, []);
  }

  // -------------------------------------------------------------------------
  // LOG DRAINS: GET/POST/PATCH/DELETE /api/platform/projects/:ref/log-drains
  // -------------------------------------------------------------------------
  const logDrainsMatch = pathname.match(/^\/api\/platform\/projects\/([^/]+)\/log-drains(\/(\d+))?$/);
  if (logDrainsMatch) {
    const LOG_DRAINS_FILE = path.join(FUNCTIONS_DIR, '.log-drains.json');
    const loadDrains = () => { try { return JSON.parse(fs.readFileSync(LOG_DRAINS_FILE, 'utf8')); } catch { return []; } };
    const saveDrains = (d) => fs.writeFileSync(LOG_DRAINS_FILE, JSON.stringify(d, null, 2));
    const drainId = logDrainsMatch[3];
    if (req.method === 'GET') return json(200, loadDrains());
    if (req.method === 'POST') {
      try {
        const body = JSON.parse((await readBody(req)).toString());
        const drains = loadDrains();
        const newDrain = { id: Date.now(), ...body, status: 'active', created_at: new Date().toISOString() };
        drains.push(newDrain);
        saveDrains(drains);
        return json(201, newDrain);
      } catch (err) { return json(500, { error: err.message }); }
    }
    if ((req.method === 'PATCH' || req.method === 'PUT') && drainId) {
      try {
        const body = JSON.parse((await readBody(req)).toString());
        const drains = loadDrains();
        const idx = drains.findIndex(d => String(d.id) === drainId);
        if (idx >= 0) { Object.assign(drains[idx], body); saveDrains(drains); return json(200, drains[idx]); }
        return json(404, { error: 'Not found' });
      } catch (err) { return json(500, { error: err.message }); }
    }
    if (req.method === 'DELETE' && drainId) {
      const drains = loadDrains().filter(d => String(d.id) !== drainId);
      saveDrains(drains);
      return json(200, {});
    }
    return json(200, loadDrains());
  }

  // -------------------------------------------------------------------------
  // BRANCHES: GET /api/platform/projects/:ref/branches
  // -------------------------------------------------------------------------
  if (pathname.match(/^\/api\/platform\/projects\/([^/]+)\/branches/)) {
    return json(200, []);
  }

  // -------------------------------------------------------------------------
  // OBSERVABILITY / METRICS
  // -------------------------------------------------------------------------
  if (pathname.match(/^\/api\/platform\/projects\/([^/]+)\/(observability|metrics)/)) {
    return json(200, []);
  }


  // -------------------------------------------------------------------------
  // PG UPGRADES: /api/platform/projects/:ref/pg-upgrades
  // -------------------------------------------------------------------------
  if (pathname.match(/^\/api\/platform\/projects\/([^/]+)\/pg-upgrades/)) {
    return json(200, { current_app_version: 'supabase-postgres-15.1.0.191', eligible: false, potential_breaking_changes: [] });
  }

  // -------------------------------------------------------------------------
  // INTEGRATIONS: /api/platform/projects/:ref/integrations
  // -------------------------------------------------------------------------
  if (pathname.match(/^\/api\/platform\/projects\/([^/]+)\/integrations/)) {
    return json(200, []);
  }

  // -------------------------------------------------------------------------
  // CUSTOM HOSTNAMES & SSL:
  // -------------------------------------------------------------------------
  if (pathname.match(/^\/api\/platform\/projects\/([^/]+)\/(custom-hostname|ssl-enforcement)/)) {
    return json(200, { customHostname: null, status: 'not_started', ssl: { enabled: false } });
  }

  // -------------------------------------------------------------------------
  // NETWORK RESTRICTIONS:
  // -------------------------------------------------------------------------
  if (pathname.match(/^\/api\/platform\/projects\/([^/]+)\/network\b/)) {
    return json(200, { entitlement: 'allowed', config: { dbAllowedCidrs: [], dbAllowedCidrsV6: [] }, status: 'applied' });
  }

  // -------------------------------------------------------------------------
  // COMPUTE / DISK: settings/compute-and-disk
  // -------------------------------------------------------------------------
  if (pathname.match(/^\/api\/platform\/projects\/([^/]+)\/compute/)) {
    return json(200, {
      size: 'nano', instance_type: 'postgres', primary_ram_gb: 1, primary_cpu: 2,
      addons: [], available_disk_sizes_gb: [8, 16, 32, 64, 128],
      disk: { size_gb: 8, disk_io_budget: 1000, throughput_mb_s: 125, iops: 3000, type: 'gp3' },
    });
  }

  // -------------------------------------------------------------------------
  // DATABASE DISK: /api/platform/database/:ref/disk
  // -------------------------------------------------------------------------
  if (pathname.match(/^\/api\/platform\/database\/[^/]+\/disk/)) {
    return json(200, {
      size_gb: 8, type: 'gp3', iops: 3000, throughput_mb_s: 125,
      disk_io_budget: 1000, disk_io_budget_used: 0
    });
  }

  // -------------------------------------------------------------------------
  // JWT SECRETS / SETTINGS:
  // -------------------------------------------------------------------------
  if (pathname.match(/^\/api\/platform\/projects\/([^/]+)\/(config\/jwt|jwt)/) 
      || (pathname.match(/^\/api\/platform\/projects\/([^/]+)\/settings$/) && url.searchParams.has('jwt'))) {
    const jwt_secret = process.env.JWT_SECRET || 'super-secret-jwt-token-with-at-least-32-characters-long';
    return json(200, { jwt_secret, jwt_exp: 3600, anon_key: process.env.ANON_KEY || '' });
  }

  // Catch unknown project sub-routes (run-lints, advisors, etc.) — return safe empty array
  if (pathname.match(/^\/api\/platform\/projects\/([^/]+)\/.+$/)) {
    console.log(`Platform projects sub-path stub: ${pathname}`);
    return json(200, []);
  }
  if (pathname.startsWith('/api/platform/projects')) {
    return json(200, [{ id: 'default', name: 'Default Project', ref: 'default', status: 'ACTIVE_HEALTHY', region: 'local', organization_id: 'default-org', cloud_provider: 'none' }]);
  }

  // -------------------------------------------------------------------------
  // STORAGE PLATFORM API: /api/platform/storage/:ref/* → proxy to local storage
  // The Studio in IS_PLATFORM mode calls /api/platform/storage/:ref/buckets
  // instead of /storage/v1/bucket directly
  // -------------------------------------------------------------------------
  const storagePlatformMatch = pathname.match(/^\/api\/platform\/storage\/([^/]+)(\/.*)?$/);
  if (storagePlatformMatch) {
    const storagePath = storagePlatformMatch[2] || '/';
    const STORAGE_HOST = process.env.KONG_HOST || 'kong';
    const STORAGE_PORT = 8000;
    // Map /api/platform/storage/:ref/buckets → /storage/v1/bucket
    let mappedPath = storagePath;
    let mappedQuery = url.search || '';
    if (storagePath === '/buckets' || storagePath.startsWith('/buckets?') || storagePath === '/buckets/') {
      mappedPath = '/storage/v1/bucket';
      mappedQuery = ''; // Strip unsupported params (sortColumn, sortOrder, etc.)
    } else if (storagePath.match(/^\/buckets\/[^/]+$/)) {
      mappedPath = '/storage/v1/bucket/' + storagePath.split('/')[2];
      mappedQuery = '';
    } else if (storagePath === '/vector-buckets') {
      return json(200, { vectorBuckets: [] });
    } else {
      mappedPath = '/storage/v1' + storagePath;
    }
    try {
      const body = (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH' || req.method === 'DELETE') ? await readBody(req) : null;
      const bodyObj = body && body.length ? JSON.parse(body.toString()) : null;
      const storageHeaders = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
        'apikey': SERVICE_ROLE_KEY,
      };
      const r = await httpRequest(req.method, STORAGE_HOST, STORAGE_PORT, mappedPath + mappedQuery, bodyObj, storageHeaders);
      console.log(`storage-proxy ${req.method} ${storagePath} → ${mappedPath} → ${r.status}`);
      return json(r.status, r.data);
    } catch (err) {
      console.error(`storage-proxy error: ${err.message}`);
      return json(200, []); // Return empty rather than error to avoid spinning
    }
  }


  // -------------------------------------------------------------------------
  // DATABASE PLATFORM API: /api/platform/database/:ref/* → mock responses
  // -------------------------------------------------------------------------
  const databasePlatformMatch = pathname.match(/^\/api\/platform\/database\/([^/]+)(\/.*)?$/);
  if (databasePlatformMatch) {
    const dbPath = databasePlatformMatch[2] || '/';
    if (dbPath.startsWith('/backups')) {
      return json(200, { backups: [], pitr_enabled: false, physical_backups_enabled: false, walg_enabled: false });
    }
    if (dbPath.startsWith('/network-restrictions')) {
      if (req.method === 'GET') return json(200, { entitlement: 'disallowed', status: 'stored', config: { dbAllowedCidrs: [] } });
      return json(200, {});
    }
    if (dbPath.startsWith('/pooling-config')) {
      return json(200, { db_port: 5432, default_pool_size: 15, max_client_conn: 200, pool_mode: 'transaction', ignore_startup_parameters: 'extra_float_digits', pgbouncer_enabled: true });
    }
    console.log(`Database platform stub: ${pathname}`);
    return json(200, {});
  }

  // -------------------------------------------------------------------------
  // AUTH PLATFORM API: /api/platform/auth/:ref/* → proxy to GoTrue admin API
  // -------------------------------------------------------------------------
  const authPlatformMatch = pathname.match(/^\/api\/platform\/auth\/([^/]+)(\/.*)?$/);
  if (authPlatformMatch) {
    const authPath = authPlatformMatch[2] || '/';
    if (authPath === '/config' || authPath === '/') {
      if (req.method === 'GET') {
        const cfg = getAuthConfig();
        return json(200, cfg);
      }
      if (req.method === 'PATCH' || req.method === 'PUT') {
        try {
          const body = await readBody(req);
          const updates = JSON.parse(body.toString());
          const overlay = loadAuthConfigOverlay();
          Object.assign(overlay, updates);
          fs.writeFileSync(AUTH_CONFIG_FILE, JSON.stringify(overlay, null, 2));
          return json(200, getAuthConfig());
        } catch (err) { return json(500, { error: err.message }); }
      }
    }
    console.log(`Auth platform stub: ${pathname}`);
    return json(200, {});
  }

  // -------------------------------------------------------------------------
  // INTEGRATIONS PLATFORM: /api/platform/integrations/* → return empty/disabled
  // -------------------------------------------------------------------------
  if (pathname.startsWith('/api/platform/integrations')) {
    return json(200, { authorized: false, installations: [], connections: [] });
  }

  // -------------------------------------------------------------------------
  // CATCH-ALL: /api/platform/* → return safe empty response
  // -------------------------------------------------------------------------
  if (pathname.startsWith('/api/platform/')) {
    console.log(`Platform API catch-all stub: ${pathname}`);
    // CRITICAL: certain endpoints MUST return [] (not {}) because the Studio does (data??[]).slice():
    // - pg-meta paths (query-performance, etc.)
    // - any path ending with known list suffixes
    const mustBeArray = pathname.includes('/pg-meta/') || 
                        pathname.includes('/query-performance') ||
                        pathname.includes('/list') || 
                        pathname.endsWith('s') ||
                        pathname.includes('/run-lints') ||
                        pathname.includes('/lints');
    return json(200, mustBeArray ? [] : {});
  }




  // -----------------------------------------------------------------------
  // PG-META QUERY PERFORMANCE: must return [] not {}
  // The Studio advisor panel does (k??[]).slice(0,5) on this data.
  // If pg-meta returns {} (no pg_stat_statements), the crash occurs.
  // -----------------------------------------------------------------------
  if (pathname.match(/^\/api\/platform\/pg-meta\/[^/]+\/query-performance/)) {
    // Proxy to pg-meta first, if it fails or returns non-array, return []
    try {
      const PG_META_HOST = process.env.PG_META_HOST || 'meta';
      const PG_META_PORT = parseInt(process.env.PG_META_PORT || '8080');
      const pgPath = pathname.replace(/^\/api\/platform\/pg-meta\/[^/]+/, '');
      const pgUrl = `http://${PG_META_HOST}:${PG_META_PORT}${pgPath}${url.search || ''}`;
      const dbPass = process.env.POSTGRES_PASSWORD || 'your-super-secret-and-long-postgres-password';
      const pgRes = await fetch(pgUrl, {
        headers: {
          'Content-Type': 'application/json',
          'x-connection-encrypted': 'false',
          'x-pg-meta-db-host': 'db',
          'x-pg-meta-db-port': '5432',
          'x-pg-meta-db-name': 'postgres',
          'x-pg-meta-db-user': 'supabase_admin',
          'x-pg-meta-db-password': dbPass,
        }
      });
      const data = await pgRes.json();
      // Ensure we always return an array (pg-meta may return {} if no data)
      return json(200, Array.isArray(data) ? data : []);
    } catch(e) {
      return json(200, []);
    }
  }

  // -----------------------------------------------------------------------
  // PLATFORM PG-META PROXY: /api/platform/pg-meta/:ref/*
  // Studio runs raw SQL via pg-meta for the auth users page listing
  // -----------------------------------------------------------------------
  const pgMetaMatch = pathname.match(/^\/api\/platform\/pg-meta\/([^/]+)(\/.*)?$/);
  if (pgMetaMatch) {

    const pgMetaPath = pgMetaMatch[2] || '/';
    const PG_META_HOST = process.env.PG_META_HOST || 'meta';
    const PG_META_PORT = parseInt(process.env.PG_META_PORT || '8080');
    try {
      const qs = url.search || '';
      const body = (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') ? await readBody(req) : null;
      const bodyObj = body && body.length ? (body.toString().trim().startsWith('{') ? JSON.parse(body.toString()) : body.toString()) : null;
      // pg-meta needs the DB connection info as headers
      const dbHeaders = {
        'x-connection-encrypted': '',
        'Content-Type': 'application/json',
      };
      const r = await httpRequest(req.method, PG_META_HOST, PG_META_PORT, pgMetaPath + qs, bodyObj, dbHeaders);
      console.log(`pg-meta ${req.method} ${pgMetaPath} → ${r.status}`);
      return json(r.status, r.data);
    } catch (err) {
      console.error(`pg-meta proxy error: ${err.message}`);
      return json(502, { error: err.message });
    }
  }

  // -------------------------------------------------------------------------
  // AUTH CONFIG: /api/v1/projects/:ref/config/auth[/*] (legacy path for Kong)
  // -------------------------------------------------------------------------
  const authConfigMatch = pathname.match(/^\/api\/v1\/projects\/([^/]+)\/config\/auth(\/.*)?$/);
  if (authConfigMatch) {
    const sub = authConfigMatch[2] || '';
    if (sub.startsWith('/hooks')) {
      if (req.method === 'GET') return json(200, []);
      return json(200, {});
    } else if (sub.startsWith('/third-party') || sub.startsWith('/providers')) {
      if (req.method === 'GET') return json(200, []);
      return json(200, {});
    } else {
      // Main auth config
      if (req.method === 'GET') {
        const cfg = getAuthConfig();
        console.log('Auth config GET → env-based config');
        return json(200, cfg);
      }
      if (req.method === 'PATCH' || req.method === 'PUT') {
        try {
          const body = await readBody(req);
          const updates = JSON.parse(body.toString());
          const overlay = loadAuthConfigOverlay();
          const merged = Object.assign({}, overlay, updates);
          fs.writeFileSync(AUTH_CONFIG_FILE, JSON.stringify(merged, null, 2));
          console.log(`Auth config PATCH → saved ${Object.keys(updates).length} field(s)`);
          return json(200, getAuthConfig());
        } catch (err) {
          return json(500, { error: err.message });
        }
      }
      return json(200, getAuthConfig());
    }
  }

  // -----------------------------------------------------------------------
  // EMAIL TEMPLATES: /api/v1/projects/:ref/config/email-template/:type
  // -----------------------------------------------------------------------
  const emailTemplateMatch = pathname.match(/^\/api\/v1\/projects\/([^/]+)\/config\/email-template\/([^/]+)$/);
  if (emailTemplateMatch) {
    const templateType = emailTemplateMatch[2];
    const templateFile = path.join(FUNCTIONS_DIR, `.email-template-${templateType}.json`);
    if (req.method === 'GET') {
      try {
        if (fs.existsSync(templateFile)) return json(200, JSON.parse(fs.readFileSync(templateFile, 'utf8')));
      } catch(e) { /* ignore */ }
      return json(200, { subject: '', content: '' });
    }
    if (req.method === 'PATCH' || req.method === 'PUT') {
      try {
        const body = await readBody(req);
        fs.writeFileSync(templateFile, body.toString());
        return json(200, JSON.parse(body.toString()));
      } catch (err) {
        return json(500, { error: err.message });
      }
    }
    return json(200, {});
  }

  // -----------------------------------------------------------------------
  // AUTH USERS: /api/v1/projects/:ref/auth/users[/:id]
  // -----------------------------------------------------------------------
  const authUsersBase = pathname.match(/^\/api\/v1\/projects\/([^/]+)\/auth\/users$/);
  const authUsersItem = pathname.match(/^\/api\/v1\/projects\/([^/]+)\/auth\/users\/([^/]+)$/);
  if (authUsersBase || authUsersItem) {
    try {
      const body = (req.method !== 'GET' && req.method !== 'DELETE') ? await readBody(req) : null;
      const bodyObj = body && body.length ? JSON.parse(body.toString()) : null;
      const userId = authUsersItem ? authUsersItem[2] : null;
      const gotrueUrl = userId ? `/admin/users/${userId}` : `/admin/users`;
      const r = await httpRequest(req.method, GOTRUE_HOST, GOTRUE_PORT, gotrueUrl, bodyObj);
      return json(r.status < 400 ? r.status : r.status, r.data);
    } catch (err) {
      return json(502, { error: 'Auth service unavailable', message: err.message });
    }
  }

  // -----------------------------------------------------------------------
  // SECRETS: GET /api/v1/projects/:ref/secrets
  // -----------------------------------------------------------------------
  const secretsBase = pathname.match(/^\/api\/v1\/projects\/([^/]+)\/secrets$/);
  const secretsItem = pathname.match(/^\/api\/v1\/projects\/([^/]+)\/secrets\/([^/]+)$/);

  if (secretsBase && req.method === 'GET') {
    const secrets = loadSecrets();
    // Return array of {name, value:'[masked]'} — mask values like cloud Supabase
    const list = Object.keys(secrets).map(name => ({ name, value: '***' }));
    return json(200, list);
  }

  if (secretsBase && req.method === 'DELETE') {
    // Bulk delete: accepts ["KEY",...] strings OR [{name:"KEY"},...] objects
    try {
      const body = await readBody(req);
      const data = JSON.parse(body.toString());
      const secrets = loadSecrets();
      const entries = Array.isArray(data) ? data : [data];
      for (const item of entries) {
        const name = typeof item === 'string' ? item : item?.name;
        if (name) delete secrets[name];
      }
      saveSecrets(secrets);
      console.log(`Bulk deleted ${entries.length} secret(s)`);
      return json(200, []);
    } catch (err) {
      return json(500, { error: err.message });
    }
  }

  if (secretsBase && (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH')) {
    // Accepts: [{name, value}, ...] or {name, value}
    try {
      const body = await readBody(req);
      const data = JSON.parse(body.toString());
      const secrets = loadSecrets();
      const entries = Array.isArray(data) ? data : [data];
      for (const { name, value } of entries) {
        if (name) secrets[name] = value || '';
      }
      saveSecrets(secrets);
      console.log(`Saved ${entries.length} secret(s)`);
      return json(200, entries.map(e => ({ name: e.name, value: '***' })));
    } catch (err) {
      return json(500, { error: err.message });
    }
  }


  if (secretsItem && req.method === 'DELETE') {
    const secretName = decodeURIComponent(secretsItem[2]);
    const secrets = loadSecrets();
    delete secrets[secretName];
    saveSecrets(secrets);
    console.log(`Deleted secret: ${secretName}`);
    return json(200, { name: secretName });
  }

  // -----------------------------------------------------------------------
  // FUNCTIONS: GET /api/v1/projects/:ref/functions  (list)
  // -----------------------------------------------------------------------
  const functionsBase = pathname.match(/^\/api\/v1\/projects\/([^/]+)\/functions$/);
  if (functionsBase && req.method === 'GET') {
    try {
      const entries = [];
      if (fs.existsSync(FUNCTIONS_DIR)) {
        for (const name of fs.readdirSync(FUNCTIONS_DIR)) {
          const full = path.join(FUNCTIONS_DIR, name);
          if (fs.statSync(full).isDirectory()) {
            const meta = loadMeta(name);
          entries.push({
              id: crypto.createHash('md5').update(name).digest('hex'),
              slug: name, name: meta.name || name,
              status: 'ACTIVE',
              verify_jwt: meta.verify_jwt !== false,
              created_at: fs.statSync(full).ctimeMs,
              updated_at: fs.statSync(full).mtimeMs,
            });
          }
        }
      }
      return json(200, entries);
    } catch (err) {
      return json(500, { error: err.message });
    }
  }

  // -----------------------------------------------------------------------
  // FUNCTIONS: POST /api/v1/projects/:ref/functions(/deploy)?  (deploy)
  // -----------------------------------------------------------------------
  const deployMatch = pathname.match(/^\/api\/v1\/projects\/([^/]+)\/functions(\/deploy)?$/);
  if (req.method === 'POST' && deployMatch) {
    const ref = deployMatch[1];
    const slug = url.searchParams.get('slug') || url.searchParams.get('name');

    if (!slug) return json(400, { error: 'Missing slug query parameter' });

    const body = await readBody(req);
    const contentType = req.headers['content-type'] || '';
    let files = [];
    let metadata = {};

    const boundaryMatch = contentType.match(/boundary=(.+)/i);
    if (boundaryMatch) {
      const parsed = parseMultipart(boundaryMatch[1].trim(), body);
      files = parsed.files;
      if (parsed.fields.metadata) {
        try { metadata = JSON.parse(parsed.fields.metadata); } catch (e) {}
      }
    }

    if (files.length === 0) return json(400, { error: 'No files uploaded' });

    try {
      const functionDir = path.join(FUNCTIONS_DIR, slug);
      fs.mkdirSync(functionDir, { recursive: true });
      for (const file of files) {
        fs.writeFileSync(path.join(functionDir, file.originalname), file.buffer);
        console.log(`Saved: ${path.join(functionDir, file.originalname)}`);
      }
      const response = {
        id: crypto.randomUUID(),
        slug, name: slug, version: 1,
        status: 'ACTIVE',
        created_at: Date.now(), updated_at: Date.now(),
        entrypoint_path: metadata.entrypoint_path || 'file:///src/index.ts',
        import_map_path: metadata.import_map_path || null,
        verify_jwt: metadata.verify_jwt !== false,
      };
      console.log(`Deployed function: ${slug} (ref: ${ref})`);
      return json(200, response);
    } catch (err) {
      console.error('Deployment error:', err);
      return json(500, { error: err.message });
    }
  }

  // -----------------------------------------------------------------------
  // FUNCTIONS: GET/DELETE /api/v1/projects/:ref/functions/:slug
  //   also handles /functions/:slug/stats  /functions/:slug/invocations  /functions/:slug/logs
  // -----------------------------------------------------------------------
  const functionItem = pathname.match(/^\/api\/v1\/projects\/([^/]+)\/functions\/([^/]+?)(\/[a-z]+)?$/);
  if (functionItem) {
    const slug = functionItem[2];
    const sub = functionItem[3]; // e.g. '/stats' '/invocations' '/logs'

    if (req.method === 'DELETE' && !sub) {
      const functionDir = path.join(FUNCTIONS_DIR, slug);
      try {
        if (fs.existsSync(functionDir)) fs.rmSync(functionDir, { recursive: true });
        return json(200, { slug });
      } catch (err) {
        return json(500, { error: err.message });
      }
    }

    // GET /functions/:slug/stats - for Overview tab
    if (req.method === 'GET' && sub === '/stats') {
      return json(200, {
        total_invocations: 0,
        execution_time_p50: 0,
        execution_time_p90: 0,
        execution_time_p99: 0,
        error_rate: 0,
        cpu_time_p50: 0,
        cpu_time_p90: 0,
        cpu_time_p99: 0,
      });
    }

    // GET /functions/:slug/body - for Code tab (returns multipart with source files)
    if (req.method === 'GET' && sub === '/body') {
      const functionDir = path.join(FUNCTIONS_DIR, slug);
      if (!fs.existsSync(functionDir)) return json(404, { error: 'Function not found' });

      const boundary = '----SupabaseFMBoundary' + crypto.randomBytes(8).toString('hex');
      const allFiles = fs.readdirSync(functionDir).filter(f => {
        const fp = path.join(functionDir, f);
        return !f.startsWith('.') && fs.statSync(fp).isFile();
      });

      const metadataObj = {
        entrypoint_path: `file:///home/deno/functions/${slug}/index.ts`,
        import_map_path: null,
        version: 1,
      };

      let multipart = '';
      multipart += `--${boundary}\r\n`;
      multipart += `Content-Disposition: form-data; name="metadata"\r\n`;
      multipart += `Content-Type: application/json\r\n\r\n`;
      multipart += JSON.stringify(metadataObj) + '\r\n';

      for (const file of allFiles) {
        const content = fs.readFileSync(path.join(functionDir, file), 'utf8');
        multipart += `--${boundary}\r\n`;
        multipart += `Content-Disposition: form-data; name="file"; filename="${file}"\r\n`;
        multipart += `Content-Type: text/plain\r\n\r\n`;
        multipart += content + '\r\n';
      }
      multipart += `--${boundary}--\r\n`;

      res.writeHead(200, { 'Content-Type': `multipart/form-data; boundary=${boundary}` });
      res.end(multipart);
      return;
    }

    // PUT /functions/:slug/body - save edited code (Studio code editor save)
    if ((req.method === 'PUT' || req.method === 'POST') && sub === '/body') {
      const functionDir = path.join(FUNCTIONS_DIR, slug);
      if (!fs.existsSync(functionDir)) return json(404, { error: 'Function not found' });
      try {
        const body = await readBody(req);
        const contentType = req.headers['content-type'] || '';
        const boundaryMatch = contentType.match(/boundary=(.+)/i);
        if (boundaryMatch) {
          const parsed = parseMultipart(boundaryMatch[1].trim(), body);
          for (const file of parsed.files) {
            fs.writeFileSync(path.join(functionDir, file.originalname), file.buffer);
            console.log(`Updated: ${path.join(functionDir, file.originalname)}`);
          }
        }
        console.log(`Code updated for function: ${slug}`);
        return json(200, {
          id: crypto.createHash('md5').update(slug).digest('hex'),
          slug, name: loadMeta(slug).name || slug,
          status: 'ACTIVE',
          updated_at: Date.now(),
        });
      } catch (err) {
        return json(500, { error: err.message });
      }
    }

    // GET /functions/:slug/invocations - for Invocations tab
    if (req.method === 'GET' && sub === '/invocations') {
      return json(200, {
        data: [],
        count: 0,
      });
    }

    // PATCH / PUT /functions/:slug - update function settings (verify_jwt, name etc.)
    if ((req.method === 'PATCH' || req.method === 'PUT') && !sub) {
      try {
        const body = await readBody(req);
        const updates = JSON.parse(body.toString());
        const meta = loadMeta(slug);
        Object.assign(meta, updates);
        saveMeta(slug, meta);
        const functionDir = path.join(FUNCTIONS_DIR, slug);
        return json(200, {
          id: crypto.createHash('md5').update(slug).digest('hex'),
          slug, name: meta.name || slug,
          status: 'ACTIVE',
          verify_jwt: meta.verify_jwt !== false,
          created_at: fs.statSync(functionDir).ctimeMs,
          updated_at: Date.now(),
          entrypoint_path: meta.entrypoint_path || 'file:///src/index.ts',
          import_map_path: meta.import_map_path || null,
        });
      } catch (err) {
        return json(500, { error: err.message });
      }
    }

    // GET /functions/:slug - get single function details
    if (req.method === 'GET' && !sub) {
      const functionDir = path.join(FUNCTIONS_DIR, slug);
      if (!fs.existsSync(functionDir)) return json(404, { error: 'Function not found' });
      const meta = loadMeta(slug);
      return json(200, {
        id: crypto.createHash('md5').update(slug).digest('hex'),
        slug, name: meta.name || slug,
        status: 'ACTIVE',
        verify_jwt: meta.verify_jwt !== false,
        created_at: fs.statSync(functionDir).ctimeMs,
        updated_at: fs.statSync(functionDir).mtimeMs,
        entrypoint_path: meta.entrypoint_path || 'file:///src/index.ts',
        import_map_path: meta.import_map_path || null,
      });
    }
  }

  return json(404, { error: 'Not found' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Edge Functions Manager listening on port ${PORT}`);
  console.log(`Functions directory: ${FUNCTIONS_DIR}`);
  console.log(`Secrets file: ${SECRETS_FILE}`);
});

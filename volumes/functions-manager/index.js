/**
 * Supabase Edge Functions Manager
 * Uses ONLY Node.js built-in modules — zero npm dependencies.
 * Handles: edge functions CRUD, secrets CRUD, SQL snippets, minimal Platform API stubs.
 */

'use strict';

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const PORT          = 8085;
const FUNCTIONS_DIR = process.env.EDGE_FUNCTIONS_DIR || '/app/functions';
const SECRETS_FILE  = path.join(FUNCTIONS_DIR, '.secrets.json');
const SECRETS_ENV   = path.join(FUNCTIONS_DIR, 'secrets.env');
const SNIPPETS_FILE = path.join(FUNCTIONS_DIR, '.snippets.json');

// GoTrue proxy
const GOTRUE_HOST       = process.env.GOTRUE_HOST || 'supabase-auth';
const GOTRUE_PORT       = parseInt(process.env.GOTRUE_PORT || '9999', 10);
const SERVICE_ROLE_KEY  = process.env.SERVICE_ROLE_KEY || '';
const ANON_KEY          = process.env.ANON_KEY || '';
const JWT_SECRET        = process.env.JWT_SECRET || 'super-secret-jwt-token-with-at-least-32-characters-long';

// pg-meta proxy
const PG_META_HOST = process.env.PG_META_HOST || 'meta';
const PG_META_PORT = parseInt(process.env.PG_META_PORT || '8080', 10);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

function httpRequest(method, host, port, urlPath, body, extraHeaders) {
  return new Promise((resolve, reject) => {
    const bodyStr = body
      ? (typeof body === 'string' ? body : JSON.stringify(body))
      : '';
    const opts = {
      hostname: host, port, path: urlPath, method,
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
        } catch { resolve({ status: res.statusCode, data: {} }); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Multipart parser (for function deploy)
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
    const bodyPart  = part.slice(headerEnd + 4);
    const cdMatch   = headerStr.match(/Content-Disposition:[^\r\n]*name="([^"]+)"/i);
    if (!cdMatch) continue;
    const name         = cdMatch[1];
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
// Secrets
// ---------------------------------------------------------------------------
function loadSecrets() {
  try {
    if (fs.existsSync(SECRETS_FILE)) return JSON.parse(fs.readFileSync(SECRETS_FILE, 'utf8'));
  } catch { /* ignore */ }
  return {};
}

function saveSecrets(secrets) {
  fs.mkdirSync(FUNCTIONS_DIR, { recursive: true });
  fs.writeFileSync(SECRETS_FILE, JSON.stringify(secrets, null, 2));
  const envLines = Object.entries(secrets)
    .map(([k, v]) => `${k}=${String(v).replace(/\n/g, '\\n')}`)
    .join('\n');
  fs.writeFileSync(SECRETS_ENV, envLines ? envLines + '\n' : '');
}

// ---------------------------------------------------------------------------
// SQL Snippets (content)
// ---------------------------------------------------------------------------
function loadSnippets() {
  try {
    if (fs.existsSync(SNIPPETS_FILE)) return JSON.parse(fs.readFileSync(SNIPPETS_FILE, 'utf8'));
  } catch { /* ignore */ }
  return [];
}

function saveSnippets(snippets) {
  fs.mkdirSync(FUNCTIONS_DIR, { recursive: true });
  fs.writeFileSync(SNIPPETS_FILE, JSON.stringify(snippets, null, 2));
}

// ---------------------------------------------------------------------------
// Function metadata (.meta.json)
// ---------------------------------------------------------------------------
function loadMeta(slug) {
  try {
    const mp = path.join(FUNCTIONS_DIR, slug, '.meta.json');
    if (fs.existsSync(mp)) return JSON.parse(fs.readFileSync(mp, 'utf8'));
  } catch { /* ignore */ }
  return {};
}

function saveMeta(slug, meta) {
  const mp = path.join(FUNCTIONS_DIR, slug, '.meta.json');
  fs.writeFileSync(mp, JSON.stringify(meta, null, 2));
}

// ---------------------------------------------------------------------------
// Auth config (read from env — read-only stubs, no env-file writing)
// ---------------------------------------------------------------------------
function getAuthConfig() {
  const e = process.env;
  return {
    site_url: e.SITE_URL || e.SUPABASE_PUBLIC_URL || 'http://localhost:8000',
    uri_allow_list: e.ADDITIONAL_REDIRECT_URLS || '',
    disable_signup: e.DISABLE_SIGNUP === 'true',
    jwt_exp: parseInt(e.JWT_EXPIRY || '3600', 10),
    external_email_enabled: true,
    mailer_autoconfirm: e.ENABLE_EMAIL_AUTOCONFIRM === 'true',
    mailer_secure_email_change_enabled: true,
    external_phone_enabled: e.ENABLE_PHONE_SIGNUP === 'true',
    phone_autoconfirm: e.ENABLE_PHONE_AUTOCONFIRM === 'true',
    external_anonymous_users_enabled: e.ENABLE_ANONYMOUS_USERS === 'true',
    password_min_length: parseInt(e.PASSWORD_MIN_LENGTH || '6', 10),
    mfa_totp_enroll_enabled: true,
    mfa_totp_verify_enabled: true,
    mfa_phone_enroll_enabled: false,
    mfa_phone_verify_enabled: false,
    mfa_max_enrolled_factors: 10,
    sessions_timebox: 0,
    sessions_inactivity_timeout: 0,
    sessions_single_per_user: false,
    hook: {
      custom_access_token:         { enabled: false, uri: '', secrets: '' },
      send_sms:                    { enabled: false, uri: '', secrets: '' },
      send_email:                  { enabled: false, uri: '', secrets: '' },
      mfa_verification_attempt:    { enabled: false, uri: '', secrets: '' },
      password_verification_attempt: { enabled: false, uri: '', secrets: '' },
    },
  };
}

// ---------------------------------------------------------------------------
// HTTP Server
// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const url      = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const json = (status, obj) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };

  try {

    // -----------------------------------------------------------------------
    // Health
    // -----------------------------------------------------------------------
    if (req.method === 'GET' && pathname === '/health') {
      return json(200, { status: 'ok' });
    }

    // -----------------------------------------------------------------------
    // CONTENT (SQL snippets): /api/platform/projects/:ref/content[/...]
    //
    // Exact formats from Supabase Studio source (apps/studio/data/content/):
    //
    //   GET /content?type=sql&limit=100&sort_by=inserted_at&sort_order=desc&visibility=user
    //     → { data: [...SqlSnippet], cursor: string|null }
    //     (content-infinite-query.ts: returns { cursor: data.cursor, contents: data.data })
    //
    //   GET /content/folders?type=sql&limit=100&sort_by=&visibility=user
    //     → { data: { folders: [...], contents: [...SqlSnippet] }, cursor: string|null }
    //     (sql-folders-query.ts: returns { ...data.data, cursor: data.cursor })
    //
    //   GET /content/count?type=sql
    //     → { count: number }  (content-count-query.ts)
    //
    //   GET /content/item/:id
    //     → snippet object directly (content-id-query.ts)
    //
    //   POST /content  → create snippet → { data: snippet }
    //   PATCH/PUT /content/item/:id → update → snippet
    //   DELETE /content/item/:id → {}
    // -----------------------------------------------------------------------
    const contentMatch = pathname.match(/^\/api\/platform\/projects\/([^/]+)\/content(\/(.+))?$/);
    if (contentMatch) {
      const subPath = contentMatch[2] || '';

      // GET /content/count?type=sql → { count: N }
      if (req.method === 'GET' && subPath === '/count') {
        const snippets = loadSnippets();
        const type = url.searchParams.get('type');
        const count = type ? snippets.filter(s => s.type === type).length : snippets.length;
        return json(200, { count });
      }

      // GET /content/folders?type=sql&visibility=user
      // Returns paginated folder+snippets structure:
      // { data: { folders: [], contents: [...snippets] }, cursor: null }
      if (req.method === 'GET' && subPath === '/folders') {
        const snippets = loadSnippets();
        const type = url.searchParams.get('type');
        const filtered = type ? snippets.filter(s => s.type === type) : snippets;
        return json(200, {
          data: { folders: [], contents: filtered },
          cursor: null,
        });
      }

      const itemMatch = subPath.match(/^\/item\/(.+)$/);
      if (itemMatch) {
        const id = itemMatch[1];
        if (req.method === 'GET') {
          const snippets = loadSnippets();
          const snip = snippets.find(s => String(s.id) === id);
          if (!snip) return json(404, { error: 'Not found' });
          return json(200, snip);
        }
        if (req.method === 'PATCH' || req.method === 'PUT') {
          try {
            const body = JSON.parse((await readBody(req)).toString());
            const snippets = loadSnippets();
            const idx = snippets.findIndex(s => String(s.id) === id);
            if (idx >= 0) {
              snippets[idx] = { ...snippets[idx], ...body, updated_at: new Date().toISOString() };
              saveSnippets(snippets);
              return json(200, snippets[idx]);
            }
            return json(404, { error: 'Not found' });
          } catch (err) { return json(500, { error: err.message }); }
        }
        if (req.method === 'DELETE') {
          const snippets = loadSnippets().filter(s => String(s.id) !== id);
          saveSnippets(snippets);
          return json(200, {});
        }
      }

      // GET /content?type=sql&limit=100&sort_by=inserted_at&sort_order=desc&visibility=user
      // Returns paginated snippets: { data: [...SqlSnippet], cursor: null }
      if (req.method === 'GET') {
        const snippets = loadSnippets();
        const type = url.searchParams.get('type');
        const filtered = type ? snippets.filter(s => s.type === type) : snippets;
        return json(200, {
          data: filtered,
          cursor: null,
        });
      }

      // POST /content → create snippet
      if (req.method === 'POST') {
        try {
          const body = JSON.parse((await readBody(req)).toString());
          const snippets = loadSnippets();
          const snip = {
            id:          crypto.randomUUID(),
            type:        body.type || 'sql',
            name:        body.name || 'Untitled Query',
            description: body.description || '',
            content:     body.content || { sql: '' },
            visibility:  body.visibility || 'user',
            owner_id:    'default',
            inserted_at: new Date().toISOString(),
            updated_at:  new Date().toISOString(),
          };
          snippets.push(snip);
          saveSnippets(snippets);
          return json(200, snip);
        } catch (err) { return json(500, { error: err.message }); }
      }

      return json(200, { id: 'root', name: 'root', type: 'folder', content: [] });
    }

    // -----------------------------------------------------------------------
    // Profile
    // -----------------------------------------------------------------------
    if (pathname === '/api/platform/profile') {
      return json(200, {
        id: 'default', primary_email: 'admin@localhost', username: 'admin',
        free_project_limit: 2, is_admin: true,
      });
    }

    // -----------------------------------------------------------------------
    // Auth config: /api/platform/auth/:ref/config
    // -----------------------------------------------------------------------
    const platAuthConfigMatch = pathname.match(/^\/api\/platform\/auth\/([^/]+)\/config$/);
    if (platAuthConfigMatch) {
      if (req.method === 'GET') return json(200, getAuthConfig());
      if (req.method === 'PATCH' || req.method === 'PUT') return json(200, getAuthConfig());
    }

    // Auth users: /api/platform/auth/:ref/users
    const platAuthUsersMatch = pathname.match(/^\/api\/platform\/auth\/([^/]+)\/users(\/[^/]+)?/);
    if (platAuthUsersMatch) {
      try {
        const body = (req.method !== 'GET' && req.method !== 'DELETE') ? await readBody(req) : null;
        const bodyObj = body && body.length ? JSON.parse(body.toString()) : null;
        const userId = platAuthUsersMatch[2] ? platAuthUsersMatch[2].replace('/', '') : null;
        const gotrueUrl = userId ? `/admin/users/${userId}` : '/admin/users';
        const r = await httpRequest(req.method, GOTRUE_HOST, GOTRUE_PORT, gotrueUrl, bodyObj);
        return json(r.status, r.data);
      } catch { return json(200, req.method === 'GET' ? { users: [], total: 0 } : {}); }
    }

    // -----------------------------------------------------------------------
    // Auth config: /api/v1/projects/:ref/config/auth
    // -----------------------------------------------------------------------
    const authConfigV1 = pathname.match(/^\/api\/v1\/projects\/([^/]+)\/config\/auth(\/.*)?$/);
    if (authConfigV1) {
      const sub = authConfigV1[2] || '';
      if (sub.startsWith('/hooks') || sub.startsWith('/third-party') || sub.startsWith('/providers')) {
        return json(200, req.method === 'GET' ? [] : {});
      }
      if (req.method === 'GET') return json(200, getAuthConfig());
      if (req.method === 'PATCH' || req.method === 'PUT') return json(200, getAuthConfig());
      return json(200, getAuthConfig());
    }

    // -----------------------------------------------------------------------
    // Projects list: /api/v1/projects or /api/platform/projects
    // -----------------------------------------------------------------------
    const defaultProject = {
      id: 'default', ref: 'default', name: 'Default Project',
      status: 'ACTIVE_HEALTHY', region: 'local',
      organization_id: 'default-org', cloud_provider: 'none',
      inserted_at: '2024-01-01T00:00:00Z',
    };

    if (pathname === '/api/v1/projects' || pathname === '/api/v1/projects/') {
      return json(200, [defaultProject]);
    }

    if (pathname === '/api/platform/projects' || pathname === '/api/platform/projects/') {
      return json(200, [defaultProject]);
    }

    // -----------------------------------------------------------------------
    // Single project: /api/v1/projects/:ref or /api/platform/projects/:ref
    // -----------------------------------------------------------------------
    if (pathname.match(/^\/api\/(platform|v1)\/projects\/([^/]+)$/)) {
      return json(200, { ...defaultProject, name: 'Default Project', db_host: 'db', db_port: 5432 });
    }

    // -----------------------------------------------------------------------
    // Project settings: /api/platform/projects/:ref/settings
    // -----------------------------------------------------------------------
    const settingsMatch = pathname.match(/^\/api\/platform\/projects\/([^/]+)\/settings$/);
    if (settingsMatch) {
      return json(200, {
        ...defaultProject,
        db_host: 'db', db_port: 5432, db_name: 'postgres', db_user: 'postgres',
        anon_key: ANON_KEY, service_role_key: SERVICE_ROLE_KEY, jwt_secret: JWT_SECRET,
      });
    }

    // -----------------------------------------------------------------------
    // API keys: /api/platform/projects/:ref/api-keys
    // -----------------------------------------------------------------------
    const apiKeysMatch = pathname.match(/^\/api\/platform\/projects\/([^/]+)\/api-keys$/);
    if (apiKeysMatch) {
      return json(200, [
        { name: 'anon', api_key: ANON_KEY },
        { name: 'service_role', api_key: SERVICE_ROLE_KEY },
      ]);
    }

    // API keys v1
    const apiKeysV1 = pathname.match(/^\/api\/v1\/projects\/([^/]+)\/api-keys$/);
    if (apiKeysV1) {
      return json(200, [
        { name: 'anon', api_key: ANON_KEY },
        { name: 'service_role', api_key: SERVICE_ROLE_KEY },
      ]);
    }

    // -----------------------------------------------------------------------
    // Health endpoint: /api/v1/projects/:ref/health
    // -----------------------------------------------------------------------
    const healthMatch = pathname.match(/^\/api\/v1\/projects\/([^/]+)\/health\/?$/);
    if (healthMatch) {
      return json(200, [
        { name: 'gotrue',    healthy: true, status: 'HEALTHY' },
        { name: 'postgrest', healthy: true, status: 'HEALTHY' },
        { name: 'realtime',  healthy: true, status: 'HEALTHY' },
        { name: 'storage',   healthy: true, status: 'HEALTHY' },
      ]);
    }

    // -----------------------------------------------------------------------
    // Organizations
    // -----------------------------------------------------------------------
    if (pathname.startsWith('/api/platform/organizations')) {
      if (pathname.match(/\/entitlements$/)) {
        return json(200, {
          entitlements: [
            { feature: { key: 'auth.hooks' }, hasAccess: true, type: 'set',
              config: { set: ['HOOK_SEND_SMS','HOOK_SEND_EMAIL','HOOK_CUSTOM_ACCESS_TOKEN','HOOK_MFA_VERIFICATION_ATTEMPT','HOOK_PASSWORD_VERIFICATION_ATTEMPT','HOOK_BEFORE_USER_CREATED'] } },
            { feature: { key: 'auth.user_sessions' }, hasAccess: true, type: 'bool' },
            { feature: { key: 'project_scoped_roles' }, hasAccess: true, type: 'bool' },
          ],
        });
      }
      if (pathname.match(/\/(billing\/)?subscription$/)) {
        return json(200, {
          plan: { id: 'team', name: 'Team' },
          tier: { key: 'team', name: 'Team' },
          addons: [], usage_billing_enabled: false,
          billing_via_partner: false, partner_managed: false,
        });
      }
      return json(200, [{ id: 'default-org', name: 'Default Organization', slug: 'default', plan: { id: 'team', name: 'Team' } }]);
    }

    // -----------------------------------------------------------------------
    // Notifications
    // -----------------------------------------------------------------------
    if (pathname.startsWith('/api/platform/notifications')) {
      return json(200, req.method === 'GET' ? [] : {});
    }

    // -----------------------------------------------------------------------
    // Storage config: /api/platform/projects/:ref/config/storage
    // -----------------------------------------------------------------------
    const storageConfigMatch = pathname.match(/^\/api\/platform\/projects\/([^/]+)\/config\/storage$/);
    if (storageConfigMatch) {
      return json(200, {
        features: { vectorBuckets: { enabled: false }, imageTransformation: { enabled: true } },
        fileSizeLimit: 52428800,
        storageS3Enabled: false,
        s3Protocol: { enabled: false, acl_enabled: false, default_acl: 'private', list_v2: true },
      });
    }

    // Storage platform proxy: /api/platform/storage/:ref/*
    const storagePlatformMatch = pathname.match(/^\/api\/platform\/storage\/([^/]+)(\/.*)?$/);
    if (storagePlatformMatch) {
      const storagePath = storagePlatformMatch[2] || '/';
      if (storagePath === '/vector-buckets') return json(200, { vectorBuckets: [] });
      if (storagePath.match(/\/(config|s3-config|s3-access-keys)/)) return json(200, []);
      // Proxy to Kong storage
      try {
        const KONG_HOST = process.env.KONG_HOST || 'kong';
        let mappedPath = '/storage/v1' + storagePath;
        if (storagePath === '/buckets' || storagePath.startsWith('/buckets/')) {
          mappedPath = '/storage/v1' + storagePath.replace('/buckets', '/bucket');
        }
        const body = ['POST','PUT','PATCH','DELETE'].includes(req.method) ? await readBody(req) : null;
        const bodyObj = body && body.length ? JSON.parse(body.toString()) : null;
        const r = await httpRequest(req.method, KONG_HOST, 8000, mappedPath, bodyObj, {
          'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
          'apikey': SERVICE_ROLE_KEY,
        });
        return json(r.status, r.data);
      } catch { return json(200, req.method === 'GET' ? (storagePath === '/buckets' ? [] : {}) : {}); }
    }

    // -----------------------------------------------------------------------
    // Secrets: /api/v1/projects/:ref/secrets
    // -----------------------------------------------------------------------
    const secretsBase = pathname.match(/^\/api\/v1\/projects\/([^/]+)\/secrets$/);
    const secretsItem = pathname.match(/^\/api\/v1\/projects\/([^/]+)\/secrets\/([^/]+)$/);

    if (secretsBase) {
      if (req.method === 'GET') {
        const secrets = loadSecrets();
        return json(200, Object.keys(secrets).map(name => ({ name, value: '***' })));
      }
      if (req.method === 'DELETE') {
        try {
          const data = JSON.parse((await readBody(req)).toString());
          const secrets = loadSecrets();
          const entries = Array.isArray(data) ? data : [data];
          for (const item of entries) {
            const name = typeof item === 'string' ? item : item?.name;
            if (name) delete secrets[name];
          }
          saveSecrets(secrets);
          return json(200, []);
        } catch (err) { return json(500, { error: err.message }); }
      }
      if (['POST','PUT','PATCH'].includes(req.method)) {
        try {
          const data = JSON.parse((await readBody(req)).toString());
          const secrets = loadSecrets();
          const entries = Array.isArray(data) ? data : [data];
          for (const { name, value } of entries) {
            if (name) secrets[name] = value || '';
          }
          saveSecrets(secrets);
          return json(200, entries.map(e => ({ name: e.name, value: '***' })));
        } catch (err) { return json(500, { error: err.message }); }
      }
    }

    if (secretsItem && req.method === 'DELETE') {
      const name = decodeURIComponent(secretsItem[2]);
      const secrets = loadSecrets();
      delete secrets[name];
      saveSecrets(secrets);
      return json(200, { name });
    }

    // -----------------------------------------------------------------------
    // Functions list: GET /api/v1/projects/:ref/functions
    // -----------------------------------------------------------------------
    const functionsBase = pathname.match(/^\/api\/v1\/projects\/([^/]+)\/functions$/);
    if (functionsBase && req.method === 'GET') {
      try {
        const entries = [];
        if (fs.existsSync(FUNCTIONS_DIR)) {
          for (const name of fs.readdirSync(FUNCTIONS_DIR)) {
            const full = path.join(FUNCTIONS_DIR, name);
            if (fs.statSync(full).isDirectory() && !name.startsWith('.')) {
              const meta = loadMeta(name);
              entries.push({
                id: crypto.createHash('md5').update(name).digest('hex'),
                slug: name, name: meta.name || name,
                status: 'ACTIVE', verify_jwt: meta.verify_jwt !== false,
                created_at: fs.statSync(full).ctimeMs,
                updated_at: fs.statSync(full).mtimeMs,
              });
            }
          }
        }
        return json(200, entries);
      } catch (err) { return json(500, { error: err.message }); }
    }

    // -----------------------------------------------------------------------
    // Functions deploy: POST /api/v1/projects/:ref/functions[/deploy]
    // -----------------------------------------------------------------------
    const deployMatch = pathname.match(/^\/api\/v1\/projects\/([^/]+)\/functions(\/deploy)?$/);
    if (req.method === 'POST' && deployMatch) {
      const slug = url.searchParams.get('slug') || url.searchParams.get('name');
      if (!slug) return json(400, { error: 'Missing slug' });
      const body = await readBody(req);
      const contentType = req.headers['content-type'] || '';
      const boundaryMatch = contentType.match(/boundary=(.+)/i);
      if (!boundaryMatch) return json(400, { error: 'Expected multipart/form-data' });
      const parsed = parseMultipart(boundaryMatch[1].trim(), body);
      if (!parsed.files.length) return json(400, { error: 'No files uploaded' });
      let metadata = {};
      if (parsed.fields.metadata) {
        try { metadata = JSON.parse(parsed.fields.metadata); } catch { }
      }
      try {
        const functionDir = path.join(FUNCTIONS_DIR, slug);
        fs.mkdirSync(functionDir, { recursive: true });
        for (const file of parsed.files) {
          fs.writeFileSync(path.join(functionDir, file.originalname), file.buffer);
        }
        return json(200, {
          id: crypto.randomUUID(), slug, name: slug, version: 1,
          status: 'ACTIVE', created_at: Date.now(), updated_at: Date.now(),
          entrypoint_path: metadata.entrypoint_path || 'file:///src/index.ts',
          import_map_path: metadata.import_map_path || null,
          verify_jwt: metadata.verify_jwt !== false,
        });
      } catch (err) { return json(500, { error: err.message }); }
    }

    // -----------------------------------------------------------------------
    // Function item: /api/v1/projects/:ref/functions/:slug[/sub]
    // -----------------------------------------------------------------------
    const functionItem = pathname.match(/^\/api\/v1\/projects\/([^/]+)\/functions\/([^/]+?)(\/[a-z]+)?$/);
    if (functionItem) {
      const slug = functionItem[2];
      const sub  = functionItem[3]; // '/stats' '/invocations' '/logs' '/body'

      if (req.method === 'DELETE' && !sub) {
        const functionDir = path.join(FUNCTIONS_DIR, slug);
        try {
          if (fs.existsSync(functionDir)) fs.rmSync(functionDir, { recursive: true });
          return json(200, { slug });
        } catch (err) { return json(500, { error: err.message }); }
      }

      if (req.method === 'GET' && sub === '/stats') {
        return json(200, {
          total_invocations: 0, execution_time_p50: 0, execution_time_p90: 0,
          execution_time_p99: 0, error_rate: 0, cpu_time_p50: 0, cpu_time_p90: 0, cpu_time_p99: 0,
        });
      }

      if (req.method === 'GET' && sub === '/invocations') {
        return json(200, { data: [], count: 0 });
      }

      if (req.method === 'GET' && sub === '/body') {
        const functionDir = path.join(FUNCTIONS_DIR, slug);
        if (!fs.existsSync(functionDir)) return json(404, { error: 'Function not found' });
        const boundary = '----SupabaseFMBoundary' + crypto.randomBytes(8).toString('hex');
        const allFiles = fs.readdirSync(functionDir).filter(f => {
          return !f.startsWith('.') && fs.statSync(path.join(functionDir, f)).isFile();
        });
        const metadataObj = {
          entrypoint_path: `file:///home/deno/functions/${slug}/index.ts`,
          import_map_path: null, version: 1,
        };
        let multipart = `--${boundary}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(metadataObj)}\r\n`;
        for (const file of allFiles) {
          const content = fs.readFileSync(path.join(functionDir, file), 'utf8');
          multipart += `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file}"\r\nContent-Type: text/plain\r\n\r\n${content}\r\n`;
        }
        multipart += `--${boundary}--\r\n`;
        res.writeHead(200, { 'Content-Type': `multipart/form-data; boundary=${boundary}` });
        res.end(multipart);
        return;
      }

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
            }
          }
          return json(200, {
            id: crypto.createHash('md5').update(slug).digest('hex'),
            slug, name: loadMeta(slug).name || slug, status: 'ACTIVE', updated_at: Date.now(),
          });
        } catch (err) { return json(500, { error: err.message }); }
      }

      if ((req.method === 'PATCH' || req.method === 'PUT') && !sub) {
        try {
          const body = JSON.parse((await readBody(req)).toString());
          const meta = loadMeta(slug);
          Object.assign(meta, body);
          saveMeta(slug, meta);
          const functionDir = path.join(FUNCTIONS_DIR, slug);
          return json(200, {
            id: crypto.createHash('md5').update(slug).digest('hex'),
            slug, name: meta.name || slug, status: 'ACTIVE',
            verify_jwt: meta.verify_jwt !== false,
            created_at: fs.existsSync(functionDir) ? fs.statSync(functionDir).ctimeMs : Date.now(),
            updated_at: Date.now(),
          });
        } catch (err) { return json(500, { error: err.message }); }
      }

      if (req.method === 'GET' && !sub) {
        const functionDir = path.join(FUNCTIONS_DIR, slug);
        if (!fs.existsSync(functionDir)) return json(404, { error: 'Function not found' });
        const meta = loadMeta(slug);
        return json(200, {
          id: crypto.createHash('md5').update(slug).digest('hex'),
          slug, name: meta.name || slug, status: 'ACTIVE',
          verify_jwt: meta.verify_jwt !== false,
          created_at: fs.statSync(functionDir).ctimeMs,
          updated_at: fs.statSync(functionDir).mtimeMs,
        });
      }
    }

    // -----------------------------------------------------------------------
    // Auth users v1: /api/v1/projects/:ref/auth/users
    // -----------------------------------------------------------------------
    const authUsersV1Base = pathname.match(/^\/api\/v1\/projects\/([^/]+)\/auth\/users$/);
    const authUsersV1Item = pathname.match(/^\/api\/v1\/projects\/([^/]+)\/auth\/users\/([^/]+)$/);
    if (authUsersV1Base || authUsersV1Item) {
      try {
        const body = (req.method !== 'GET' && req.method !== 'DELETE') ? await readBody(req) : null;
        const bodyObj = body && body.length ? JSON.parse(body.toString()) : null;
        const userId = authUsersV1Item ? authUsersV1Item[2] : null;
        const gotrueUrl = userId ? `/admin/users/${userId}` : '/admin/users';
        const r = await httpRequest(req.method, GOTRUE_HOST, GOTRUE_PORT, gotrueUrl, bodyObj);
        return json(r.status, r.data);
      } catch { return json(200, req.method === 'GET' ? { users: [], total: 0 } : {}); }
    }

    // -----------------------------------------------------------------------
    // Config stubs: /api/platform/projects/:ref/config/*
    // Correct response shapes from Studio source: apps/studio/data/config/
    // -----------------------------------------------------------------------
    const configMatch = pathname.match(/^\/api\/platform\/projects\/([^/]+)\/config\/(.+)$/);
    if (configMatch) {
      const configKey = configMatch[2]; // e.g. 'postgrest', 'auth', 'storage'
      if (req.method === 'GET') {
        if (configKey === 'postgrest') {
          // project-postgrest-config-query.ts — data.db_schema.split(',') is called on this
          return json(200, {
            db_schema:       'public',
            db_anon_role:    'anon',
            db_pool:         15,
            max_rows:        1000,
            db_extra_search_path: 'extensions',
            jwt_secret:      JWT_SECRET,
          });
        }
        if (configKey === 'auth') {
          return json(200, {
            site_url:          process.env.SITE_URL || '',
            jwt_exp:           3600,
            disable_signup:    false,
            external:          {},
            email_autoconfirm: false,
            sms_autoconfirm:   false,
            mailer_autoconfirm: false,
            mailer_subjects:   {},
            mailer_templates:  {},
            sms_provider:      '',
            external_email_enabled: true,
            external_phone_enabled: false,
            hook:              {},
          });
        }
        if (configKey === 'storage') {
          return json(200, { fileSizeLimit: 52428800, features: { imageTransformation: { enabled: false } } });
        }
        // Any other config: return empty object (not array)
        return json(200, {});
      }
      // PATCH/PUT for config updates
      if (req.method === 'PATCH' || req.method === 'PUT') {
        try {
          const body = JSON.parse((await readBody(req)).toString());
          return json(200, body);
        } catch { return json(200, {}); }
      }
      return json(200, {});
    }

    // -----------------------------------------------------------------------
    // Catch-all stubs — must return appropriate empty types
    // -----------------------------------------------------------------------

    // /api/platform/pg-meta/:ref/* → proxy to real meta service (http://meta:8080)
    // Strip /api/platform/pg-meta/:ref prefix, forward remaining path
    const pgMetaMatch = pathname.match(/^\/api\/platform\/pg-meta\/([^/]+)(\/.*)$/);
    if (pgMetaMatch) {
      const metaPath = pgMetaMatch[2]; // e.g. /query, /tables, /types, etc.
      const metaQuery = url.search || '';
      const fullMetaPath = metaPath + metaQuery;
      try {
        const reqBody = (req.method !== 'GET' && req.method !== 'DELETE')
          ? await readBody(req) : null;
        const bodyObj = reqBody && reqBody.length ? JSON.parse(reqBody.toString()) : null;

        // Forward important headers (pg credentials come via x-connection-encrypted etc.)
        const forwardHeaders = {};
        ['x-pg-application-name', 'x-connection-encrypted', 'content-type',
         'authorization', 'x-request-id'].forEach(h => {
          if (req.headers[h]) forwardHeaders[h] = req.headers[h];
        });

        const r = await httpRequest(
          req.method, PG_META_HOST, PG_META_PORT, fullMetaPath, bodyObj, forwardHeaders
        );
        return json(r.status, r.data);
      } catch (err) {
        console.error(`pg-meta proxy error for ${fullMetaPath}: ${err.message}`);
        // Return safe empty fallback based on path
        const isArray = !fullMetaPath.startsWith('/query');
        return json(200, isArray ? [] : { data: null, error: null });
      }
    }

    // /api/platform/projects/:ref/* — catch unknown sub-paths
    if (pathname.match(/^\/api\/platform\/projects\/([^/]+)\/.+$/)) {
      console.log(`Platform projects sub-path stub: ${pathname}`);
      return json(200, []);
    }

    // /api/platform/* catch-all
    if (pathname.startsWith('/api/platform/')) {
      console.log(`Platform API catch-all stub: ${pathname}`);
      return json(200, {});
    }

    // /api/v1/* catch-all
    if (pathname.startsWith('/api/v1/')) {
      console.log(`API v1 catch-all stub: ${pathname}`);
      return json(200, {});
    }

    return json(404, { error: 'Not found' });

  } catch (err) {
    console.error(`Unhandled error: ${err.message}`, err.stack);
    return json(500, { error: err.message });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Edge Functions Manager listening on port ${PORT}`);
  console.log(`Functions directory: ${FUNCTIONS_DIR}`);
  console.log(`Secrets file: ${SECRETS_FILE}`);
});

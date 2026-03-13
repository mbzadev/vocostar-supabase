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
// Secrets helpers
// ---------------------------------------------------------------------------
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
  // AUTH CONFIG: /api/v1/projects/:ref/config/auth[/*]
  // Proxies to GoTrue admin API at supabase-auth:9999
  // -----------------------------------------------------------------------
  const authConfigMatch = pathname.match(/^\/api\/v1\/projects\/([^/]+)\/config\/auth(\/.*)?$/);
  if (authConfigMatch) {
    const sub = authConfigMatch[2] || '';
    try {
      if (sub.startsWith('/hooks')) {
        // Auth hooks - use GoTrue's hooks config if available, else return empty list
        if (req.method === 'GET') {
          const r = await httpRequest('GET', GOTRUE_HOST, GOTRUE_PORT, '/admin/config');
          // Return hooks array structure that Studio expects
          return json(200, []);
        }
        if (req.method === 'POST' || req.method === 'PATCH' || req.method === 'DELETE') {
          return json(200, {});
        }
      } else if (sub.startsWith('/third-party') || sub.startsWith('/providers')) {
        // Third-party auth - return empty list
        if (req.method === 'GET') return json(200, []);
        return json(200, {});
      } else {
        // Main auth config
        const body = req.method !== 'GET' ? await readBody(req) : null;
        const bodyObj = body && body.length ? JSON.parse(body.toString()) : null;
        const gotrueMethod = req.method === 'PATCH' || req.method === 'PUT' ? 'PATCH' : 'GET';
        const r = await httpRequest(gotrueMethod, GOTRUE_HOST, GOTRUE_PORT, '/admin/config', bodyObj);
        console.log(`Auth config ${req.method} → GoTrue: ${r.status}`);
        return json(r.status < 400 ? 200 : r.status, r.data);
      }
    } catch (err) {
      console.error('GoTrue proxy error:', err.message);
      return json(502, { error: 'Auth service unavailable', message: err.message });
    }
  }

  // -----------------------------------------------------------------------
  // EMAIL TEMPLATES: /api/v1/projects/:ref/config/email-template/:type
  // -----------------------------------------------------------------------
  const emailTemplateMatch = pathname.match(/^\/api\/v1\/projects\/([^/]+)\/config\/email-template\/([^/]+)$/);
  if (emailTemplateMatch) {
    try {
      const body = req.method !== 'GET' ? await readBody(req) : null;
      const bodyObj = body && body.length ? JSON.parse(body.toString()) : null;
      const gotrueMethod = req.method === 'GET' ? 'GET' : 'PATCH';
      const r = await httpRequest(gotrueMethod, GOTRUE_HOST, GOTRUE_PORT, '/admin/config', bodyObj);
      return json(r.status < 400 ? 200 : r.status, r.data);
    } catch (err) {
      return json(502, { error: 'Auth service unavailable', message: err.message });
    }
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

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateMap } from './lib/validate-map.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_FILE = path.join(ROOT, 'data', 'drift-map.json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'self'",
};

export function loadMap(file = DATA_FILE) {
  const map = JSON.parse(fs.readFileSync(file, 'utf8'));
  const errors = validateMap(map);
  if (errors.length) {
    const err = new Error(`Invalid concept map:\n  - ${errors.join('\n  - ')}`);
    err.validationErrors = errors;
    throw err;
  }
  return map;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(res.req.method === 'HEAD' ? undefined : body);
}

function sendJson(res, status, value) {
  send(res, status, JSON.stringify(value), {
    'Content-Type': MIME['.json'],
    'Cache-Control': 'no-cache',
  });
}

function serveStatic(req, res, pathname) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return send(res, 400, 'Bad request', { 'Content-Type': MIME['.txt'] });
  }
  if (rel.endsWith('/')) rel += 'index.html';

  const file = path.join(PUBLIC_DIR, rel);
  if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) {
    return send(res, 403, 'Forbidden', { 'Content-Type': MIME['.txt'] });
  }

  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) {
      return send(res, 404, 'Not found', { 'Content-Type': MIME['.txt'] });
    }
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': type,
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

export function createServer({ map = loadMap() } = {}) {
  const payload = JSON.stringify(map);

  return http.createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return send(res, 405, 'Method not allowed', { 'Content-Type': MIME['.txt'], Allow: 'GET, HEAD' });
    }

    const { pathname } = new URL(req.url, 'http://localhost');

    if (pathname === '/api/map') {
      return send(res, 200, payload, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-cache' });
    }
    if (pathname === '/api/health') {
      return sendJson(res, 200, { status: 'ok', nodes: map.nodes.length, links: map.links.length });
    }
    if (pathname.startsWith('/api/')) {
      return sendJson(res, 404, { error: 'not found' });
    }
    return serveStatic(req, res, pathname);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 8004;
  const host = process.env.HOST || '0.0.0.0';
  let server;
  try {
    server = createServer();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  server.listen(port, host, () => {
    console.log(`Linguistic drift map running at http://localhost:${port}`);
  });
}

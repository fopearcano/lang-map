import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { validateMap, validateSources, validateLanguages } from './lib/validate-map.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'drift-map.json');
const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.json', '.svg', '.txt']);

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

function fail(what, errors) {
  const err = new Error(`Invalid ${what}:\n  - ${errors.join('\n  - ')}`);
  err.validationErrors = errors;
  throw err;
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

export function loadMap(file = DATA_FILE) {
  const map = readJson(file);
  const errors = validateMap(map);
  if (errors.length) fail('concept map', errors);
  return map;
}

/**
 * Loads and cross-validates every dataset: the concept map, the bibliography
 * and the world-map languages. Throws if anything is inconsistent.
 */
export function loadData(dir = DATA_DIR) {
  const sources = readJson(path.join(dir, 'sources.json'));
  let errors = validateSources(sources);
  if (errors.length) fail('bibliography', errors);
  const sourceIds = new Set(sources.sources.map((s) => s.id));

  const map = readJson(path.join(dir, 'drift-map.json'));
  errors = validateMap(map, { sourceIds });
  if (errors.length) fail('concept map', errors);

  const languages = readJson(path.join(dir, 'languages.json'));
  errors = validateLanguages(languages, { sourceIds, conceptIds: new Set(map.nodes.map((n) => n.id)) });
  if (errors.length) fail('language data', errors);

  return { map, sources, languages };
}

const acceptsGzip = (req) => /\bgzip\b/.test(req.headers['accept-encoding'] || '');

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(res.req.method === 'HEAD' ? undefined : body);
}

// Pre-serialised JSON payload with a cached gzip variant.
function payload(value) {
  const body = Buffer.from(JSON.stringify(value));
  return { body, gzipped: zlib.gzipSync(body) };
}

function sendPayload(req, res, { body, gzipped }) {
  const gzip = acceptsGzip(req);
  send(res, 200, gzip ? gzipped : body, {
    'Content-Type': MIME['.json'],
    'Cache-Control': 'no-cache',
    Vary: 'Accept-Encoding',
    ...(gzip ? { 'Content-Encoding': 'gzip' } : {}),
  });
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
    const ext = path.extname(file).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    const gzip = COMPRESSIBLE.has(ext) && stat.size > 1024 && acceptsGzip(req);
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': type,
      'Cache-Control': 'no-cache',
      Vary: 'Accept-Encoding',
      ...(gzip ? { 'Content-Encoding': 'gzip' } : { 'Content-Length': stat.size }),
    });
    if (req.method === 'HEAD') return res.end();
    const stream = fs.createReadStream(file);
    if (gzip) stream.pipe(zlib.createGzip()).pipe(res);
    else stream.pipe(res);
  });
}

export function createServer({ data = loadData() } = {}) {
  const payloads = {
    '/api/map': payload(data.map),
    '/api/sources': payload(data.sources),
    '/api/languages': payload(data.languages),
  };

  return http.createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return send(res, 405, 'Method not allowed', { 'Content-Type': MIME['.txt'], Allow: 'GET, HEAD' });
    }

    const { pathname } = new URL(req.url, 'http://localhost');

    if (payloads[pathname]) return sendPayload(req, res, payloads[pathname]);
    if (pathname === '/api/health') {
      return sendJson(res, 200, {
        status: 'ok',
        concepts: data.map.nodes.length,
        links: data.map.links.length,
        sources: data.sources.sources.length,
        languages: data.languages.languages.length,
      });
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

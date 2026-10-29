import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server.js';

let server;
let base;

before(async () => {
  server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

test('serves the app shell', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
  assert.match(await res.text(), /Linguistic Drift/);
});

test('serves JavaScript modules with a JavaScript MIME type', async () => {
  const res = await fetch(`${base}/js/main.js`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/javascript/);
});

test('serves the concept map as JSON', async () => {
  const res = await fetch(`${base}/api/map`);
  assert.equal(res.status, 200);
  const map = await res.json();
  assert.ok(map.nodes.length > 50);
  assert.ok(map.links.length > map.nodes.length);
});

test('health endpoint reports counts', async () => {
  const body = await (await fetch(`${base}/api/health`)).json();
  assert.equal(body.status, 'ok');
  assert.ok(body.nodes > 0);
});

test('unknown paths return 404', async () => {
  assert.equal((await fetch(`${base}/nope.html`)).status, 404);
  assert.equal((await fetch(`${base}/api/nope`)).status, 404);
});

test('rejects path traversal', async () => {
  const res = await fetch(`${base}/..%2f..%2fpackage.json`);
  assert.equal(res.status, 403);
});

test('rejects non-GET methods', async () => {
  const res = await fetch(`${base}/api/map`, { method: 'POST' });
  assert.equal(res.status, 405);
});

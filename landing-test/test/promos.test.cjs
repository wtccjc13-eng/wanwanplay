const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const root = path.join(__dirname, '..');
const promos = require('../promos');
const storage = require('../storage');
const headers = ['code', 'type', 'value', 'max_uses', 'expires', 'active', 'partner'];
const rows = () => [headers, ['TEST10', 'percent', 20, 100, '2099-12-31', true, 'Demo'], ['NEW5', 'amount_eur', 5, '', '', false, 'Partner']];
async function directory(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wanwan-promos-'));
  t.after(async () => { for (const name of await fs.readdir(dir)) await fs.unlink(path.join(dir, name)); await fs.rmdir(dir); });
  return dir;
}
test('sheet validation accepts booleans and optional limits, rejects invalid/duplicate/empty input', () => {
  const result = promos.validateRows(rows()); assert.deepEqual(result.errors, []);
  assert.equal(result.codes[1].active, false); assert.equal(result.codes[1].maxUses, null);
  for (const invalid of [[], [null], [headers], [headers, ...rows().slice(1), rows()[1]],
    [headers, ['X', 'bad', '10%', true, '2027-02-30', 'yes', 'a'.repeat(101)]],
    [[...headers, 'extra'], rows()[1]], [headers, [...rows()[1], 'extra']],
    [headers, ['OK', 'percent', 101, 0, '', true, '']],
    [headers, ['OK', 'amount_eur', 1.001, '', '', true, '']]]) {
    assert.ok(promos.validateRows(invalid).errors.length, JSON.stringify(invalid));
  }
});
test('preview/apply preserves counters/history and persists catalog, rejecting stale/source/session/expired previews', async t => {
  const dir = await directory(t), db = storage(dir);
  await fs.writeFile(path.join(dir, 'promo-uses.json'), '{"TEST10":7,"WELCOME5":2}');
  await db.saveOrder({ id: 'WWDEMO', status: 'pending', promoCode: 'TEST10' });
  const reader = { email: 'demo@example.invalid', credentialsReady: true, read: async () => rows() };
  let service = promos(db, reader);
  await service.saveConfig({ sheet: 'https://docs.google.com/spreadsheets/d/' + 'a'.repeat(30) + '/edit', tabName: 'Promos', revision: 0 });
  const before = await fs.readFile(path.join(dir, 'orders.json'), 'utf8');
  const preview = await service.preview('session-A'), concurrent = await service.preview('session-A');
  assert.equal((await service.codes()).find(p => p.code === 'TEST10').value, 10);
  assert.equal(preview.changes.find(p => p.code === 'WELCOME5').action, 'disabled');
  assert.equal(preview.changes.find(p => p.code === 'TEST10').uses, 7);
  await assert.rejects(service.apply(preview.token, 'session-B'), /another session/);
  // A payment completing after preview increments usage without being lost on apply.
  await db.markPaid('WWDEMO', 'FAKE-CAPTURE');
  const paidOrders = await fs.readFile(path.join(dir, 'orders.json'), 'utf8');
  await service.apply(preview.token, 'session-A');
  assert.equal(await db.promoUses('TEST10'), 8);
  assert.equal(await db.promoUses('WELCOME5'), 2);
  assert.equal(await fs.readFile(path.join(dir, 'orders.json'), 'utf8'), paidOrders);
  assert.notEqual(before, paidOrders);
  await assert.rejects(service.apply(concurrent.token, 'session-A'), /changed/);
  await assert.rejects(service.apply(preview.token, 'session-A'), /expired/);
  service = promos(storage(dir), reader);
  assert.equal((await service.codes()).find(p => p.code === 'TEST10').value, 20);
  assert.equal((await service.codes()).find(p => p.code === 'WELCOME5').active, false);
  const staleSource = await service.preview('session-A');
  await service.saveConfig({ sheet: 'b'.repeat(30), tabName: 'Promos', revision: 1 });
  await assert.rejects(service.apply(staleSource.token, 'session-A'), /changed/);
  await assert.rejects(service.saveConfig({ sheet: 'c'.repeat(30), tabName: 'Promos', revision: 1 }), /another window/);
  const expired = await service.preview('session-A');
  const previews = JSON.parse(await fs.readFile(path.join(dir, 'promo-previews.json'), 'utf8'));
  for (const value of Object.values(previews)) value.expires = 1;
  await fs.writeFile(path.join(dir, 'promo-previews.json'), JSON.stringify(previews));
  await assert.rejects(service.apply(expired.token, 'session-A'), /expired/);
  reader.read = async () => [headers];
  assert.ok((await service.preview('session-A')).errors.length);
  reader.read = async () => { throw new Error('source unavailable'); };
  await assert.rejects(service.preview('session-A'), /unavailable/);
  assert.equal((await service.codes()).find(p => p.code === 'TEST10').value, 20);
});
test('Google reader uses readonly auth and a fixed endpoint, redacts upstream credential errors', async () => {
  const oldEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL, oldKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'demo@fake-project.iam.gserviceaccount.com';
  process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = 'fake\\nkey';
  try {
    let authOptions, request;
    const reader = require('../google-sheets')({ authFactory: options => { authOptions = options; return { getAccessToken: async () => ({ token: 'fake-token' }) }; },
      fetchImpl: async (url, options) => { request = { url, options }; return new Response(JSON.stringify({ values: rows() })); } });
    assert.deepEqual(await reader.read({ spreadsheetId: 'a'.repeat(30), tabName: "Owner's Promos" }), rows());
    assert.deepEqual(authOptions.scopes, ['https://www.googleapis.com/auth/spreadsheets.readonly']);
    assert.equal(authOptions.key, 'fake\nkey');
    assert.equal(request.url.origin, 'https://sheets.googleapis.com');
    assert.ok(decodeURIComponent(request.url.pathname).endsWith("'Owner''s Promos'!A:H"));
    assert.equal(request.options.headers.Authorization, 'Bearer fake-token');
    const bad = require('../google-sheets')({ authFactory: () => ({ getAccessToken: async () => { throw new Error('fake-key-secret fake-token'); } }) });
    await assert.rejects(bad.read({}), error => !!error.publicMessage && !/fake-key-secret|fake-token/.test(error.message));
  } finally {
    if (oldEmail === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL; else process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = oldEmail;
    if (oldKey === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY; else process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = oldKey;
  }
});
test('protected import routes update checkout quotes immediately and survive restart', async t => {
  const dir = await directory(t), fixture = path.join(dir, 'fake-sheet.json');
  await fs.writeFile(fixture, JSON.stringify(rows()));
  let app;
  async function start() {
    const code = `const fs=require('node:fs');const p=require.resolve('./google-sheets');require.cache[p]={id:p,filename:p,loaded:true,exports:()=>({email:'demo@example.invalid',credentialsReady:true,read:async()=>JSON.parse(fs.readFileSync(process.env.TEST_SHEET,'utf8'))})};const app=require('./server');const s=app.listen(0,'127.0.0.1',()=>console.log('READY:'+s.address().port));`;
    const child = spawn(process.execPath, ['-e', code], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env,
      NODE_ENV: 'test', DATA_DIR: dir, TEST_SHEET: fixture, ADMIN_PASSWORD: 'test-only-admin-password-123', BASE_URL: 'http://localhost:3000',
      VERCEL: '', PAYPAL_ENV: 'sandbox', PAYPAL_CLIENT_ID: '', PAYPAL_CLIENT_SECRET: '', PAYPAL_MERCHANT_ID: '', PAYPAL_WEBHOOK_ID: '',
      UPSTASH_REDIS_REST_URL: '', UPSTASH_REDIS_REST_TOKEN: '', KV_REST_API_URL: '', KV_REST_API_TOKEN: '' } });
    let output = '';
    const base = await new Promise((resolve, reject) => { child.stdout.on('data', chunk => { output += chunk; const match = output.match(/READY:(\d+)/); if (match) resolve('http://127.0.0.1:' + match[1]); }); child.stderr.resume(); child.once('error', reject); child.once('exit', () => reject(new Error('Server exited'))); });
    return { base, stop: async () => { const done = once(child, 'exit'); child.kill(); await done; } };
  }
  app = await start(); t.after(async () => { if (app) await app.stop(); });
  let cookie = '', csrf = '';
  const request = (route, method = 'GET', body, protect = true) => fetch(app.base + '/api/admin' + route, { method,
    headers: { 'Content-Type': 'application/json', 'X-Admin-Request': '1', Cookie: cookie, ...(protect ? { 'X-CSRF-Token': csrf } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  assert.equal((await request('/promos')).status, 401);
  const login = await request('/login', 'POST', { password: 'test-only-admin-password-123' });
  cookie = login.headers.get('set-cookie').split(';')[0]; csrf = (await login.json()).csrf;
  const config = { sheet: 'a'.repeat(30), tabName: 'Promos', revision: 0 };
  assert.equal((await request('/promos/config', 'PUT', config, false)).status, 403);
  assert.equal((await request('/promos/config', 'PUT', config)).status, 200);
  const quote = async code => (await fetch(app.base + '/api/quote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quantity: 2, promoCode: code }) })).json();
  assert.equal((await quote('TEST10')).discountCents, 398);
  const preview = await (await request('/promos/preview', 'POST', {})).json();
  assert.equal((await quote('TEST10')).discountCents, 398);
  assert.equal((await request('/promos/apply', 'POST', { token: preview.token }, false)).status, 403);
  assert.equal((await request('/promos/apply', 'POST', { token: preview.token })).status, 200);
  assert.equal((await quote('TEST10')).discountCents, 796);
  assert.equal((await quote('WELCOME5')).code, 'PROMO_UNKNOWN');
  assert.equal((await quote('NEW5')).code, 'PROMO_UNKNOWN');
  await fs.writeFile(fixture, JSON.stringify([headers, ['BAD', 'percent', 101, '', '', true, '']]));
  assert.equal((await request('/promos/preview', 'POST', {})).status, 422);
  assert.equal((await quote('TEST10')).discountCents, 796);
  await app.stop(); app = await start();
  assert.equal((await quote('TEST10')).discountCents, 796);
  assert.equal((await request('/promos')).status, 200);
});

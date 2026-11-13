const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const password = 'test-only-backoffice-password-123';
const paid = { id: 'WWPAID', status: 'paid', provider: 'paypal', paypalEnv: 'sandbox', createdAt: '2026-11-13T12:00:00Z',
  qty: 1, totalCents: 1990, subtotalCents: 1990, shippingCents: 0, discountCents: 0,
  checkoutTokenHash: 'private-hash', paypalCaptureId: 'TEST-CAPTURE', customer: { name: 'Example Recipient', email: 'buyer@example.invalid',
    phone: '+33123456789', address: '10 Example Road', zip: '75001', city: 'Paris', country: 'FR' } };
const pending = { ...paid, id: 'WWLEGACY', status: 'pending', provider: 'airwallex', paypalEnv: undefined,
  checkoutTokenHash: undefined, paypalCaptureId: undefined, airwallexIntentId: 'legacy-reference' };
const metadata = { fulfillment: 'packing', carrier: 'Test carrier', trackingNumber: 'TRACK-123', notes: '=SUM(1,2)',
  archived: false, orderType: 'test', version: 0 };
async function start(dir, overrides = {}) {
  const child = spawn(process.execPath, ['-e', "const app=require('./server');const s=app.listen(0,'127.0.0.1',()=>console.log('READY:'+s.address().port));"], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NODE_ENV: 'test', BASE_URL: 'http://localhost:3000',
      ADMIN_PASSWORD: password, DATA_DIR: dir, VERCEL: '', PAYPAL_ENV: 'sandbox', PAYPAL_CLIENT_ID: '', PAYPAL_CLIENT_SECRET: '',
      PAYPAL_MERCHANT_ID: '', PAYPAL_WEBHOOK_ID: '', UPSTASH_REDIS_REST_URL: '', UPSTASH_REDIS_REST_TOKEN: '',
      KV_REST_API_URL: '', KV_REST_API_TOKEN: '', ...overrides },
  });
  let output = '';
  const base = await new Promise((resolve, reject) => {
    child.stdout.on('data', chunk => { output += chunk; const match = output.match(/READY:(\d+)/); if (match) resolve('http://127.0.0.1:' + match[1]); });
    child.stderr.on('data', () => {}); child.once('error', reject); child.once('exit', () => reject(new Error('Application exited')));
  });
  return { base, stop: async () => { if (child.exitCode !== null || child.signalCode !== null) return; const done = once(child, 'exit'); child.kill(); await done; } };
}
async function fixture(t, overrides = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wanwan-admin-'));
  const orders = JSON.stringify({ [paid.id]: paid, [pending.id]: pending });
  await fs.writeFile(path.join(dir, 'orders.json'), orders);
  await fs.writeFile(path.join(dir, 'promo-uses.json'), '{"TEST10":1}');
  let instance = await start(dir, overrides), cookie = '', csrf = '';
  t.after(async () => { await instance.stop(); for (const file of await fs.readdir(dir)) await fs.unlink(path.join(dir, file)); await fs.rmdir(dir); });
  return { dir, orders, get base() { return instance.base; }, get cookie() { return cookie; }, get csrf() { return csrf; },
    async restart(env = {}) { await instance.stop(); instance = await start(dir, { ...overrides, ...env }); },
    async request(route, options = {}) {
      const response = await fetch(instance.base + '/api/admin' + route, { ...options,
        headers: { 'Content-Type': 'application/json', 'X-Admin-Request': '1', Cookie: cookie,
          'X-CSRF-Token': csrf, ...options.headers } });
      if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
      return response;
    },
    async login() {
      const response = await this.request('/login', { method: 'POST', body: JSON.stringify({ password }) });
      assert.equal(response.status, 200); csrf = (await response.json()).csrf; return response;
    },
  };
}
const patch = body => ({ method: 'PATCH', body: JSON.stringify(body) });

test('admin data requires authentication, rejects CSRF and redacts checkout secrets', async t => {
  const f = await fixture(t);
  for (const route of ['/orders', '/orders/WWPAID', '/orders/export.csv', '/session']) assert.equal((await f.request(route)).status, 401);
  assert.equal((await f.request('/orders/WWPAID', patch(metadata))).status, 401);
  assert.equal((await f.request('/login', { method: 'POST', body: JSON.stringify({ password: 'wrong' }) })).status, 401);
  assert.equal((await f.request('/login', { method: 'POST', body: JSON.stringify({ password }), headers: { Origin: 'https://attacker.invalid' } })).status, 403);
  const login = await f.login();
  assert.match(login.headers.get('set-cookie'), /HttpOnly/); assert.match(login.headers.get('set-cookie'), /SameSite=Strict/);
  const response = await f.request('/orders'); const body = await response.text();
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(JSON.parse(body).orders.length, 2);
  assert.equal(body.includes('checkoutTokenHash'), false); assert.equal(body.includes('private-hash'), false);
  assert.equal((await f.request('/orders/WWPAID', { ...patch(metadata), headers: { 'X-CSRF-Token': 'bad' } })).status, 403);
  const shell = await fetch(f.base + '/backoffice/');
  assert.equal(shell.status, 200); assert.match(shell.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal((await shell.text()).includes('buyer@example.invalid'), false);
  const originalCookie = f.cookie;
  assert.equal((await f.request('/logout', { method: 'POST', body: '{}' })).status, 200);
  assert.equal((await f.request('/orders', { headers: { Cookie: originalCookie } })).status, 401);
});

test('fulfillment edits, archive, filtering and CSV preserve original payment data across restart', async t => {
  const f = await fixture(t); await f.login();
  assert.equal((await f.request('/orders/WWPAID', patch({ ...metadata, status: 'paid' }))).status, 400);
  assert.equal((await f.request('/orders/WWLEGACY', patch(metadata))).status, 409);
  assert.equal((await f.request('/orders/WWPAID', patch(metadata))).status, 200);
  assert.equal((await f.request('/orders/WWPAID', patch({ ...metadata, notes: 'Stale edit' }))).status, 409);
  let result = await (await f.request('/orders?payment=paid&search=TRACK-123')).json();
  assert.equal(result.total, 1); assert.equal(result.summary.paidTotalCents, 1990); assert.equal(result.orders[0].management.notes, metadata.notes);
  const csv = await (await f.request('/orders/export.csv?payment=paid')).text();
  assert.match(csv, /Example Recipient/); assert.match(csv, /"'=SUM\(1,2\)"/); assert.doesNotMatch(csv, /private-hash|WWLEGACY/);
  assert.equal((await f.request('/orders/WWPAID', patch({ ...metadata, version: 1, archived: true }))).status, 200);
  result = await (await f.request('/orders')).json(); assert.equal(result.total, 1);
  result = await (await f.request('/orders?archived=yes')).json(); assert.equal(result.orders[0].id, 'WWPAID');
  await f.restart();
  assert.equal((await f.request('/session')).status, 200);
  assert.equal((await (await f.request('/orders/WWPAID')).json()).management.archived, true);
  assert.equal(await fs.readFile(path.join(f.dir, 'orders.json'), 'utf8'), f.orders);
  assert.equal(await fs.readFile(path.join(f.dir, 'promo-uses.json'), 'utf8'), '{"TEST10":1}');
  await f.restart({ ADMIN_PASSWORD: 'a-different-test-password-123' });
  assert.equal((await f.request('/session')).status, 401);
});

test('missing password closes admin; sessions expire; failed logins are rate limited', async t => {
  const f = await fixture(t, { ADMIN_PASSWORD: '' });
  assert.equal((await f.request('/login', { method: 'POST', body: JSON.stringify({ password }) })).status, 503);
  await f.restart({ ADMIN_PASSWORD: password }); await f.login();
  const sessionsFile = path.join(f.dir, 'admin-sessions.json');
  const sessions = JSON.parse(await fs.readFile(sessionsFile, 'utf8'));
  for (const session of Object.values(sessions)) session.expires = 0;
  await fs.writeFile(sessionsFile, JSON.stringify(sessions));
  assert.equal((await f.request('/session')).status, 401);
  for (let i = 0; i < 10; i++) assert.equal((await f.request('/login', { method: 'POST', body: '{"password":"wrong"}' })).status, 401);
  assert.equal((await f.request('/login', { method: 'POST', body: JSON.stringify({ password }) })).status, 429);
});

test('Redis listing supports existing keys; metadata edits do not overwrite payment state', async () => {
  const values = new Map([['order:WWPAID', JSON.stringify(paid)], ['order:WWLEGACY', JSON.stringify(pending)]]);
  const calls = [];
  const redis = async (command, ...args) => {
    calls.push([command, ...args]);
    if (command === 'SCAN') return ['0', ['order:WWPAID', 'order:WWLEGACY', 'order:WWPAID']];
    if (command === 'MGET') return args.map(key => values.get(key) || null);
    if (command === 'GET') return values.get(args[0]) || null;
    if (command === 'SET') { values.set(args[0], args[1]); return 'OK'; }
    if (command === 'DEL') { values.delete(args[0]); return 1; }
    if (command === 'EVAL') {
      const [, count, key, version, raw] = args; assert.equal(count, 1);
      const current = values.has(key) ? JSON.parse(values.get(key)) : { version: 0 };
      if (current.version !== Number(version)) return 0;
      values.set(key, raw); return 1;
    }
    throw new Error('Unexpected Redis command');
  };
  const db = require('../storage')('unused', redis);
  assert.equal((await db.listOrders()).length, 2);
  assert.deepEqual(await db.getManagement(['WWPAID']), {});
  const change = { ...metadata, version: 1 };
  assert.equal(await db.updateManagement('WWPAID', change, 0), 1);
  assert.equal(await db.updateManagement('WWPAID', change, 0), 0);
  assert.equal((await db.getManagement(['WWPAID'])).WWPAID.fulfillment, 'packing');
  await db.saveAdminSession('hash', { csrf: 'test-only', expires: Date.now() + 10000 });
  assert.equal((await db.getAdminSession('hash')).csrf, 'test-only');
  await db.deleteAdminSession('hash'); assert.equal(await db.getAdminSession('hash'), null);
  assert.equal(values.get('order:WWPAID'), JSON.stringify(paid));
  assert.ok(calls.find(call => call[0] === 'SET' && call[1] === 'admin-session:hash' && call[3] === 'EX'));
});

test('backoffice browser flow signs in, shows an order and saves fulfillment separately', async t => {
  const f = await fixture(t), elements = new Map();
  function make(tag) {
    return { tag, value: '', textContent: '', checked: false, hidden: false, disabled: false, children: [], listeners: {},
      options: [], append(...nodes) { this.children.push(...nodes); }, replaceChildren(...nodes) { this.children = nodes; },
      setAttribute() {}, addEventListener(event, fn) { this.listeners[event] = fn; }, close() { this.open = false; }, showModal() { this.open = true; } };
  }
  const html = await fs.readFile(path.join(root, 'admin-public/index.html'), 'utf8');
  for (const match of html.matchAll(/id="([^"]+)"/g)) elements.set(match[1], make('element'));
  const get = id => { assert.ok(elements.has(id), id); return elements.get(id); };
  Object.assign(get('payment'), { value: 'paid' });
  for (const id of ['fulfillment', 'type']) get(id).value = 'all'; get('archived').value = 'no';
  get('edit-fulfillment').options = ['unfulfilled', 'packing', 'shipped', 'on_hold'].map(value => ({ value }));
  const document = { getElementById: get, createElement: make, body: make('body') };
  const ctx = vm.createContext({ document, Intl, Date, URL, URLSearchParams, Object, setTimeout, clearTimeout,
    fetch: async (url, options = {}) => f.request(url.replace('/api/admin', ''), options) });
  vm.runInContext(await fs.readFile(path.join(root, 'admin-public/admin.js'), 'utf8'), ctx);
  async function settle(predicate) { for (let i = 0; i < 200; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); } throw new Error('Browser flow did not settle'); }
  await settle(() => get('login-panel').hidden === false && get('workspace').hidden === true);
  get('password').value = password;
  await get('login-form').listeners.submit({ preventDefault() {} });
  assert.equal(get('workspace').hidden, false); assert.equal(get('stat-paid').textContent, 1);
  assert.equal(get('orders').children.length, 1);
  get('orders').children[0].children[0].children[0].listeners.click();
  await settle(() => get('detail').open);
  assert.equal(get('recipient-name').textContent, 'Example Recipient');
  get('edit-fulfillment').value = 'packing'; get('edit-type').value = 'test';
  get('edit-notes').value = '<script>not executable</script>'; get('edit-carrier').value = 'Example'; get('edit-tracking').value = 'TRACK';
  await get('management-form').listeners.submit({ preventDefault() {} });
  assert.match(get('save-message').textContent, /Saved/);
  const stored = JSON.parse(await fs.readFile(path.join(f.dir, 'order-management.json'), 'utf8'));
  assert.equal(stored.WWPAID.fulfillment, 'packing');
  assert.equal(stored.WWPAID.notes, '<script>not executable</script>');
  assert.equal(await fs.readFile(path.join(f.dir, 'orders.json'), 'utf8'), f.orders);
  await get('logout').listeners.click(); assert.equal(get('workspace').hidden, true);
});

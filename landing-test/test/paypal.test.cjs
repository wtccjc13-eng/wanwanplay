const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const shopper = { name: 'Test Shopper', email: 'shopper@example.invalid', phone: '+33123456789',
  address: '1 Test Street', city: 'Paris', country: 'FR', zip: '75001', quantity: 1, promoCode: 'TEST10', lang: 'en' };
const json = (res, body, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
const post = (base, route, body = {}, headers = {}) => fetch(base + route, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
});
const auth = order => ({ Authorization: 'Bearer ' + order.checkoutToken });
async function app(env) {
  const child = spawn(process.execPath, ['-e', "const app=require('./server');const s=app.listen(0,'127.0.0.1',()=>console.log('READY:'+s.address().port));"], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NODE_ENV: 'test', VERCEL: '',
      PRICE_EUR: '19.90', SHIPPING_EUR: '0', PAYPAL_ENV: 'sandbox',
      PAYPAL_CLIENT_ID: crypto.randomUUID(), PAYPAL_CLIENT_SECRET: crypto.randomUUID(),
      PAYPAL_WEBHOOK_ID: 'test-webhook', PAYPAL_MERCHANT_ID: 'TESTMERCHANT',
      UPSTASH_REDIS_REST_URL: '', UPSTASH_REDIS_REST_TOKEN: '', KV_REST_API_URL: '', KV_REST_API_TOKEN: '', ...env },
  });
  let output = '';
  const base = await new Promise((resolve, reject) => {
    child.stdout.on('data', chunk => { output += chunk; const m = output.match(/READY:(\d+)/); if (m) resolve('http://127.0.0.1:' + m[1]); });
    child.stderr.on('data', () => {}); child.once('error', reject);
    child.once('exit', () => reject(new Error('Application exited before readiness')));
  });
  return { base, stop: async () => { if (child.exitCode !== null || child.signalCode !== null) return;
    const done = once(child, 'exit'); child.kill(); await done; } };
}
async function fixture(t, useRedis = false) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wanwan-paypal-'));
  const remote = new Map(), values = new Map(), calls = [];
  let failRedis = false, failCaptureResponse = false;
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const part of req) raw += part;
    calls.push({ path: req.url, method: req.method, requestId: req.headers['paypal-request-id'] });
    if (req.url === '/redis') {
      const [cmd, ...args] = JSON.parse(raw);
      if (cmd === 'GET') return json(res, { result: values.get(args[0]) || null });
      if (cmd === 'SET') { values.set(args[0], args[1]); return json(res, { result: 'OK' }); }
      if (cmd === 'EVAL') {
        if (failRedis) { failRedis = false; return json(res, { error: 'temporary failure' }, 500); }
        const [, count, key, ...rest] = args;
        const current = JSON.parse(values.get(key));
        if (current.status === 'paid') return json(res, { result: 0 });
        if (count === 1) current.status = rest[0];
        else {
          const [promoKey, paidAt, captureId] = rest;
          if (current.promoCode) values.set(promoKey, String(Number(values.get(promoKey) || 0) + 1));
          current.status = 'paid'; current.paidAt = paidAt; current.paypalCaptureId = captureId;
        }
        values.set(key, JSON.stringify(current)); return json(res, { result: 1 });
      }
      return json(res, { error: 'unsupported command' }, 400);
    }
    if (req.url === '/v1/oauth2/token') return json(res, { access_token: 'fake-test-token', expires_in: 3600 });
    if (req.url === '/v1/notifications/verify-webhook-signature') {
      const body = JSON.parse(raw);
      assert.equal(body.webhook_id, 'test-webhook');
      assert.equal(body.auth_algo, 'SHA256withRSA');
      return json(res, { verification_status: body.transmission_sig === 'valid-test-signature' ? 'SUCCESS' : 'FAILURE' });
    }
    if (req.url === '/v2/checkout/orders' && req.method === 'POST') {
      const body = JSON.parse(raw), id = 'PP' + crypto.randomBytes(8).toString('hex');
      const order = { ...body, id, status: 'CREATED' }; remote.set(id, order);
      return json(res, order, 201);
    }
    const match = req.url.match(/^\/v2\/checkout\/orders\/([^/]+)(\/capture)?$/);
    const order = match && remote.get(match[1]);
    if (!order) return json(res, {}, 404);
    if (match[2]) {
      order.status = 'COMPLETED';
      order.purchase_units[0].payments = { captures: [{ id: 'CAP-' + order.id, status: 'COMPLETED',
        final_capture: true, amount: { ...order.purchase_units[0].amount } }] };
      if (failCaptureResponse) { failCaptureResponse = false; return json(res, {}, 500); }
    }
    return json(res, order);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  const env = { DATA_DIR: dir, PAYPAL_TEST_API_BASE: base, ...(useRedis ? {
    UPSTASH_REDIS_REST_URL: base + '/redis', UPSTASH_REDIS_REST_TOKEN: 'fake-test-redis',
  } : {}) };
  let instance = await app(env);
  t.after(async () => {
    await instance.stop();
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    for (const name of await fs.readdir(dir)) await fs.unlink(path.join(dir, name));
    await fs.rmdir(dir);
  });
  return {
    get base() { return instance.base; }, dir, remote, calls, values,
    async restart() { await instance.stop(); instance = await app(env); },
    failRedis() { failRedis = true; }, failCaptureResponse() { failCaptureResponse = true; },
    async create(body = shopper) {
      const response = await post(instance.base, '/api/checkout', body); assert.equal(response.status, 200);
      return response.json();
    },
    async capture(order, headers = auth(order)) { return post(instance.base, '/api/orders/' + order.orderId + '/capture', {}, headers); },
    async status(order) { return (await fetch(instance.base + '/api/orders/' + order.orderId, { headers: auth(order) })).json(); },
    async webhook(order, type = 'PAYMENT.CAPTURE.COMPLETED', valid = true) {
      return post(instance.base, '/paypal/webhook', { event_type: type,
        resource: { id: type === 'CHECKOUT.ORDER.APPROVED' ? order.paypalOrderId : 'CAP-' + order.paypalOrderId,
          supplementary_data: { related_ids: { order_id: order.paypalOrderId } } } }, {
        'paypal-auth-algo': 'SHA256withRSA', 'paypal-cert-url': 'https://api.paypal.com/test-cert',
        'paypal-transmission-id': 'test-event', 'paypal-transmission-sig': valid ? 'valid-test-signature' : 'invalid',
        'paypal-transmission-time': '2026-11-13T00:00:00Z',
      });
    },
  };
}

test('server totals, authorization, capture retries, duplicate webhooks and restart preserve one paid order', async t => {
  const f = await fixture(t);
  // Legacy payment references are retained alongside new orders.
  const legacy = { id: 'WWOLD', status: 'paid', reference: 'legacy-ref' };
  await fs.writeFile(path.join(f.dir, 'orders.json'), JSON.stringify({ WWOLD: legacy }));
  const config = await (await fetch(f.base + '/api/config')).json();
  assert.equal(config.checkoutReady, true); assert.equal(config.provider, 'paypal');
  assert.equal(JSON.stringify(config).includes('SECRET'), false);
  assert.equal((await post(f.base, '/api/checkout', { ...shopper, country: 'XX' })).status, 400);
  const order = await f.create({ ...shopper, totalCents: 1 });
  const remote = f.remote.get(order.paypalOrderId);
  assert.equal(remote.purchase_units[0].amount.value, '17.91');
  assert.equal(remote.purchase_units[0].shipping.address.country_code, 'FR');
  assert.equal((await f.status(order)).status, 'pending');
  assert.equal((await f.capture(order, {})).status, 404);
  assert.equal((await f.webhook(order, undefined, false)).status, 401);
  assert.equal((await post(f.base, '/paypal/webhook')).status, 401);
  assert.equal((await f.webhook(order)).status, 200);
  assert.equal((await f.status(order)).status, 'pending'); // A forged success body cannot pay a CREATED order.
  remote.status = 'APPROVED'; f.failCaptureResponse();
  assert.equal((await f.capture(order)).status, 502); // PayPal captured, but its response was lost.
  await f.restart();
  const results = await Promise.all(Array.from({ length: 5 }, () => f.capture(order)));
  for (const response of results) { assert.equal(response.status, 200); assert.equal((await response.json()).status, 'paid'); }
  assert.equal((await f.webhook(order)).status, 200);
  await f.restart();
  assert.equal((await f.status(order)).status, 'paid');
  assert.equal(f.calls.filter(c => c.path.endsWith('/capture')).length, 1);
  const orders = JSON.parse(await fs.readFile(path.join(f.dir, 'orders.json'), 'utf8'));
  assert.deepEqual(orders.WWOLD, legacy);
  assert.equal(orders[order.orderId].paypalCaptureId, 'CAP-' + order.paypalOrderId);
  assert.equal(orders[order.orderId].checkoutToken, undefined);
  assert.equal(JSON.parse(await fs.readFile(path.join(f.dir, 'promo-uses.json'), 'utf8')).TEST10, 1);
  assert.equal((await fetch(f.base + '/api/orders/' + order.orderId)).status, 404);
});

test('amount, currency, merchant and order-reference mismatches never mark orders paid', async t => {
  const f = await fixture(t);
  for (const mutate of [
    unit => { unit.amount.value = '0.01'; }, unit => { unit.amount.currency_code = 'USD'; },
    unit => { unit.payee.merchant_id = 'OTHER'; }, unit => { unit.custom_id = 'OTHER'; },
    unit => { unit.payments.captures[0].amount.value = '0.01'; },
  ]) {
    const order = await f.create(), remote = f.remote.get(order.paypalOrderId), unit = remote.purchase_units[0];
    remote.status = 'COMPLETED';
    unit.payments = { captures: [{ id: 'CAP', status: 'COMPLETED', final_capture: true, amount: { ...unit.amount } }] };
    mutate(unit);
    assert.equal((await f.capture(order)).status, 502);
    assert.equal((await f.status(order)).status, 'pending');
  }
  await assert.rejects(fs.readFile(path.join(f.dir, 'promo-uses.json')), { code: 'ENOENT' });
});

test('pending capture waits for completion; approval webhook captures without a browser', async t => {
  const f = await fixture(t), order = await f.create(), remote = f.remote.get(order.paypalOrderId);
  remote.status = 'COMPLETED';
  remote.purchase_units[0].payments = { captures: [{ id: 'CAP-PENDING', status: 'PENDING', final_capture: true,
    amount: { ...remote.purchase_units[0].amount } }] };
  assert.equal((await (await f.capture(order)).json()).status, 'pending');
  remote.purchase_units[0].payments.captures[0].status = 'COMPLETED';
  assert.equal((await f.webhook(order)).status, 200);
  assert.equal((await f.status(order)).status, 'paid');
  const other = await f.create(); f.remote.get(other.paypalOrderId).status = 'APPROVED';
  assert.equal((await f.webhook(other, 'CHECKOUT.ORDER.APPROVED')).status, 200);
  assert.equal((await f.status(other)).status, 'paid');
  const denied = await f.create(), declined = f.remote.get(denied.paypalOrderId);
  declined.status = 'COMPLETED'; declined.purchase_units[0].payments = { captures: [{ status: 'DECLINED' }] };
  assert.equal((await (await f.capture(denied)).json()).status, 'failed');
  assert.equal((await f.status(denied)).status, 'failed');
});

test('Redis transient commit failure retries successfully without double counting', async t => {
  const f = await fixture(t, true), order = await f.create();
  f.remote.get(order.paypalOrderId).status = 'APPROVED';
  f.failRedis(); assert.equal((await f.capture(order)).status, 502);
  const responses = await Promise.all(Array.from({ length: 5 }, () => f.webhook(order)));
  for (const response of responses) assert.equal(response.status, 200);
  assert.equal((await f.status(order)).status, 'paid');
  assert.equal(f.values.get('promo:TEST10'), '1');
});

test('file journal recovers an interrupted payment and preserves legacy data', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wanwan-recover-'));
  t.after(async () => { for (const name of await fs.readdir(dir)) await fs.unlink(path.join(dir, name)); await fs.rmdir(dir); });
  const orders = { old: { id: 'old', status: 'paid', provider: 'legacy' }, new: { id: 'new', status: 'paid', promoCode: 'TEST10' } };
  await fs.writeFile(path.join(dir, 'payment-journal.json'), JSON.stringify({ orders, uses: { TEST10: 1 } }));
  const db = require('../storage')(dir, null);
  assert.deepEqual(await db.getOrder('old'), orders.old);
  assert.equal(await db.promoUses('TEST10'), 1);
  await db.markPaid('new', 'CAP');
  assert.equal(await db.promoUses('TEST10'), 1);
  await assert.rejects(fs.readFile(path.join(dir, 'payment-journal.json')), { code: 'ENOENT' });
  await fs.writeFile(path.join(dir, 'orders.json'), '{broken');
  await assert.rejects(db.saveOrder({ id: 'other' }), SyntaxError);
});

test('incomplete PayPal configuration fails closed and all HTML scripts parse', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wanwan-config-'));
  t.after(() => fs.rmdir(dir));
  for (const env of [{ PAYPAL_CLIENT_SECRET: '' }, { PAYPAL_MERCHANT_ID: '' }, { PAYPAL_WEBHOOK_ID: '' }, { PAYPAL_ENV: 'typo' }]) {
    const instance = await app({ DATA_DIR: dir, ...env });
    try {
      assert.equal((await (await fetch(instance.base + '/api/config')).json()).checkoutReady, false);
      assert.equal((await post(instance.base, '/api/checkout', shopper)).status, 503);
    } finally { await instance.stop(); }
  }
  for (const file of ['index.html', 'success.html', 'cancel.html']) {
    const html = await fs.readFile(path.join(root, 'public', file), 'utf8');
    for (const script of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);
  }
});

test('browser button flow validates fields, creates an order, captures and shows only server-confirmed payment', async t => {
  const f = await fixture(t), memory = new Map();
  const sessionStorage = { getItem: k => memory.get(k) || null, setItem: (k, v) => memory.set(k, v), removeItem: k => memory.delete(k) };
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, { value: '', hidden: false, disabled: false, textContent: '', listeners: {},
      addEventListener(name, fn) { this.listeners[name] = fn; }, add() {}, querySelectorAll: () => [],
      querySelector: () => ({ setAttribute() {} }), classList: { toggle() {} }, setAttribute() {} });
    return elements.get(id);
  }
  const document = { getElementById: element, querySelector: selector => element(selector), querySelectorAll: () => [],
    addEventListener() {}, createElement: () => ({}), head: { appendChild(script) { queueMicrotask(() => script.onload()); } } };
  const fields = { ...shopper }; delete fields.lang;
  for (const [name, value] of Object.entries(fields)) element(name === 'quantity' ? 'qty' : name).value = String(value);
  const fieldElements = Object.keys(fields).map(name => element(name === 'quantity' ? 'qty' : name));
  element('form').querySelectorAll = () => fieldElements;
  let valid = false, buttons;
  element('form').reportValidity = () => valid;
  const ctx = {
    document, location: { href: '' }, sessionStorage, URLSearchParams, queueMicrotask,
    I18N: { lang: 'en', t: key => key, money: value => 'EUR' + value, apply() {} }, COUNTRIES: [],
    FormData: class { entries() { return Object.entries(fields); } },
    fetch: (route, init) => fetch(new URL(route, f.base), init),
    paypal: { Buttons(options) { buttons = options; return { async render() {} }; } },
  };
  ctx.window = ctx;
  const context = vm.createContext(ctx);
  const html = await fs.readFile(path.join(root, 'public/index.html'), 'utf8');
  const script = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].find(m => m[1].includes("const $ ="))[1];
  vm.runInContext(script, context);
  async function settle(predicate) {
    for (let i = 0; i < 200; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
    throw new Error('Browser flow did not settle');
  }
  await settle(() => buttons && element('pay').hidden);
  let rejected = false, resolved = false;
  const actions = { reject() { rejected = true; }, resolve() { resolved = true; } };
  buttons.onClick({}, actions); assert.equal(rejected, true);
  valid = true; buttons.onClick({}, actions); assert.equal(resolved, true);
  element('promo').value = 'TEST10'; await element('applyPromo').listeners.click();
  const paypalOrderId = await buttons.createOrder();
  assert.equal(fieldElements.every(el => el.disabled), true);
  f.remote.get(paypalOrderId).status = 'APPROVED';
  await buttons.onApprove({ orderID: paypalOrderId });
  assert.match(ctx.location.href, /^\/success.html\?lang=en&order=WW/);
  const localId = new URL(ctx.location.href, f.base).searchParams.get('order');
  assert.ok(memory.get('ww-order-' + localId));

  const success = await fs.readFile(path.join(root, 'public/success.html'), 'utf8');
  const statusScript = [...success.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].find(m => m[1].includes('const order ='))[1];
  const statusContext = vm.createContext({ ...ctx, location: { search: '?lang=en&order=' + localId } });
  vm.runInContext(statusScript, statusContext);
  await settle(() => element('h1').textContent === 'paypal.paid.title');
  assert.equal(element('check').hidden, true);
  // A URL with an order reference but no browser token cannot claim success.
  vm.runInContext(statusScript, vm.createContext({ ...ctx, sessionStorage: { getItem: () => null }, location: { search: '?order=' + localId } }));
  assert.equal(element('h1').textContent, 'paypal.unknown.title');

  const translations = vm.createContext({ window: {}, location: { search: '' }, localStorage: sessionStorage, URLSearchParams });
  vm.runInContext(await fs.readFile(path.join(root, 'public/i18n.js'), 'utf8'), translations);
  for (const key of ['paypal.secure', 'paypal.check', 'paypal.paid.title', 'paypal.pending.detail', 'paypal.unknown.detail', 'banner.paypalSandbox']) {
    assert.notEqual(translations.window.I18N.t(key), key);
  }
});

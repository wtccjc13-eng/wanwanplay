const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');

const sampleOrder = { name: 'Test Shopper', email: 'shopper@example.invalid', phone: '+33123456789',
  address: '1 Test Street', zip: '75001', city: 'Paris', country: 'FR', quantity: 1, promoCode: 'TEST10', lang: 'en' };
const listen = async (server) => {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
};
const close = (server) => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
const json = (res, body, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
async function post(base, pathname, body, headers = {}) {
  return fetch(base + pathname, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body) });
}
async function startApp(env = {}) {
  const child = spawn(process.execPath, ['-e',
    "const app=require('./server');const s=app.listen(0,'127.0.0.1',()=>console.log('READY:'+s.address().port));"], {
    cwd: path.join(__dirname, '..'), stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, VERCEL: '1', DATA_DIR: '', BASE_URL: 'https://test.example.invalid',
      AIRWALLEX_CLIENT_ID: '', AIRWALLEX_API_KEY: '', AIRWALLEX_WEBHOOK_SECRET: '', AIRWALLEX_API_BASE: '',
      AIRWALLEX_ENV: 'demo', NEWEBPAY_MERCHANT_ID: '', NEWEBPAY_HASH_KEY: '', NEWEBPAY_HASH_IV: '',
      UPSTASH_REDIS_REST_URL: '', UPSTASH_REDIS_REST_TOKEN: '', KV_REST_API_URL: '', KV_REST_API_TOKEN: '', ...env }
  });
  let output = '';
  const base = await new Promise((resolve, reject) => {
    child.stdout.on('data', chunk => { output += chunk; const m = output.match(/READY:(\d+)/); if (m) resolve(`http://127.0.0.1:${m[1]}`); });
    child.stderr.on('data', () => {}); child.once('error', reject);
    child.once('exit', () => reject(new Error('Test application exited before readiness')));
  });
  return { base, output: () => output, stop: async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const stopped = once(child, 'exit'); child.kill(); await stopped;
  } };
}

test('Vercel refuses checkout without durable storage', async t => {
  const app = await startApp(); t.after(app.stop);
  const response = await post(app.base, '/api/checkout', sampleOrder);
  assert.equal(response.status, 503);
});

test('Production requires Airwallex credentials and webhook secret; Apple verification remains exact', async t => {
  const app = await startApp({ AIRWALLEX_ENV: 'prod' }); t.after(app.stop);
  const config = await (await fetch(app.base + '/api/config')).json();
  assert.equal(config.checkoutReady, false);
  const checkout = await post(app.base, '/api/checkout', sampleOrder);
  assert.equal(checkout.status, 503);
  assert.equal((await checkout.json()).code, 'PAYMENT_UNAVAILABLE');
  assert.equal((await post(app.base, '/pay/mock/WWFAKE/ok', {})).status, 404);
  const verification = await fetch(app.base + '/.well-known/apple-developer-merchantid-domain-association');
  assert.equal(verification.status, 200);
  assert.match(verification.headers.get('content-type'), /^application\/octet-stream/);
  const expected = await fs.readFile(path.join(__dirname, '..', 'public', '.well-known', 'apple-developer-merchantid-domain-association'));
  assert.deepEqual(Buffer.from(await verification.arrayBuffer()), expected);
});

test('Hostinger refuses startup when DATA_DIR is not a writable directory', async () => {
  // Le fichier de test lui-même ne peut pas être utilisé comme dossier de données.
  await assert.rejects(startApp({ VERCEL: '', DATA_DIR: __filename }), /exited before readiness/);
});

test('Hostinger file storage preserves an Airwallex payment and promo count after restart', async t => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wanwan-data-test-'));
  const dataDir = path.join(tempRoot, 'persistent');
  const secret = crypto.randomBytes(32).toString('hex');
  let intent, app;
  const fakeAirwallex = http.createServer(async (req, res) => {
    if (req.url === '/api/v1/authentication/login') return json(res, { token: crypto.randomUUID() });
    if (req.url === '/api/v1/pa/payment_intents/create') {
      let raw = ''; for await (const part of req) raw += part;
      const body = JSON.parse(raw);
      intent = { id: 'int_' + crypto.randomUUID(), merchant_order_id: body.merchant_order_id,
        amount: body.amount, currency: body.currency, status: 'SUCCEEDED', client_secret: crypto.randomUUID() };
      return json(res, intent);
    }
    return intent && req.url.endsWith('/' + intent.id) ? json(res, intent) : json(res, {}, 404);
  });
  t.after(async () => {
    if (app) await app.stop();
    await close(fakeAirwallex);
    // Supprimer seulement les deux fichiers de cette fixture, puis ses dossiers vides.
    await fs.rm(path.join(dataDir, 'orders.json'), { force: true });
    await fs.rm(path.join(dataDir, 'promo-uses.json'), { force: true });
    await fs.rmdir(dataDir).catch(e => { if (e.code !== 'ENOENT') throw e; });
    await fs.rmdir(tempRoot);
  });
  const awUrl = await listen(fakeAirwallex);
  const env = { VERCEL: '', DATA_DIR: dataDir, AIRWALLEX_CLIENT_ID: crypto.randomUUID(),
    AIRWALLEX_API_KEY: crypto.randomUUID(), AIRWALLEX_WEBHOOK_SECRET: secret, AIRWALLEX_API_BASE: awUrl };
  app = await startApp(env);
  assert.equal((await post(app.base, '/api/checkout', sampleOrder)).status, 200);
  const readOrders = async () => JSON.parse(await fs.readFile(path.join(dataDir, 'orders.json'), 'utf8'));
  const readUses = async () => JSON.parse(await fs.readFile(path.join(dataDir, 'promo-uses.json'), 'utf8'));
  assert.equal((await readOrders())[intent.merchant_order_id].status, 'pending');
  const raw = JSON.stringify({ id: 'evt_files', name: 'payment_intent.succeeded', data: { object: { id: intent.id } } });
  const timestamp = String(Date.now());
  const headers = { 'x-timestamp': timestamp,
    'x-signature': crypto.createHmac('sha256', secret).update(timestamp + raw).digest('hex') };
  assert.equal((await post(app.base, '/airwallex/webhook', raw, headers)).status, 200);
  const paidOrder = (await readOrders())[intent.merchant_order_id];
  assert.equal(paidOrder.status, 'paid'); assert.equal(paidOrder.totalCents, 1791);
  assert.equal((await readUses()).TEST10, 1);
  await app.stop();
  app = await startApp(env);
  assert.deepEqual((await readOrders())[intent.merchant_order_id], paidOrder);
  const duplicates = await Promise.all(Array.from({ length: 3 }, () => post(app.base, '/airwallex/webhook', raw, headers)));
  assert.ok(duplicates.every(r => r.status === 200));
  assert.equal((await readUses()).TEST10, 1);
  assert.deepEqual((await readOrders())[intent.merchant_order_id], paidOrder);
  assert.equal((app.output().match(/\[commande payée\]/g) || []).length, 0);
});

test('Airwallex signatures, sandbox config, amount checks and retry-safe duplicate delivery', async t => {
  const records = new Map(), intents = new Map(); let failPaymentWrite = false, intentReads = 0;
  const secret = crypto.randomBytes(32).toString('hex');
  const fakeRedis = http.createServer(async (req, res) => {
    let raw = ''; for await (const part of req) raw += part;
    const [cmd, ...args] = JSON.parse(raw);
    if (failPaymentWrite && ['EVAL', 'INCR'].includes(cmd)) { failPaymentWrite = false; return json(res, { error: 'injected transient write failure' }, 503); }
    let result;
    if (cmd === 'GET') result = records.get(args[0]) ?? null;
    else if (cmd === 'SET') {
      if (args.includes('NX') && records.has(args[0])) result = null;
      else { records.set(args[0], args[1]); result = 'OK'; }
    } else if (cmd === 'INCR') { result = Number(records.get(args[0]) || 0) + 1; records.set(args[0], String(result)); }
    else if (cmd === 'EVAL') {
      const [script, keyCount, orderKey, promoKey, paidAt] = args;
      assert.equal(keyCount, 2); assert.match(script, /cjson.decode/);
      const order = JSON.parse(records.get(orderKey) || 'null');
      if (!order) result = -1;
      else if (order.status === 'paid') result = 0;
      else {
        if (order.promoCode) records.set(promoKey, String(Number(records.get(promoKey) || 0) + 1));
        order.status = 'paid'; order.paidAt = paidAt; records.set(orderKey, JSON.stringify(order)); result = 1;
      }
    } else return json(res, { error: 'unexpected Redis command' }, 500);
    json(res, { result });
  });
  const fakeAirwallex = http.createServer(async (req, res) => {
    if (req.url === '/api/v1/authentication/login') return json(res, { token: crypto.randomUUID() });
    if (req.url === '/api/v1/pa/payment_intents/create') {
      let raw = ''; for await (const part of req) raw += part;
      const body = JSON.parse(raw), id = 'int_' + crypto.randomUUID();
      const pi = { id, merchant_order_id: body.merchant_order_id, amount: body.amount, currency: body.currency,
        status: 'SUCCEEDED', client_secret: crypto.randomUUID() };
      intents.set(id, pi); return json(res, pi);
    }
    const id = req.url.split('/').pop(); intentReads++;
    return intents.has(id) ? json(res, intents.get(id)) : json(res, {}, 404);
  });
  const redisUrl = await listen(fakeRedis); t.after(() => close(fakeRedis));
  const awUrl = await listen(fakeAirwallex); t.after(() => close(fakeAirwallex));
  const app = await startApp({ AIRWALLEX_CLIENT_ID: crypto.randomUUID(), AIRWALLEX_API_KEY: crypto.randomUUID(),
    AIRWALLEX_WEBHOOK_SECRET: secret, AIRWALLEX_API_BASE: awUrl,
    DATA_DIR: __filename, // Redis doit ignorer ce chemin local volontairement inutilisable.
    KV_REST_API_URL: redisUrl, KV_REST_API_TOKEN: crypto.randomUUID() }); t.after(app.stop);
  const checkout = await post(app.base, '/api/checkout', sampleOrder);
  assert.equal(checkout.status, 200);
  const { airwallex } = await checkout.json(); assert.equal(airwallex.env, 'sandbox');
  assert.equal(airwallex.shopperCountryCode, 'FR');
  const intent = intents.get(airwallex.intentId), orderKey = 'order:' + intent.merchant_order_id;
  assert.equal(intent.amount, 17.91); assert.equal(intent.currency, 'EUR');
  assert.equal((await fetch(app.base + '/success.html')).status, 200);
  assert.equal(JSON.parse(records.get(orderKey)).status, 'pending');
  const raw = JSON.stringify({ id: 'evt_test', name: 'payment_intent.succeeded', data: { object: { id: intent.id } } });
  const timestamp = String(Date.now());
  const headers = { 'x-timestamp': timestamp, 'x-signature': crypto.createHmac('sha256', secret).update(timestamp + raw).digest('hex') };
  assert.equal((await post(app.base, '/airwallex/webhook', raw, { ...headers, 'x-signature': 'invalid' })).status, 401);
  assert.equal((await post(app.base, '/airwallex/webhook', raw + ' ', headers)).status, 401);
  assert.equal(intentReads, 0);
  intent.amount = 1;
  assert.equal((await post(app.base, '/airwallex/webhook', raw, headers)).status, 200);
  assert.equal(JSON.parse(records.get(orderKey)).status, 'pending');
  intent.amount = 17.91;
  failPaymentWrite = true;
  assert.equal((await post(app.base, '/airwallex/webhook', raw, headers)).status, 500);
  assert.equal(JSON.parse(records.get(orderKey)).status, 'pending');
  assert.equal(records.get('promo:TEST10'), undefined);
  const retries = await Promise.all(Array.from({ length: 5 }, () => post(app.base, '/airwallex/webhook', raw, headers)));
  assert.ok(retries.every(r => r.status === 200));
  assert.equal(JSON.parse(records.get(orderKey)).status, 'paid');
  assert.equal(records.get('promo:TEST10'), '1');
  assert.equal([...records.keys()].some(k => k.startsWith('paidlock:')), false);
  assert.equal((app.output().match(/\[commande payée\]/g) || []).length, 1);
});

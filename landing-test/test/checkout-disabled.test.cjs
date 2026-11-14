const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

async function startApp(dataDir, env = {}) {
  const child = spawn(process.execPath, ['-e', "const app=require('./server');const s=app.listen(0,'127.0.0.1',()=>console.log('READY:'+s.address().port));"], {
    cwd: path.join(__dirname, '..'), stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, DATA_DIR: dataDir, VERCEL: '', PRICE_EUR: '19.90', SINGLE_DECK_SHIPPING_EUR: '0',
      PAYPAL_ENV: 'sandbox', PAYPAL_CLIENT_ID: '', PAYPAL_CLIENT_SECRET: '', PAYPAL_WEBHOOK_ID: '', PAYPAL_MERCHANT_ID: '',
      UPSTASH_REDIS_REST_URL: '', UPSTASH_REDIS_REST_TOKEN: '', KV_REST_API_URL: '', KV_REST_API_TOKEN: '', ...env },
  });
  let output = '';
  const base = await new Promise((resolve, reject) => {
    child.stdout.on('data', chunk => { output += chunk; const m = output.match(/READY:(\d+)/); if (m) resolve('http://127.0.0.1:' + m[1]); });
    child.stderr.on('data', () => {});
    child.once('error', reject);
    child.once('exit', () => reject(new Error('Application exited before readiness')));
  });
  return { base, stop: async () => { if (child.exitCode !== null || child.signalCode !== null) return; const done = once(child, 'exit'); child.kill(); await done; } };
}
const post = (base, route, body = {}) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('checkout and all former payment endpoints cannot modify persisted orders or promo counters', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wanwan-disabled-'));
  const orders = '{"WWEXISTING":{"id":"WWEXISTING","status":"paid","totalCents":1791,"provider":"legacy","reference":"keep-me"}}';
  const uses = '{"TEST10":100}';
  await fs.writeFile(path.join(dir, 'orders.json'), orders);
  await fs.writeFile(path.join(dir, 'promo-uses.json'), uses);
  let app;
  t.after(async () => { if (app) await app.stop(); await fs.unlink(path.join(dir, 'orders.json')); await fs.unlink(path.join(dir, 'promo-uses.json')); await fs.rmdir(dir); });
  for (let restart = 0; restart < 2; restart++) {
    app = await startApp(dir);
    const config = await (await fetch(app.base + '/api/config')).json();
    assert.equal(config.provider, 'none'); assert.equal(config.checkoutReady, false); assert.equal(config.simulation, false);
    const checkout = await post(app.base, '/api/checkout', { name: 'Do not store me', quantity: 1 });
    assert.equal(checkout.status, 503); assert.equal((await checkout.json()).code, 'PAYMENT_UNAVAILABLE');
    for (const route of ['/airwallex/webhook', '/payment/notify', '/payment/return', '/pay/mock/WWEXISTING/ok']) {
      assert.equal((await post(app.base, route)).status, 404, route);
    }
    for (const route of ['/pay/mock/WWEXISTING', '/.well-known/apple-developer-merchantid-domain-association']) {
      assert.equal((await fetch(app.base + route)).status, 404, route);
    }
    const quote = await (await post(app.base, '/api/quote', { quantity: 2 })).json();
    assert.equal(quote.totalCents, 3980);
    const exhausted = await post(app.base, '/api/quote', { quantity: 1, promoCode: 'TEST10' });
    assert.equal(exhausted.status, 400); assert.equal((await exhausted.json()).code, 'PROMO_EXHAUSTED');
    const discount = await (await post(app.base, '/api/quote', { quantity: 1, promoCode: 'WELCOME5' })).json();
    assert.equal(discount.totalCents, 1490);
    assert.equal(await fs.readFile(path.join(dir, 'orders.json'), 'utf8'), orders);
    assert.equal(await fs.readFile(path.join(dir, 'promo-uses.json'), 'utf8'), uses);
    const html = await (await fetch(app.base)).text();
    assert.match(html, /id="pay"[^>]*disabled/);
    assert.doesNotMatch(html, /airwallex|newebpay/i);
    for (const script of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);
    new vm.Script(await (await fetch(app.base + '/i18n.js')).text());
    await app.stop(); app = null;
  }
});

test('Redis promo counters remain supported and are only read', async t => {
  const commands = [];
  const redis = http.createServer(async (req, res) => {
    let raw = ''; for await (const part of req) raw += part;
    const command = JSON.parse(raw); commands.push(command);
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ result: '100' }));
  });
  redis.listen(0, '127.0.0.1'); await once(redis, 'listening');
  t.after(() => new Promise(resolve => { redis.close(resolve); redis.closeAllConnections(); }));
  const app = await startApp(__filename, { UPSTASH_REDIS_REST_URL: 'http://127.0.0.1:' + redis.address().port, UPSTASH_REDIS_REST_TOKEN: 'test-only' });
  t.after(app.stop);
  const quote = await post(app.base, '/api/quote', { quantity: 1, promoCode: 'TEST10' });
  assert.equal((await quote.json()).code, 'PROMO_EXHAUSTED');
  assert.equal((await post(app.base, '/api/checkout')).status, 503);
  assert.deepEqual(commands, [['GET', 'promo:TEST10']]);
});

test('unusable file storage still prevents startup', async () => {
  await assert.rejects(startApp(__filename), /exited before readiness/);
});

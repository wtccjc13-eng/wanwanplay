const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { once } = require('node:events');
const storage = require('../storage');
const emails = require('../order-emails');
const env = { NODE_ENV: 'test', MAIL_ENABLED: 'true', SMTP_HOST: 'smtp.example.invalid', SMTP_PORT: '465', SMTP_USER: 'sender@example.invalid',
  SMTP_PASSWORD: 'test-only-password', MAIL_FROM: 'sender@example.invalid', MAIL_TO: 'team@example.invalid', BASE_URL: 'https://example.invalid' };
const order = (id = 'WWDEMO') => ({ id, status: 'pending', provider: 'paypal', paypalEnv: 'live', notificationVersion: 1, lang: 'en', qty: 2,
  subtotalCents: 3980, discountCents: 398, shippingCents: 0, totalCents: 3582, promoCode: 'DEMO10',
  customer: { name: 'Test <Shopper>', email: 'buyer@example.invalid', address: '10 Test Road', zip: '75001', city: 'Paris', country: 'FR' }, deliveryStatus: 'ready' });
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wanwan-email-'));
  t.after(async () => { for (const name of await fs.readdir(dir)) await fs.unlink(path.join(dir, name)); await fs.rmdir(dir); });
  const db = storage(dir); return { dir, db };
}
test('localized email templates escape customer HTML and show exact totals, address and safe links', () => {
  const en = emails.message(order(), 'buyer', env.BASE_URL);
  assert.match(en.subject, /Order confirmed/); assert.match(en.text, /€35.82/);
  assert.match(en.text, /Quantity: 2/); assert.match(en.text, /DEMO10/);
  assert.match(en.html, /Test &lt;Shopper&gt;/); assert.doesNotMatch(en.html, /Test <Shopper>/);
  assert.doesNotMatch(en.text, /backoffice/);
  const zh = emails.message({ ...order(), lang: 'zh' }, 'buyer', env.BASE_URL);
  assert.match(zh.subject, /付款確認/); assert.match(zh.html, /lang="zh-Hant"/); assert.match(zh.text, /配送地址/);
  assert.match(emails.message(order(), 'team', env.BASE_URL).html, /https:\/\/example.invalid\/backoffice\//);
  for (const invalid of ['buyer@example.invalid\r\nBcc:evil@example.invalid', 'Buyer <buyer@example.invalid>', 'a@x.invalid,b@x.invalid', '', undefined]) assert.equal(emails.validEmail(invalid), false);
});
test('paid-only worker sends two messages once across competing workers and restarts, preserving payment data', async t => {
  const { dir, db } = await fixture(t), sent = [];
  await db.saveOrder(order());
  await db.saveOrder({ ...order('WWOLD'), notificationVersion: undefined, status: 'paid' });
  await db.saveOrder({ ...order('WWFAILED'), status: 'failed' });
  let options;
  const factory = config => { options = config; return { sendMail: async mail => { sent.push(mail); await new Promise(resolve => setImmediate(resolve)); return { accepted: [mail.to.address] }; } }; };
  const first = emails(db, { env, createTransport: factory }), second = emails(storage(dir), { env, createTransport: factory });
  await first.run(); assert.equal(sent.length, 0);
  await db.markPaid('WWDEMO', 'FAKE-CAPTURE');
  const paidBefore = await fs.readFile(path.join(dir, 'orders.json'), 'utf8'), usesBefore = await fs.readFile(path.join(dir, 'promo-uses.json'), 'utf8');
  await Promise.all([first.run(), second.run()]);
  assert.equal(sent.length, 2); assert.deepEqual(sent.map(mail => mail.to.address).sort(), ['buyer@example.invalid', 'team@example.invalid']);
  assert.equal(options.secure, true); assert.equal(options.requireTLS, true); assert.equal(options.logger, false);
  await db.markPaid('WWDEMO', 'FAKE-CAPTURE');
  await emails(storage(dir), { env, createTransport: factory }).run(); assert.equal(sent.length, 2);
  assert.equal(await fs.readFile(path.join(dir, 'orders.json'), 'utf8'), paidBefore);
  assert.equal(await fs.readFile(path.join(dir, 'promo-uses.json'), 'utf8'), usesBefore);
  const states = await first.statuses([await db.getOrder('WWDEMO')]);
  assert.equal(states.WWDEMO.buyer.status, 'sent'); assert.equal(states.WWDEMO.team.attempts, 1);
  assert.doesNotMatch(JSON.stringify(states), /test-only-password|token|buyer@example/);
});
test('missing settings hold notifications; sandbox is opt-in and redirects both messages to the team', async t => {
  const { db } = await fixture(t), sent = [];
  const item = { ...order(), paypalEnv: 'sandbox' }; await db.saveOrder(item); await db.markPaid(item.id, 'FAKE');
  const factory = () => ({ sendMail: async mail => { sent.push(mail); return { accepted: [mail.to.address] }; } });
  const disabled = emails(db, { env: { ...env, MAIL_ENABLED: 'false' }, createTransport: factory }); await disabled.run(); assert.equal(disabled.ready, false);
  const sandboxOff = emails(db, { env, createTransport: factory }); await sandboxOff.run(); assert.equal(sent.length, 0);
  assert.equal((await sandboxOff.statuses([await db.getOrder(item.id)])).WWDEMO.buyer.status, 'sandbox_off');
  await emails(db, { env: { ...env, MAIL_SANDBOX_ENABLED: 'true' }, createTransport: factory }).run();
  assert.equal(sent.length, 2); for (const mail of sent) { assert.equal(mail.to.address, env.MAIL_TO); assert.match(mail.subject, /SANDBOX TEST/); }
});
test('explicit failures retry independently up to five attempts, then admin retry can recover', async t => {
  const { db } = await fixture(t); await db.saveOrder(order()); await db.markPaid('WWDEMO', 'FAKE');
  let clock = 1000000, fail = true, buyerAttempts = 0, teamAttempts = 0;
  const worker = emails(db, { env, now: () => clock, createTransport: () => ({ sendMail: async mail => {
    if (mail.to.address === 'buyer@example.invalid') { buyerAttempts++; if (fail) throw Object.assign(new Error('do not expose SMTP credential details'), { code: 'EAUTH' }); }
    else teamAttempts++;
    return { accepted: [mail.to.address] };
  } }) });
  await worker.run(); await worker.run(); assert.equal(buyerAttempts, 1); assert.equal(teamAttempts, 1);
  for (let i = 0; i < 6; i++) { clock += 300001; await worker.run(); }
  assert.equal(buyerAttempts, 5); assert.equal(teamAttempts, 1);
  const state = (await worker.statuses([await db.getOrder('WWDEMO')])).WWDEMO;
  assert.equal(state.buyer.status, 'failed'); assert.equal(state.buyer.attempts, 5);
  assert.doesNotMatch(JSON.stringify(state), /credential details/);
  fail = false; await db.retryNotification('WWDEMO:buyer'); await worker.run();
  assert.equal(buyerAttempts, 6); assert.equal(teamAttempts, 1);
  assert.equal((await worker.statuses([await db.getOrder('WWDEMO')])).WWDEMO.buyer.status, 'sent');
});
test('ambiguous sends and expired interrupted claims are held, never blindly resent', async t => {
  const { db } = await fixture(t); await db.saveOrder(order()); await db.markPaid('WWDEMO', 'FAKE');
  let attempts = 0, clock = 1000000;
  const worker = emails(db, { env, now: () => clock, createTransport: () => ({ sendMail: async () => { attempts++; throw Object.assign(new Error('connection lost'), { code: 'ETIMEDOUT', command: 'DATA' }); } }) });
  await worker.run(); assert.equal(attempts, 2);
  clock += 600000; await worker.run(); await db.retryNotification('WWDEMO:buyer'); await worker.run(); assert.equal(attempts, 2);
  assert.equal((await worker.statuses([await db.getOrder('WWDEMO')])).WWDEMO.buyer.status, 'uncertain');
  await db.saveOrder(order('WWINTERRUPTED')); await db.markPaid('WWINTERRUPTED', 'FAKE2');
  await db.claimNotification('WWINTERRUPTED:buyer', 'crashed-worker', clock - 180000, 'buyer@example.invalid');
  await worker.run();
  assert.equal((await worker.statuses([await db.getOrder('WWINTERRUPTED')])).WWINTERRUPTED.buyer.status, 'uncertain');
  assert.equal(attempts, 3); // only the unclaimed team notification was attempted
});
test('missing buyer email still sends the team alert and reports the missing contact', async t => {
  const { db } = await fixture(t), item = order(); delete item.customer.email; await db.saveOrder(item); await db.markPaid(item.id, 'FAKE');
  const sent = [], worker = emails(db, { env, createTransport: () => ({ sendMail: async mail => { sent.push(mail); return { accepted: [mail.to.address] }; } }) });
  await worker.run(); assert.equal(sent.length, 1); assert.equal(sent[0].to.address, env.MAIL_TO);
  assert.equal((await worker.statuses([await db.getOrder(item.id)])).WWDEMO.buyer.status, 'missing_email');
});
test('Nodemailer submits both MIME messages to a local fake SMTP server and stores acceptance', async t => {
  const { db } = await fixture(t); await db.saveOrder(order()); await db.markPaid('WWDEMO', 'FAKE');
  const messages = [], sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    socket.write('220 local-test SMTP\r\n'); let buffered = '', data = false, body = [];
    socket.on('data', chunk => {
      buffered += chunk.toString(); let end;
      while ((end = buffered.indexOf('\r\n')) >= 0) {
        const line = buffered.slice(0, end); buffered = buffered.slice(end + 2);
        if (data) { if (line === '.') { messages.push(body.join('\n')); data = false; body = []; socket.write('250 accepted\r\n'); } else body.push(line); }
        else if (line.startsWith('EHLO')) socket.write('250-local-test\r\n250 8BITMIME\r\n');
        else if (line === 'DATA') { data = true; socket.write('354 continue\r\n'); }
        else if (line === 'QUIT') { socket.end('221 bye\r\n'); }
        else socket.write('250 ok\r\n');
      }
    });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); });
  // Only this injected test transport disables TLS on loopback. Production
  // transport options always require TLS and authenticate the mailbox.
  const worker = emails(db, { env, createTransport: () => require('nodemailer').createTransport({ host: '127.0.0.1', port: server.address().port, secure: false, ignoreTLS: true }) });
  await worker.run(); worker.stop();
  assert.equal(messages.length, 2); assert.match(messages[0], /Message-ID: <WWDEMO.buyer@example.invalid>/i);
  assert.match(messages[0], /Content-Type: multipart\/alternative/i);
  assert.match(messages[1], /To: team@example.invalid/i);
  assert.equal((await worker.statuses([await db.getOrder('WWDEMO')])).WWDEMO.team.status, 'sent');
});

const express = require('express');
const crypto = require('node:crypto');
const path = require('node:path');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const same = (a, b) => crypto.timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b)));
const validId = id => /^WW[A-Z0-9]{1,64}$/.test(id);
const defaults = { fulfillment: 'unfulfilled', carrier: '', trackingNumber: '', notes: '', archived: false, orderType: 'unknown', version: 0 };

module.exports = function admin(app, db, paymentEnv, promos, orderEmails) {
  const password = process.env.ADMIN_PASSWORD || '';
  const enabled = password.length >= 16;
  const cookieName = 'ww_admin';
  const secure = process.env.NODE_ENV === 'production' || process.env.BASE_URL?.startsWith('https://');
  const cookieOptions = { httpOnly: true, secure: !!secure, sameSite: 'strict', path: '/api/admin' };
  const fingerprint = hash(password);
  const attempts = new Map();
  const protectHeaders = (_req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
    next();
  };
  app.use('/backoffice', protectHeaders, express.static(path.join(__dirname, 'admin-public'), { index: 'index.html' }));
  const router = express.Router();
  router.use(protectHeaders);
  const safe = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(() => res.status(500).json({ error: 'Unable to access order storage. Please try again.' }));
  router.use((req, res, next) => {
    if (!enabled) return res.status(503).json({ error: 'Backoffice is disabled. Set ADMIN_PASSWORD to at least 16 characters in Hostinger, then restart.' });
    if (!['GET', 'HEAD'].includes(req.method)) {
      const origin = req.get('origin');
      const expected = process.env.BASE_URL ? new URL(process.env.BASE_URL).origin : null;
      if (req.get('x-admin-request') !== '1' || (origin && expected && origin !== expected))
        return res.status(403).json({ error: 'Request rejected. Open the backoffice on the configured website domain.' });
    }
    next();
  });
  router.post('/login', safe(async (req, res) => {
    const now = Date.now(), key = req.ip;
    for (const [ip, attempt] of attempts) if (attempt.until < now) attempts.delete(ip);
    if (attempts.size > 2000 && !attempts.has(key)) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
    const attempt = attempts.get(key) || { count: 0, until: now + 900000 };
    if (attempt.count >= 10) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
    attempt.count++; attempts.set(key, attempt);
    if (typeof req.body.password !== 'string' || req.body.password.length > 1024 || !same(req.body.password, password))
      return res.status(401).json({ error: 'Incorrect password.' });
    attempts.delete(key);
    const token = crypto.randomBytes(32).toString('hex');
    const session = { csrf: crypto.randomBytes(32).toString('hex'), expires: now + 28800000, fingerprint };
    await db.saveAdminSession(hash(token), session);
    res.cookie(cookieName, token, { ...cookieOptions, maxAge: 28800000 });
    res.json({ csrf: session.csrf, paymentEnv });
  }));
  router.use(safe(async (req, res, next) => {
    const token = (req.get('cookie') || '').split(';').map(v => v.trim()).find(v => v.startsWith(cookieName + '='))?.slice(cookieName.length + 1) || '';
    const session = /^[a-f0-9]{64}$/.test(token) ? await db.getAdminSession(hash(token)) : null;
    if (!session || session.expires <= Date.now() || session.fingerprint !== fingerprint)
      return res.status(401).json({ error: 'Please sign in.' });
    if (!['GET', 'HEAD'].includes(req.method) && !same(req.get('x-csrf-token') || '', session.csrf))
      return res.status(403).json({ error: 'Session check failed. Refresh the page and try again.' });
    req.adminSession = session; req.adminSessionHash = hash(token); next();
  }));
  router.get('/session', (req, res) => res.json({ csrf: req.adminSession.csrf, paymentEnv }));
  router.post('/logout', safe(async (req, res) => {
    await db.deleteAdminSession(req.adminSessionHash); res.clearCookie(cookieName, cookieOptions); res.json({ ok: true });
  }));
  router.get('/promos', safe(async (_req, res) => res.json(await promos.overview())));
  // Only explicit validation/setup errors may leave this boundary. Storage and
  // upstream failures can include credentials or paths, so keep them generic.
  const promoAction = (action, status = 400) => safe(async (req, res) => {
    try { res.json(await action(req)); }
    catch (error) {
      if (error.publicMessage) return res.status(status).json({ error: error.publicMessage });
      throw error;
    }
  });
  router.put('/promos/config', promoAction(req => promos.saveConfig(req.body)));
  router.post('/promos/preview', safe(async (req, res) => {
    try {
      const result = await promos.preview(req.adminSessionHash);
      if (result.errors) return res.status(422).json({ error: 'The sheet has errors. Active codes are unchanged.', errors: result.errors });
      res.json(result);
    } catch (error) {
      if (error.publicMessage) return res.status(400).json({ error: error.publicMessage });
      throw error;
    }
  }));
  router.post('/promos/apply', promoAction(req => promos.apply(req.body.token, req.adminSessionHash), 409));
  function present(order, management) {
    const customer = order.customer || {};
    return { id: order.id, status: order.status, provider: order.provider || 'unknown',
      paymentEnv: order.paypalEnv || 'unknown', createdAt: order.createdAt, paidAt: order.paidAt || null,
      deliveryStatus: order.deliveryStatus || null, checkoutIssue: order.checkoutIssue || null,
      qty: order.qty, subtotalCents: order.subtotalCents, discountCents: order.discountCents,
      shippingCents: order.shippingCents, totalCents: order.totalCents, promoCode: order.promoCode || null,
      paypalOrderId: order.paypalOrderId || null, paypalCaptureId: order.paypalCaptureId || null,
      legacyPaymentId: order.airwallexIntentId || null,
      customer: Object.fromEntries(['name', 'email', 'phone', 'address', 'zip', 'city', 'state', 'country'].map(key => [key, String(customer[key] || '')])),
      management: { ...defaults, ...management } };
  }
  async function allOrders(query) {
    const orders = (await db.listOrders()).filter(order => order && validId(order.id));
    const records = await db.getManagement(orders.map(order => order.id));
    const notifications = await orderEmails.statuses(orders);
    const search = String(query.search || '').slice(0, 200).trim().toLowerCase();
    return orders.map(order => ({ ...present(order, records[order.id]), notifications: notifications[order.id] })).filter(order => {
      const meta = order.management;
      if (query.payment && query.payment !== 'all' && order.status !== query.payment) return false;
      if (query.fulfillment && query.fulfillment !== 'all' && meta.fulfillment !== query.fulfillment) return false;
      if (query.archived === 'yes' ? !meta.archived : query.archived !== 'all' && meta.archived) return false;
      if (query.type && query.type !== 'all' && meta.orderType !== query.type) return false;
      return !search || [order.id, order.paypalOrderId, order.paypalCaptureId, order.legacyPaymentId,
        ...Object.values(order.customer), meta.notes, meta.trackingNumber, meta.carrier].join(' ').toLowerCase().includes(search);
    }).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || a.id.localeCompare(b.id));
  }
  router.get('/orders', safe(async (req, res) => {
    const orders = await allOrders(req.query);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1), limit = 50;
    const paid = orders.filter(order => order.status === 'paid');
    res.json({ orders: orders.slice((page - 1) * limit, page * limit), total: orders.length, page, limit,
      summary: { paid: paid.length, toPrepare: paid.filter(o => o.management.fulfillment === 'unfulfilled').length,
        pending: orders.filter(o => o.status === 'pending').length, paidTotalCents: paid.reduce((sum, o) => sum + (o.totalCents || 0), 0) } });
  }));
  router.get('/orders/export.csv', safe(async (req, res) => {
    const orders = await allOrders(req.query);
    const cell = raw => {
      let value = String(raw ?? '');
      if (/^[\s]*[=+@-]/.test(value) || /^[\t\r\n]/.test(value)) value = "'" + value;
      return '"' + value.replace(/"/g, '""') + '"';
    };
    const header = ['Order', 'Created', 'Payment', 'Provider', 'Environment', 'Order type', 'Fulfillment', 'Archived', 'Quantity', 'Total EUR', 'Promo',
      'Recipient', 'Email', 'Phone', 'Address', 'Postcode', 'City', 'State/region', 'Country', 'Carrier', 'Tracking', 'Notes', 'PayPal order', 'PayPal capture', 'Legacy payment', 'Delivery status'];
    const lines = orders.map(o => [o.id, o.createdAt, o.status, o.provider, o.paymentEnv, o.management.orderType,
      o.management.fulfillment, o.management.archived, o.qty, (o.totalCents / 100).toFixed(2), o.promoCode,
      ...['name', 'email', 'phone', 'address', 'zip', 'city', 'state', 'country'].map(k => o.customer[k]),
      o.management.carrier, o.management.trackingNumber, o.management.notes, o.paypalOrderId, o.paypalCaptureId, o.legacyPaymentId, o.deliveryStatus]);
    res.type('text/csv').attachment('wanwan-orders.csv').send('\uFEFF' + [header, ...lines].map(row => row.map(cell).join(',')).join('\r\n'));
  }));
  router.get('/orders/:id', safe(async (req, res) => {
    const order = validId(req.params.id) ? await db.getOrder(req.params.id) : null;
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    const records = await db.getManagement([order.id]);
    const notifications = await orderEmails.statuses([order]);
    res.json({ ...present(order, records[order.id]), notifications: notifications[order.id] });
  }));
  router.post('/orders/:id/retry-emails', safe(async (req, res) => {
    const order = validId(req.params.id) ? await db.getOrder(req.params.id) : null;
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    if (!await orderEmails.retry(order)) return res.status(409).json({ error: 'Email sending is not configured or this order is not eligible.' });
    res.json({ ok: true });
  }));
  router.patch('/orders/:id', safe(async (req, res) => {
    const order = validId(req.params.id) ? await db.getOrder(req.params.id) : null;
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    const body = req.body;
    const allowed = ['fulfillment', 'carrier', 'trackingNumber', 'notes', 'archived', 'orderType', 'version'];
    if (Object.keys(body).some(key => !allowed.includes(key)) ||
        !['unfulfilled', 'packing', 'shipped', 'on_hold'].includes(body.fulfillment) ||
        !['unknown', 'test', 'real'].includes(body.orderType) || typeof body.archived !== 'boolean' ||
        !Number.isSafeInteger(body.version) || body.version < 0 ||
        Object.entries({ carrier: 80, trackingNumber: 150, notes: 4000 }).some(([key, max]) => typeof body[key] !== 'string' || body[key].length > max))
      return res.status(400).json({ error: 'Invalid order management fields.' });
    if (['packing', 'shipped'].includes(body.fulfillment) && order.status !== 'paid')
      return res.status(409).json({ error: 'Only confirmed paid orders can be packed or shipped.' });
    if (['packing', 'shipped'].includes(body.fulfillment) && order.deliveryStatus === 'needs_attention')
      return res.status(409).json({ error: 'PayPal delivery details need review before packing or shipping.' });
    const value = { ...body, version: body.version + 1, updatedAt: new Date().toISOString() };
    if (!await db.updateManagement(order.id, value, body.version))
      return res.status(409).json({ error: 'Another edit was saved. Reopen this order before editing again.' });
    res.json({ ok: true, management: value });
  }));
  app.use('/api/admin', router);
};

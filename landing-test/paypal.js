const crypto = require('node:crypto');
const { recipient, DeliveryError } = require('./recipient');

const cents = value => {
  if (typeof value !== 'string' || !/^\d+\.\d{2}$/.test(value)) return NaN;
  return Number(value.replace('.', ''));
};

module.exports = function paypal(db) {
  const { PAYPAL_ENV = 'sandbox', PAYPAL_CLIENT_ID = '', PAYPAL_CLIENT_SECRET = '',
    PAYPAL_WEBHOOK_ID = '', PAYPAL_MERCHANT_ID = '' } = process.env;
  let base = PAYPAL_ENV === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
  // Tests cannot redirect production credentials to an arbitrary API host.
  if (process.env.NODE_ENV === 'test' && process.env.PAYPAL_TEST_API_BASE) {
    const url = new URL(process.env.PAYPAL_TEST_API_BASE);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') throw new Error('Invalid test API');
    base = url.origin;
  }
  const ready = ['sandbox', 'live'].includes(PAYPAL_ENV) &&
    !!(PAYPAL_CLIENT_ID && PAYPAL_CLIENT_SECRET && PAYPAL_WEBHOOK_ID && PAYPAL_MERCHANT_ID) &&
    !(process.env.VERCEL && !(process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN));
  let token, tokenExpires = 0;
  async function request(method, route, body, requestId) {
    if (!ready) throw new Error('PAYMENT_UNAVAILABLE');
    if (!token || tokenExpires < Date.now() + 60000) {
      const auth = await fetch(base + '/v1/oauth2/token', {
        method: 'POST', signal: AbortSignal.timeout(15000),
        headers: { Authorization: 'Basic ' + Buffer.from(PAYPAL_CLIENT_ID + ':' + PAYPAL_CLIENT_SECRET).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials',
      });
      const data = await auth.json();
      if (!auth.ok || !data.access_token) throw new Error('PAYPAL_AUTH');
      token = data.access_token; tokenExpires = Date.now() + Number(data.expires_in || 300) * 1000;
    }
    const response = await fetch(base + route, {
      method, signal: AbortSignal.timeout(20000),
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Prefer: 'return=representation',
        ...(requestId ? { 'PayPal-Request-Id': requestId } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json();
    if (!response.ok) { if (response.status === 401) token = null; throw new Error('PAYPAL_API'); }
    return data;
  }
  const get = id => request('GET', '/v2/checkout/orders/' + encodeURIComponent(id));
  function validate(remote, local) {
    const units = remote.purchase_units;
    if (local.provider !== 'paypal' || remote.id !== local.paypalOrderId || remote.intent !== 'CAPTURE' ||
        !Array.isArray(units) || units.length !== 1) throw new Error('PAYMENT_MISMATCH');
    const unit = units[0];
    if (unit.custom_id !== local.id || unit.invoice_id !== local.id ||
        unit.payee?.merchant_id !== PAYPAL_MERCHANT_ID || unit.amount?.currency_code !== 'EUR' ||
        cents(unit.amount?.value) !== local.totalCents) throw new Error('PAYMENT_MISMATCH');
    return unit;
  }
  async function saveRecipient(remote, local, required) {
    try {
      // A capture retry may reuse the recipient verified before the initial charge.
      if (!required && !remote.purchase_units?.[0]?.shipping && local.deliveryStatus === 'ready') return;
      const customer = recipient(remote, local.customer || {});
      // The required delivery contact entered on our checkout takes precedence
      // over an optional PayPal account phone, including on webhook/retry paths.
      if (local.deliveryPhone) customer.phone = local.deliveryPhone;
      const details = { customer, customerSource: 'paypal', deliveryStatus: 'ready', checkoutIssue: null };
      if (await db.updateDelivery(local.id, details) === -1) throw new Error('ORDER_UNKNOWN');
      Object.assign(local, details);
    } catch (error) {
      if (!(error instanceof DeliveryError)) throw error;
      await db.updateDelivery(local.id, { deliveryStatus: 'needs_attention', checkoutIssue: error.code });
      if (required) throw error;
    }
  }
  async function sync(remote, local) {
    const unit = validate(remote, local);
    const captures = unit.payments?.captures || [];
    if (captures.length > 1) throw new Error('PAYMENT_MISMATCH');
    const capture = captures[0];
    if (capture?.status === 'COMPLETED') {
      if (remote.status !== 'COMPLETED' || !capture.id || capture.amount?.currency_code !== 'EUR' ||
          cents(capture.amount?.value) !== local.totalCents || capture.final_capture !== true)
        throw new Error('PAYMENT_MISMATCH');
      // An externally completed capture is still a payment even if delivery needs review.
      // Never hide a real charge or make the customer pay again to fix delivery details.
      await saveRecipient(remote, local, false);
      const changed = await db.markPaid(local.id, capture.id);
      if (changed === -1) throw new Error('ORDER_UNKNOWN');
      if (changed === 1) console.log('[commande payée] ' + local.id + ' (PayPal)');
      return 'paid';
    }
    const status = ['DENIED', 'DECLINED', 'FAILED'].includes(capture?.status) || remote.status === 'VOIDED' ? 'failed' : 'pending';
    if (unit.shipping) await saveRecipient(remote, local, false);
    await db.setPaymentStatus(local.id, status);
    return status;
  }
  const inFlight = new Map();
  async function capture(local) {
    if (inFlight.has(local.id)) return inFlight.get(local.id);
    const work = (async () => {
      let remote = await get(local.paypalOrderId);
      const unit = validate(remote, local);
      if (remote.status === 'APPROVED' && !unit.payments?.captures?.length) {
        await saveRecipient(remote, local, true);
        await request('POST', '/v2/checkout/orders/' + encodeURIComponent(local.paypalOrderId) + '/capture', {}, local.id + '-capture');
        remote = await get(local.paypalOrderId);
      }
      return sync(remote, local);
    })();
    inFlight.set(local.id, work);
    try { return await work; } finally { inFlight.delete(local.id); }
  }
  return {
    ready, env: PAYPAL_ENV, clientId: PAYPAL_CLIENT_ID,
    async create(local, productName) {
      const remote = await request('POST', '/v2/checkout/orders', {
        intent: 'CAPTURE',
        purchase_units: [{ custom_id: local.id, invoice_id: local.id,
          description: (productName + ' ×' + local.qty).slice(0, 127),
          payee: { merchant_id: PAYPAL_MERCHANT_ID },
          amount: { currency_code: 'EUR', value: (local.totalCents / 100).toFixed(2) },
        }],
        payment_source: { paypal: { experience_context: { brand_name: 'WanWan Play',
          shipping_preference: 'GET_FROM_FILE', user_action: 'PAY_NOW' } } },
      }, local.id + '-create');
      if (!remote.id) throw new Error('PAYPAL_API');
      local.paypalOrderId = remote.id;
      validate(remote, local);
      return remote.id;
    },
    capture,
    async webhook(req) {
      const keys = { auth_algo: 'paypal-auth-algo', cert_url: 'paypal-cert-url', transmission_id: 'paypal-transmission-id',
        transmission_sig: 'paypal-transmission-sig', transmission_time: 'paypal-transmission-time' };
      const body = { webhook_id: PAYPAL_WEBHOOK_ID, webhook_event: req.body };
      for (const [key, header] of Object.entries(keys)) {
        body[key] = req.get(header);
        if (!body[key]) return false;
      }
      const verified = await request('POST', '/v1/notifications/verify-webhook-signature', body);
      if (verified.verification_status !== 'SUCCESS') return false;
      const event = req.body;
      const approved = event.event_type === 'CHECKOUT.ORDER.APPROVED';
      if (!approved && !['PAYMENT.CAPTURE.COMPLETED', 'PAYMENT.CAPTURE.PENDING', 'PAYMENT.CAPTURE.DENIED'].includes(event.event_type)) return true;
      const remoteId = approved ? event.resource?.id : event.resource?.supplementary_data?.related_ids?.order_id;
      if (typeof remoteId !== 'string' || remoteId.length > 64) throw new Error('PAYMENT_MISMATCH');
      const remote = await get(remoteId);
      const local = await db.getOrder(remote.purchase_units?.[0]?.custom_id);
      // This PayPal app may also serve other sites: acknowledge unrelated orders.
      if (!local) return true;
      if (approved) {
        try { await capture(local); }
        catch (error) { if (!(error instanceof DeliveryError)) throw error; }
      } else await sync(remote, local);
      return true;
    },
    tokenHash: value => crypto.createHash('sha256').update(value).digest('hex'),
  };
};

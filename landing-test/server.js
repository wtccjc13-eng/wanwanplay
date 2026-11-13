require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('node:crypto');

const {
  PORT = 3000,
  BASE_URL = 'http://localhost:3000',
  PRODUCT_NAME = '灣灣好日子 野生動物版',
  PRICE_EUR = '19.90',
  SHIPPING_EUR = '0',
} = process.env;

// Prices and promotion totals are always calculated on the server.
const PRICE_CENTS = Math.round(parseFloat(PRICE_EUR) * 100);       // prix unitaire affiché, en centimes d'euro
const SHIPPING_CENTS = Math.round(parseFloat(SHIPPING_EUR) * 100);  // frais de port par commande, en centimes
if (!Number.isSafeInteger(PRICE_CENTS) || PRICE_CENTS < 100 ||
    !Number.isSafeInteger(SHIPPING_CENTS) || SHIPPING_CENTS < 0) throw new Error('Invalid product pricing');
// ---------- Stockage ----------
// Par défaut : fichiers JSON dans DATA_DIR (hébergement avec disque persistant, ex. Hostinger Node.js).
// Option : base Redis (Upstash) si UPSTASH_REDIS_REST_URL / _TOKEN (ou KV_REST_API_URL / _TOKEN) sont définies,
// utile sur un hébergement à disque éphémère (serverless).
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '';
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';
const USE_REDIS = !!(REDIS_URL && REDIS_TOKEN);

const redis = async (...cmd) => {
  const r = await fetch(REDIS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error('redis: ' + (j.error || r.status));
  return j.result;
};

// DATA_DIR : dossier de stockage des commandes et codes promo. Sur Hostinger, le choisir HORS du dossier du site
// (ex. /home/<utilisateur>/wanwanplay-data) pour qu'un redéploiement ne l'efface pas.
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(__dirname, process.env.DATA_DIR)
  : (process.env.VERCEL ? path.join(os.tmpdir(), 'wanwanplay-data') : path.join(__dirname, 'data'));
const db = require('./storage')(DATA_DIR, USE_REDIS ? redis : null);
const paypal = require('./paypal')(db);
const CHECKOUT_READY = paypal.ready && !(process.env.VERCEL && !USE_REDIS);
const COUNTRIES = ['FR','BE','CH','LU','DE','NL','IT','ES','PT','GB','IE','AT','DK','SE','FI','NO','PL','CZ','SK','HU','SI','HR','RO','BG','GR','CY','MT','EE','LV','LT'];
const loadPromos = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'promo-codes.json'), 'utf8'));

// Erreur à code stable : le navigateur traduit le message selon la langue
class ApiError extends Error {
  constructor(code) { super(code); this.code = code; }
}

// ---------- Codes promo : toujours recalculés côté serveur ----------
async function promoDiscount(rawCode, subtotalCents) {
  const code = String(rawCode || '').trim().toUpperCase();
  if (!code) return { code: null, discountCents: 0 };
  const promo = loadPromos().find((p) => p.code.toUpperCase() === code);
  if (!promo) throw new ApiError('PROMO_UNKNOWN');
  if (promo.expires && new Date(promo.expires + 'T23:59:59') < new Date()) throw new ApiError('PROMO_EXPIRED');
  if (promo.maxUses && (await db.promoUses(promo.code)) >= promo.maxUses) throw new ApiError('PROMO_EXHAUSTED');
  let discountCents = 0;
  if (promo.type === 'percent') discountCents = Math.round((subtotalCents * promo.value) / 100);
  if (promo.type === 'amount_eur') discountCents = Math.round(promo.value * 100);
  discountCents = Math.max(0, Math.min(discountCents, subtotalCents - 100)); // jamais gratuit (min. 1 €)
  return { code: promo.code, discountCents };
}

async function computeTotals(quantity, promoCode) {
  const qty = Math.min(Math.max(parseInt(quantity, 10) || 1, 1), 10);
  const subtotalCents = PRICE_CENTS * qty;
  const { code, discountCents } = await promoDiscount(promoCode, subtotalCents);
  const totalCents = subtotalCents - discountCents + SHIPPING_CENTS;
  return { qty, code, subtotalCents, discountCents, shippingCents: SHIPPING_CENTS, totalCents };
}

// ---------- App ----------
const app = express();
app.use((_req, res, next) => {
  res.set('Referrer-Policy', 'no-referrer');
  next();
});
app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
app.use(express.json({ limit: '128kb' }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/config', (_req, res) => {
  res.json({ productName: PRODUCT_NAME, priceCents: PRICE_CENTS, shippingCents: SHIPPING_CENTS, simulation: false, provider: CHECKOUT_READY ? 'paypal' : 'none', checkoutReady: CHECKOUT_READY, paypalEnv: paypal.env, paypalClientId: CHECKOUT_READY ? paypal.clientId : null });
});

app.post('/api/quote', async (req, res) => {
  try {
    res.json({ ok: true, ...(await computeTotals(req.body.quantity, req.body.promoCode)) });
  } catch (e) {
    if (e instanceof ApiError) return res.status(400).json({ code: e.code });
    console.error('[quote erreur] INTERNAL');
    res.status(500).json({ code: 'GENERIC' });
  }
});

function errorResponse(res, error) {
  if (error instanceof ApiError) return res.status(400).json({ code: error.code });
  // Never log upstream responses, credentials or customer data.
  console.error('[paiement erreur]', ['PAYMENT_MISMATCH', 'PAYPAL_API', 'PAYPAL_AUTH'].includes(error.message) ? error.message : 'INTERNAL');
  res.status(502).json({ code: 'GENERIC' });
}
async function authorize(req, res) {
  if (!/^WW[A-F0-9]{32}$/.test(req.params.id)) { res.status(404).json({ code: 'ORDER_UNKNOWN' }); return null; }
  const order = await db.getOrder(req.params.id);
  const secret = (req.get('authorization') || '').replace(/^Bearer /, '');
  if (!order || !/^[a-f0-9]{64}$/.test(secret) || !order.checkoutTokenHash ||
      !crypto.timingSafeEqual(Buffer.from(paypal.tokenHash(secret)), Buffer.from(order.checkoutTokenHash))) {
    res.status(404).json({ code: 'ORDER_UNKNOWN' }); return null;
  }
  return order;
}
app.post('/api/checkout', async (req, res) => {
  if (!CHECKOUT_READY) return res.status(503).json({ code: 'PAYMENT_UNAVAILABLE' });
  try {
    const customer = {};
    for (const [key, limit] of Object.entries({ name: 120, phone: 20, email: 254, address: 300, zip: 10, city: 120, country: 2 })) {
      const value = req.body[key];
      if (typeof value !== 'string' || !value.trim() || value.trim().length > limit) throw new ApiError('FIELDS_MISSING');
      customer[key] = value.trim();
    }
    if (!COUNTRIES.includes(customer.country)) throw new ApiError('COUNTRY_INVALID');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(customer.email)) throw new ApiError('EMAIL_INVALID');
    if (!/^[0-9+\-\s().]{8,20}$/.test(customer.phone)) throw new ApiError('PHONE_INVALID');
    if (!/^[A-Za-z0-9][A-Za-z0-9 \-]{1,9}$/.test(customer.zip)) throw new ApiError('ZIP_INVALID');
    const totals = await computeTotals(req.body.quantity, req.body.promoCode);
    if (!Number.isSafeInteger(totals.totalCents) || totals.totalCents < 100) throw new Error('PRICE_INVALID');
    const checkoutToken = crypto.randomBytes(32).toString('hex');
    const order = { id: 'WW' + crypto.randomBytes(16).toString('hex').toUpperCase(),
      status: 'pending', provider: 'paypal', lang: req.body.lang === 'en' ? 'en' : 'zh',
      createdAt: new Date().toISOString(), ...totals, promoCode: totals.code, customer,
      checkoutTokenHash: paypal.tokenHash(checkoutToken) };
    await db.saveOrder(order);
    const paypalOrderId = await paypal.create(order, PRODUCT_NAME);
    await db.saveOrder(order);
    res.json({ orderId: order.id, paypalOrderId, checkoutToken });
  } catch (e) { errorResponse(res, e); }
});
app.get('/api/orders/:id', async (req, res) => {
  try {
    const order = await authorize(req, res); if (!order) return;
    res.json({ orderId: order.id, status: order.status, totalCents: order.totalCents });
  } catch (e) { errorResponse(res, e); }
});
app.post('/api/orders/:id/capture', async (req, res) => {
  if (!CHECKOUT_READY) return res.status(503).json({ code: 'PAYMENT_UNAVAILABLE' });
  try {
    const order = await authorize(req, res); if (!order) return;
    const status = order.status === 'paid' ? 'paid' : await paypal.capture(order);
    res.json({ orderId: order.id, status });
  } catch (e) { errorResponse(res, e); }
});
app.post('/paypal/webhook', async (req, res) => {
  if (!CHECKOUT_READY) return res.status(503).end();
  try {
    if (!await paypal.webhook(req)) return res.status(401).end();
    res.sendStatus(200);
  } catch (e) {
    console.error('[webhook erreur] Retry required');
    res.sendStatus(500);
  }
});

// Hébergement serverless : l'application est exportée (pas de listen). Sinon (Hostinger, local) on démarre le serveur.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Site sur ${BASE_URL} — paiement : ${CHECKOUT_READY ? 'PayPal ' + paypal.env : 'indisponible'} — stockage : ${USE_REDIS ? 'Redis' : 'fichiers ' + DATA_DIR}`);
  });
}

module.exports = app;

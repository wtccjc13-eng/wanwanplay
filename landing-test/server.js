require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  PORT = 3000,
  BASE_URL = 'http://localhost:3000',
  PRODUCT_NAME = '灣灣好日子 野生動物版',
  PRICE_EUR = '19.90',
  SHIPPING_EUR = '0',
} = process.env;

// Checkout is closed until the replacement payment provider is integrated.
const PRICE_CENTS = Math.round(parseFloat(PRICE_EUR) * 100);       // prix unitaire affiché, en centimes d'euro
const SHIPPING_CENTS = Math.round(parseFloat(SHIPPING_EUR) * 100);  // frais de port par commande, en centimes
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
const USES_FILE = path.join(DATA_DIR, 'promo-uses.json');
if (!USE_REDIS) {
  // Échouer au démarrage plutôt qu'accepter des commandes sans stockage utilisable.
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.accessSync(DATA_DIR, fs.constants.W_OK);
}
if (process.env.VERCEL && !USE_REDIS) console.warn('[stockage] ATTENTION : disque éphémère et pas de base Redis, les commandes seront perdues.');

const readJson = (f, fallback) => {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; }
};
const loadPromos = () => readJson(path.join(__dirname, 'promo-codes.json'), []);

// Existing orders and promo counters are retained; no route modifies payment data.
const db = {
  async promoUses(code) {
    if (USE_REDIS) return parseInt(await redis('GET', `promo:${code}`), 10) || 0;
    return readJson(USES_FILE, {})[code] || 0;
  },
};

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
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/config', (_req, res) => {
  res.json({ productName: PRODUCT_NAME, priceCents: PRICE_CENTS, shippingCents: SHIPPING_CENTS, simulation: false, provider: 'none', checkoutReady: false });
});

app.post('/api/quote', async (req, res) => {
  try {
    res.json({ ok: true, ...(await computeTotals(req.body.quantity, req.body.promoCode)) });
  } catch (e) {
    if (e instanceof ApiError) return res.status(400).json({ code: e.code });
    console.error('[quote erreur]', e.message);
    res.status(500).json({ code: 'GENERIC' });
  }
});

// No order creation, payment redirect, callback or simulated payment is exposed.
app.post('/api/checkout', (_req, res) => {
  res.status(503).json({ code: 'PAYMENT_UNAVAILABLE' });
});

// Hébergement serverless : l'application est exportée (pas de listen). Sinon (Hostinger, local) on démarre le serveur.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Site sur ${BASE_URL} — paiement indisponible — stockage : ${USE_REDIS ? 'Redis' : 'fichiers ' + DATA_DIR}`);
  });
}

module.exports = app;

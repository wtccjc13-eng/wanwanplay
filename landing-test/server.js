require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  PORT = 3000,
  BASE_URL = 'http://localhost:3000',
  NEWEBPAY_MERCHANT_ID = '',
  NEWEBPAY_HASH_KEY = '',
  NEWEBPAY_HASH_IV = '',
  NEWEBPAY_GATEWAY = 'https://ccore.newebpay.com/MPG/mpg_gateway',
  PRODUCT_NAME = '灣灣好日子 野生動物版',
  PRICE_EUR = '19.90',
  SHIPPING_EUR = '0',
  EUR_TWD_RATE = '35',
  // Airwallex : le réglage applicatif « demo » utilise l'API sandbox actuelle.
  AIRWALLEX_CLIENT_ID = '',
  AIRWALLEX_API_KEY = '',
  AIRWALLEX_ENV = 'demo',
  AIRWALLEX_WEBHOOK_SECRET = '',
  AIRWALLEX_COUNTRY_CODE = 'TW',   // pays de la société (requis pour Apple Pay / Google Pay)
  AIRWALLEX_API_BASE = '',          // surcharge optionnelle (tests)
} = process.env;

const AIRWALLEX_ON = !!(AIRWALLEX_CLIENT_ID && AIRWALLEX_API_KEY);
const AW_ENV = AIRWALLEX_ENV === 'prod' ? 'prod' : 'demo';
const AW_BASE = AIRWALLEX_API_BASE || (AW_ENV === 'prod' ? 'https://api.airwallex.com' : 'https://api.sandbox.airwallex.com');
const NEWEBPAY_ON = !!(NEWEBPAY_MERCHANT_ID && NEWEBPAY_HASH_KEY && NEWEBPAY_HASH_IV);
// Un seul moyen de paiement actif : Airwallex en priorité, puis NewebPay, sinon simulation
const PROVIDER = AIRWALLEX_ON ? 'airwallex' : NEWEBPAY_ON ? 'newebpay' : 'simulation';
const SIMULATION = PROVIDER === 'simulation';
// En production Airwallex, ne jamais basculer vers de faux paiements si une clé manque.
const CHECKOUT_READY = AW_ENV !== 'prod' || (AIRWALLEX_ON && !!AIRWALLEX_WEBHOOK_SECRET);
const PRICE_CENTS = Math.round(parseFloat(PRICE_EUR) * 100);       // prix unitaire affiché, en centimes d'euro
const SHIPPING_CENTS = Math.round(parseFloat(SHIPPING_EUR) * 100);  // frais de port par commande, en centimes
const RATE = parseFloat(EUR_TWD_RATE);                              // 1 EUR = RATE TWD (taux fixe, à mettre à jour)

// Pays de livraison acceptés (UE + Suisse, Royaume-Uni, Norvège)
const COUNTRIES = ['FR','BE','CH','LU','DE','NL','IT','ES','PT','GB','IE','AT','DK','SE','FI','NO','PL','CZ','SK','HU','SI','HR','RO','BG','GR','CY','MT','EE','LV','LT'];

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
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
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
const writeJson = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2));
const loadPromos = () => readJson(path.join(__dirname, 'promo-codes.json'), []);

const db = {
  async getOrder(id) {
    if (USE_REDIS) { const v = await redis('GET', `order:${id}`); return v ? JSON.parse(v) : null; }
    return readJson(ORDERS_FILE, {})[id] || null;
  },
  async saveOrder(order) {
    if (USE_REDIS) { await redis('SET', `order:${order.id}`, JSON.stringify(order)); return; }
    const orders = readJson(ORDERS_FILE, {}); orders[order.id] = order; writeJson(ORDERS_FILE, orders);
  },
  async promoUses(code) {
    if (USE_REDIS) return parseInt(await redis('GET', `promo:${code}`), 10) || 0;
    return readJson(USES_FILE, {})[code] || 0;
  },
  // Le paiement et le compteur promo sont enregistrés ensemble, sans verrou
  // permanent qui empêcherait une relivraison du webhook après une panne.
  async commitPaid(order) {
    if (USE_REDIS) {
      const script = `
        local raw = redis.call('GET', KEYS[1])
        if not raw then return -1 end
        local current = cjson.decode(raw)
        if current.status == 'paid' then return 0 end
        local uses = nil
        if current.promoCode and current.promoCode ~= cjson.null and current.promoCode ~= '' then
          uses = tonumber(redis.call('GET', KEYS[2]) or '0')
          if not uses then return redis.error_reply('Invalid promo counter') end
        end
        current.status = 'paid'
        current.paidAt = ARGV[1]
        local encoded = cjson.encode(current)
        if uses then redis.call('SET', KEYS[2], tostring(uses + 1)) end
        redis.call('SET', KEYS[1], encoded)
        return 1
      `;
      return redis('EVAL', script, 2, `order:${order.id}`,
        order.promoCode ? `promo:${order.promoCode}` : `order:${order.id}`, order.paidAt);
    }
    // Pas d'attente entre lecture et écriture pour la simulation locale.
    const orders = readJson(ORDERS_FILE, {}), current = orders[order.id];
    if (!current) return -1;
    if (current.status === 'paid') return 0;
    current.status = 'paid'; current.paidAt = order.paidAt;
    if (current.promoCode) {
      const uses = readJson(USES_FILE, {});
      uses[current.promoCode] = (uses[current.promoCode] || 0) + 1;
      writeJson(USES_FILE, uses);
    }
    writeJson(ORDERS_FILE, orders);
    return 1;
  },
};

const normLang = (l) => (l === 'en' ? 'en' : 'zh');

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

// Le montant réellement envoyé à NewebPay : TWD entier, calculé ici uniquement
const toTwd = (cents) => Math.max(1, Math.round((cents / 100) * RATE));

async function computeTotals(quantity, promoCode) {
  const qty = Math.min(Math.max(parseInt(quantity, 10) || 1, 1), 10);
  const subtotalCents = PRICE_CENTS * qty;
  const { code, discountCents } = await promoDiscount(promoCode, subtotalCents);
  const totalCents = subtotalCents - discountCents + SHIPPING_CENTS;
  return { qty, code, subtotalCents, discountCents, shippingCents: SHIPPING_CENTS, totalCents, totalTwd: toTwd(totalCents) };
}

// ---------- NewebPay (MPG v2.0) ----------
const aesEncrypt = (qs) => {
  const c = crypto.createCipheriv('aes-256-cbc', NEWEBPAY_HASH_KEY, NEWEBPAY_HASH_IV);
  return c.update(qs, 'utf8', 'hex') + c.final('hex');
};
const aesDecrypt = (hex) => {
  const d = crypto.createDecipheriv('aes-256-cbc', NEWEBPAY_HASH_KEY, NEWEBPAY_HASH_IV);
  d.setAutoPadding(true);
  return d.update(hex, 'hex', 'utf8') + d.final('utf8');
};
const shaOf = (tradeInfo) =>
  crypto
    .createHash('sha256')
    .update(`HashKey=${NEWEBPAY_HASH_KEY}&${tradeInfo}&HashIV=${NEWEBPAY_HASH_IV}`)
    .digest('hex')
    .toUpperCase();

function buildTradeInfo(order) {
  const params = new URLSearchParams({
    MerchantID: NEWEBPAY_MERCHANT_ID,
    RespondType: 'JSON',
    TimeStamp: String(Math.floor(Date.now() / 1000)),
    Version: '2.0',
    LangType: order.lang === 'en' ? 'en' : 'zh-tw',
    MerchantOrderNo: order.id,
    Amt: String(order.totalTwd),   // NewebPay (MPG) : montant en TWD, entier
    ItemDesc: `${PRODUCT_NAME} x${order.qty}`.slice(0, 50),
    Email: order.customer.email,
    LoginType: '0',
    EmailModify: '0',
    ReturnURL: `${BASE_URL}/payment/return`,
    NotifyURL: `${BASE_URL}/payment/notify`,
    ClientBackURL: `${BASE_URL}/?lang=${order.lang}#order`,
    CREDIT: '1',
  });
  return aesEncrypt(params.toString());
}

// ---------- Validation d'une commande payée ----------
// paid = { twd } pour NewebPay, { eurMajor, currency, intentId } pour Airwallex ; rien = simulation
async function markPaid(orderId, paid = {}) {
  const order = await db.getOrder(orderId);
  if (!order) return { ok: false, reason: 'commande inconnue' };
  if (order.status === 'paid') return { ok: true, already: true };
  if (paid.twd !== undefined && Number(paid.twd) !== order.totalTwd) return { ok: false, reason: 'montant différent' };
  if (paid.eurMajor !== undefined && (Math.round(Number(paid.eurMajor) * 100) !== order.totalCents || paid.currency !== 'EUR'))
    return { ok: false, reason: 'montant différent' };
  if (paid.intentId !== undefined && (order.provider !== 'airwallex' || order.airwallexIntentId !== paid.intentId))
    return { ok: false, reason: 'PaymentIntent différent' };
  order.paidAt = new Date().toISOString();
  const committed = await db.commitPaid(order);
  if (committed === -1) return { ok: false, reason: 'commande inconnue' };
  if (committed === 0) return { ok: true, already: true };
  console.log(`[commande payée] ${orderId} — ${(order.totalCents / 100).toFixed(2)} € (${order.provider || PROVIDER})`);
  return { ok: true };
}
const orderLang = async (id) => ((await db.getOrder(id)) || {}).lang || 'zh';

// ---------- Airwallex (Hosted Payment Page) ----------
let awToken = { value: '', exp: 0 };
async function awAuth() {
  if (awToken.value && awToken.exp > Date.now() + 60_000) return awToken.value;
  const r = await fetch(`${AW_BASE}/api/v1/authentication/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-client-id': AIRWALLEX_CLIENT_ID, 'x-api-key': AIRWALLEX_API_KEY },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.token) throw new Error('airwallex login ' + r.status);
  awToken = { value: j.token, exp: j.expires_at ? new Date(j.expires_at).getTime() : Date.now() + 25 * 60_000 };
  return awToken.value;
}
async function awFetch(method, urlPath, body) {
  const r = await fetch(`${AW_BASE}${urlPath}`, {
    method,
    headers: { Authorization: `Bearer ${await awAuth()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`airwallex ${method} ${urlPath} ${r.status} ${j.code || ''} ${j.message || ''}`);
  return j;
}
// Airwallex : montants en unités principales (19.90 pour 19,90 €), jamais en centimes
const eurMajor = (cents) => Number((cents / 100).toFixed(2));
async function createAirwallexIntent(order) {
  const [firstName, ...rest] = order.customer.name.split(/\s+/);
  const pi = await awFetch('POST', '/api/v1/pa/payment_intents/create', {
    request_id: crypto.randomUUID(),
    amount: eurMajor(order.totalCents),
    currency: 'EUR',
    merchant_order_id: order.id,
    descriptor: 'WANWAN PLAY',
    return_url: `${BASE_URL}/success.html?lang=${order.lang}&order=${order.id}`,
    customer: { email: order.customer.email, first_name: firstName, last_name: rest.join(' ') || firstName },
    order: { products: [{ name: PRODUCT_NAME.slice(0, 100), quantity: order.qty, unit_price: eurMajor(PRICE_CENTS) }] },
  });
  return { id: pi.id, clientSecret: pi.client_secret };
}
// Signature webhook : HMAC-SHA256(secret, x-timestamp + corps brut), en hexadécimal
function awSignatureOk(req) {
  if (!AIRWALLEX_WEBHOOK_SECRET) return false;
  const ts = req.get('x-timestamp') || '', sig = req.get('x-signature') || '';
  const expected = crypto.createHmac('sha256', AIRWALLEX_WEBHOOK_SECRET).update(ts + (req.rawBody || '')).digest('hex');
  const a = Buffer.from(expected), b = Buffer.from(sig);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- App ----------
const app = express();
app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); } }));
app.use(express.urlencoded({ extended: false }));
app.get('/.well-known/apple-developer-merchantid-domain-association', (_req, res) => {
  res.type('application/octet-stream').sendFile(path.join(__dirname, 'public', '.well-known', 'apple-developer-merchantid-domain-association'));
});
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/config', (_req, res) => {
  res.json({ productName: PRODUCT_NAME, priceCents: PRICE_CENTS, shippingCents: SHIPPING_CENTS, simulation: SIMULATION, provider: PROVIDER, airwallexEnv: AW_ENV, checkoutReady: CHECKOUT_READY });
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

// Crée la commande puis renvoie le formulaire auto-soumis vers NewebPay (ou la page de simulation)
app.post('/api/checkout', async (req, res) => {
  try {
    if (!CHECKOUT_READY) return res.status(503).json({ code: 'PAYMENT_UNAVAILABLE' });
    // Une instance Vercel ne doit jamais encaisser avec un stockage éphémère.
    if (process.env.VERCEL && !USE_REDIS) return res.status(503).json({ code: 'GENERIC' });
    const { name, phone, email, address, zip, city, country, quantity, promoCode } = req.body;
    const lang = normLang(req.body.lang);
    if (![name, phone, email, address, zip, city].every((v) => v && String(v).trim()))
      throw new ApiError('FIELDS_MISSING');
    if (!COUNTRIES.includes(country)) throw new ApiError('COUNTRY_INVALID');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ApiError('EMAIL_INVALID');
    if (!/^[0-9+\-\s().]{8,20}$/.test(phone)) throw new ApiError('PHONE_INVALID');
    if (!/^[A-Za-z0-9][A-Za-z0-9 \-]{1,9}$/.test(String(zip).trim())) throw new ApiError('ZIP_INVALID');

    const t = await computeTotals(quantity, promoCode);
    const id = 'WW' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(2).toString('hex').toUpperCase();
    const order = {
      id,
      status: 'pending',
      lang,
      createdAt: new Date().toISOString(),
      qty: t.qty,
      promoCode: t.code,
      subtotalCents: t.subtotalCents,
      discountCents: t.discountCents,
      shippingCents: t.shippingCents,
      totalCents: t.totalCents,     // prix affiché au client, en centimes d'euro
      rateUsed: RATE,               // taux EUR→TWD figé au moment de la commande
      totalTwd: t.totalTwd,         // montant envoyé à NewebPay (inutilisé avec Airwallex)
      provider: PROVIDER,
      customer: {
        name: String(name).trim(), phone: String(phone).trim(), email: String(email).trim(),
        address: String(address).trim(), zip: String(zip).trim(), city: String(city).trim(), country,
      },
    };
    await db.saveOrder(order);

    if (SIMULATION) return res.json({ redirect: `/pay/mock/${id}` });

    if (PROVIDER === 'airwallex') {
      const intent = await createAirwallexIntent(order);
      order.airwallexIntentId = intent.id;
      await db.saveOrder(order);
      return res.json({
        airwallex: {
          env: AW_ENV === 'prod' ? 'prod' : 'sandbox',
          intentId: intent.id,
          clientSecret: intent.clientSecret,
          currency: 'EUR',
          countryCode: AIRWALLEX_COUNTRY_CODE,
          shopperCountryCode: order.customer.country,
          locale: lang === 'en' ? 'en' : 'zh',
          successUrl: `${BASE_URL}/success.html?lang=${lang}&order=${id}`,
          failUrl: `${BASE_URL}/cancel.html?lang=${lang}`,
        },
      });
    }

    const tradeInfo = buildTradeInfo(order);
    res.json({
      form: {
        action: NEWEBPAY_GATEWAY,
        fields: { MerchantID: NEWEBPAY_MERCHANT_ID, TradeInfo: tradeInfo, TradeSha: shaOf(tradeInfo), Version: '2.0' },
      },
    });
  } catch (e) {
    if (e instanceof ApiError) return res.status(400).json({ code: e.code });
    console.error('[checkout erreur]', e.message);
    res.status(500).json({ code: 'GENERIC' });
  }
});

// Retour navigateur : affichage seulement, ne valide JAMAIS la commande
app.post('/payment/return', async (req, res) => {
  try {
    if (shaOf(req.body.TradeInfo) !== req.body.TradeSha) throw new Error('signature');
    const data = JSON.parse(aesDecrypt(req.body.TradeInfo));
    const id = data.Result?.MerchantOrderNo || '';
    const lang = await orderLang(id);
    const ok = data.Status === 'SUCCESS';
    res.redirect(`/${ok ? 'success' : 'cancel'}.html?lang=${lang}&order=${encodeURIComponent(id)}`);
  } catch {
    res.redirect('/cancel.html');
  }
});

// Notification serveur à serveur : seule source de vérité du paiement
app.post('/payment/notify', async (req, res) => {
  try {
    if (shaOf(req.body.TradeInfo) !== req.body.TradeSha) return res.status(400).send('bad signature');
    const data = JSON.parse(aesDecrypt(req.body.TradeInfo));
    if (data.Status === 'SUCCESS') {
      const r = await markPaid(data.Result.MerchantOrderNo, { twd: data.Result.Amt });
      if (!r.ok) console.warn('[notify refusée]', data.Result.MerchantOrderNo, r.reason);
    }
    res.send('OK');
  } catch (e) {
    console.error('[notify erreur]', e.message);
    res.status(400).send('error');
  }
});

// Webhook Airwallex : seule source de vérité du paiement. On revérifie toujours le PaymentIntent via l'API.
app.post('/airwallex/webhook', async (req, res) => {
  try {
    if (!awSignatureOk(req)) return res.status(401).send('bad signature');
    const ev = req.body || {};
    if (ev.name === 'payment_intent.succeeded') {
      const intentId = ev.data?.object?.id;
      const pi = await awFetch('GET', `/api/v1/pa/payment_intents/${encodeURIComponent(intentId)}`);
      if (pi.status === 'SUCCEEDED') {
        const r = await markPaid(pi.merchant_order_id, { eurMajor: pi.amount, currency: pi.currency, intentId: pi.id });
        if (!r.ok) console.warn('[webhook refusé]', pi.merchant_order_id, r.reason);
      }
    }
    res.send('OK');
  } catch (e) {
    console.error('[webhook erreur]', e.message);
    res.status(500).send('error');   // Airwallex réessaiera
  }
});

// Mode simulation (aucun compte de paiement requis)
const MOCK = {
  zh: { title: '模擬付款（藍新金流）', order: '訂單編號', amount: '金額', ok: '模擬付款成功', cancel: '取消', note: '測試模式：不會有任何扣款。' },
  en: { title: 'Simulated payment (NewebPay)', order: 'Order', amount: 'Amount', ok: 'Simulate a successful payment', cancel: 'Cancel', note: 'Test mode: no money is charged.' },
};
app.get('/pay/mock/:id', async (req, res) => {
  const order = await db.getOrder(req.params.id);
  if (!SIMULATION || AW_ENV === 'prod' || !order) return res.status(404).send('Not found');
  const m = MOCK[order.lang] || MOCK.zh;
  res.send(`<!doctype html><html lang="${order.lang === 'en' ? 'en' : 'zh-TW'}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${m.title}</title>
<body style="font-family:system-ui,'Noto Sans TC',sans-serif;max-width:420px;margin:60px auto;padding:0 20px">
<h2>${m.title}</h2>
<p>${m.order}：<b>${order.id}</b><br>${m.amount}：<b>€${(order.totalCents / 100).toFixed(2)}</b> → <b>NT$${order.totalTwd.toLocaleString('en-US')}</b></p>
<p style="color:#6b6483;font-size:.9rem">${m.note}</p>
<form method="post" action="/pay/mock/${order.id}/ok"><button style="padding:12px 20px">${m.ok}</button></form>
<form method="get" action="/cancel.html" style="margin-top:12px"><input type="hidden" name="lang" value="${order.lang}"><button style="padding:12px 20px">${m.cancel}</button></form>`);
});
app.post('/pay/mock/:id/ok', async (req, res) => {
  if (!SIMULATION || AW_ENV === 'prod') return res.status(404).end();
  const r = await markPaid(req.params.id);
  const lang = await orderLang(req.params.id);
  res.redirect(r.ok ? `/success.html?lang=${lang}&order=${req.params.id}` : `/cancel.html?lang=${lang}`);
});

// Hébergement serverless : l'application est exportée (pas de listen). Sinon (Hostinger, local) on démarre le serveur.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Site sur ${BASE_URL} — paiement : ${PROVIDER.toUpperCase()}${PROVIDER === 'airwallex' ? ' (' + AW_ENV + ')' : ''} — stockage : ${USE_REDIS ? 'Redis' : 'fichiers ' + DATA_DIR}`);
  });
}

module.exports = app;

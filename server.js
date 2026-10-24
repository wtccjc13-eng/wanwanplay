require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

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
} = process.env;

const SIMULATION = !(NEWEBPAY_MERCHANT_ID && NEWEBPAY_HASH_KEY && NEWEBPAY_HASH_IV);
const PRICE_CENTS = Math.round(parseFloat(PRICE_EUR) * 100);       // prix unitaire affiché, en centimes d'euro
const SHIPPING_CENTS = Math.round(parseFloat(SHIPPING_EUR) * 100);  // frais de port par commande, en centimes
const RATE = parseFloat(EUR_TWD_RATE);                              // 1 EUR = RATE TWD (taux fixe, à mettre à jour)

// Pays de livraison acceptés (UE + Suisse, Royaume-Uni, Norvège)
const COUNTRIES = ['FR','BE','CH','LU','DE','NL','IT','ES','PT','GB','IE','AT','DK','SE','FI','NO','PL','CZ','SK','HU','SI','HR','RO','BG','GR','CY','MT','EE','LV','LT'];

// ---------- Stockage fichier (suffisant pour un test) ----------
const DATA_DIR = path.join(__dirname, 'data');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const USES_FILE = path.join(DATA_DIR, 'promo-uses.json');
fs.mkdirSync(DATA_DIR, { recursive: true });

const readJson = (f, fallback) => {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; }
};
const writeJson = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2));
const loadPromos = () => readJson(path.join(__dirname, 'promo-codes.json'), []);

const normLang = (l) => (l === 'en' ? 'en' : 'zh');

// Erreur à code stable : le navigateur traduit le message selon la langue
class ApiError extends Error {
  constructor(code) { super(code); this.code = code; }
}

// ---------- Codes promo : toujours recalculés côté serveur ----------
function promoDiscount(rawCode, subtotalCents) {
  const code = String(rawCode || '').trim().toUpperCase();
  if (!code) return { code: null, discountCents: 0 };
  const promo = loadPromos().find((p) => p.code.toUpperCase() === code);
  if (!promo) throw new ApiError('PROMO_UNKNOWN');
  if (promo.expires && new Date(promo.expires + 'T23:59:59') < new Date()) throw new ApiError('PROMO_EXPIRED');
  const uses = readJson(USES_FILE, {});
  if (promo.maxUses && (uses[promo.code] || 0) >= promo.maxUses) throw new ApiError('PROMO_EXHAUSTED');
  let discountCents = 0;
  if (promo.type === 'percent') discountCents = Math.round((subtotalCents * promo.value) / 100);
  if (promo.type === 'amount_eur') discountCents = Math.round(promo.value * 100);
  discountCents = Math.max(0, Math.min(discountCents, subtotalCents - 100)); // jamais gratuit (min. 1 €)
  return { code: promo.code, discountCents };
}

// Le montant réellement envoyé à NewebPay : TWD entier, calculé ici uniquement
const toTwd = (cents) => Math.max(1, Math.round((cents / 100) * RATE));

function computeTotals(quantity, promoCode) {
  const qty = Math.min(Math.max(parseInt(quantity, 10) || 1, 1), 10);
  const subtotalCents = PRICE_CENTS * qty;
  const { code, discountCents } = promoDiscount(promoCode, subtotalCents);
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
function markPaid(orderId, paidTwd) {
  const orders = readJson(ORDERS_FILE, {});
  const order = orders[orderId];
  if (!order) return { ok: false, reason: 'commande inconnue' };
  if (order.status === 'paid') return { ok: true, already: true };
  if (paidTwd !== undefined && Number(paidTwd) !== order.totalTwd)
    return { ok: false, reason: 'montant différent' };
  order.status = 'paid';
  order.paidAt = new Date().toISOString();
  if (order.promoCode) {
    const uses = readJson(USES_FILE, {});
    uses[order.promoCode] = (uses[order.promoCode] || 0) + 1;
    writeJson(USES_FILE, uses);
  }
  writeJson(ORDERS_FILE, orders);
  console.log(`[commande payée] ${orderId} — ${order.customer.email} — ${(order.totalCents / 100).toFixed(2)} € (${order.totalTwd} TWD)`);
  return { ok: true };
}
const orderLang = (id) => (readJson(ORDERS_FILE, {})[id] || {}).lang || 'zh';

// ---------- App ----------
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/config', (_req, res) => {
  res.json({ productName: PRODUCT_NAME, priceCents: PRICE_CENTS, shippingCents: SHIPPING_CENTS, simulation: SIMULATION });
});

app.post('/api/quote', (req, res) => {
  try {
    res.json({ ok: true, ...computeTotals(req.body.quantity, req.body.promoCode) });
  } catch (e) {
    if (e instanceof ApiError) return res.status(400).json({ code: e.code });
    throw e;
  }
});

// Crée la commande puis renvoie le formulaire auto-soumis vers NewebPay (ou la page de simulation)
app.post('/api/checkout', (req, res) => {
  try {
    const { name, phone, email, address, zip, city, country, quantity, promoCode } = req.body;
    const lang = normLang(req.body.lang);
    if (![name, phone, email, address, zip, city].every((v) => v && String(v).trim()))
      throw new ApiError('FIELDS_MISSING');
    if (!COUNTRIES.includes(country)) throw new ApiError('COUNTRY_INVALID');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ApiError('EMAIL_INVALID');
    if (!/^[0-9+\-\s().]{8,20}$/.test(phone)) throw new ApiError('PHONE_INVALID');
    if (!/^[A-Za-z0-9][A-Za-z0-9 \-]{1,9}$/.test(String(zip).trim())) throw new ApiError('ZIP_INVALID');

    const t = computeTotals(quantity, promoCode);
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
      totalTwd: t.totalTwd,         // montant envoyé à NewebPay
      customer: {
        name: String(name).trim(), phone: String(phone).trim(), email: String(email).trim(),
        address: String(address).trim(), zip: String(zip).trim(), city: String(city).trim(), country,
      },
    };
    const orders = readJson(ORDERS_FILE, {});
    orders[id] = order;
    writeJson(ORDERS_FILE, orders);

    if (SIMULATION) return res.json({ redirect: `/pay/mock/${id}` });

    const tradeInfo = buildTradeInfo(order);
    res.json({
      form: {
        action: NEWEBPAY_GATEWAY,
        fields: { MerchantID: NEWEBPAY_MERCHANT_ID, TradeInfo: tradeInfo, TradeSha: shaOf(tradeInfo), Version: '2.0' },
      },
    });
  } catch (e) {
    if (e instanceof ApiError) return res.status(400).json({ code: e.code });
    throw e;
  }
});

// Retour navigateur : affichage seulement, ne valide JAMAIS la commande
app.post('/payment/return', (req, res) => {
  try {
    if (shaOf(req.body.TradeInfo) !== req.body.TradeSha) throw new Error('signature');
    const data = JSON.parse(aesDecrypt(req.body.TradeInfo));
    const id = data.Result?.MerchantOrderNo || '';
    const lang = orderLang(id);
    const ok = data.Status === 'SUCCESS';
    res.redirect(`/${ok ? 'success' : 'cancel'}.html?lang=${lang}&order=${encodeURIComponent(id)}`);
  } catch {
    res.redirect('/cancel.html');
  }
});

// Notification serveur à serveur : seule source de vérité du paiement
app.post('/payment/notify', (req, res) => {
  try {
    if (shaOf(req.body.TradeInfo) !== req.body.TradeSha) return res.status(400).send('bad signature');
    const data = JSON.parse(aesDecrypt(req.body.TradeInfo));
    if (data.Status === 'SUCCESS') {
      const r = markPaid(data.Result.MerchantOrderNo, data.Result.Amt);
      if (!r.ok) console.warn('[notify refusée]', data.Result.MerchantOrderNo, r.reason);
    }
    res.send('OK');
  } catch (e) {
    console.error('[notify erreur]', e.message);
    res.status(400).send('error');
  }
});

// Mode simulation (aucun compte NewebPay requis)
const MOCK = {
  zh: { title: '模擬付款（藍新金流）', order: '訂單編號', amount: '金額', ok: '模擬付款成功', cancel: '取消', note: '測試模式：不會有任何扣款。' },
  en: { title: 'Simulated payment (NewebPay)', order: 'Order', amount: 'Amount', ok: 'Simulate a successful payment', cancel: 'Cancel', note: 'Test mode: no money is charged.' },
};
app.get('/pay/mock/:id', (req, res) => {
  const order = readJson(ORDERS_FILE, {})[req.params.id];
  if (!SIMULATION || !order) return res.status(404).send('Not found');
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
app.post('/pay/mock/:id/ok', (req, res) => {
  if (!SIMULATION) return res.status(404).end();
  const r = markPaid(req.params.id);
  const lang = orderLang(req.params.id);
  res.redirect(r.ok ? `/success.html?lang=${lang}&order=${req.params.id}` : `/cancel.html?lang=${lang}`);
});

app.listen(PORT, () => {
  console.log(`Site de test sur ${BASE_URL} — mode ${SIMULATION ? 'SIMULATION (pas de clés NewebPay)' : 'NEWEBPAY TEST'} — 1 EUR = ${RATE} TWD`);
});

module.exports = { aesEncrypt, aesDecrypt, shaOf };

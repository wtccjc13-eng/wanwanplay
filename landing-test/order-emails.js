const nodemailer = require('nodemailer');
const crypto = require('node:crypto');
const validEmail = value => typeof value === 'string' && value.length <= 254 && /^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/.test(value);
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const money = cents => '€' + (Number(cents || 0) / 100).toFixed(2);
function message(order, kind, baseUrl, { sandboxBuyerDirect = false } = {}) {
  const zh = kind === 'buyer' && order.lang === 'zh', team = kind === 'team';
  const customer = order.customer || {}, sandbox = order.paypalEnv === 'sandbox';
  const subject = (sandbox ? '[SANDBOX TEST] ' : '') + (team ? 'New paid order · ' : zh ? '灣灣好日子｜訂單付款確認 ' : 'WanWan Play · Order confirmed ') + order.id;
  const heading = team ? 'A new adventure to prepare.' : zh ? '感謝您的訂購！' : 'Thank you for your order!';
  const intro = team ? 'Payment is confirmed. Review this order in the backoffice before fulfillment.' : zh ? '我們已收到您的付款。以下是您的訂單明細。' : 'We have received your payment. Here are your order details.';
  const address = [customer.name, customer.address, [customer.zip, customer.city].filter(Boolean).join(' '), customer.state, customer.country].filter(Boolean).join('\n');
  const facts = [[zh ? '訂單編號' : 'Order reference', order.id], [zh ? '商品' : 'Product', 'WanWan Play · 36 cards / 36 張卡牌'],
    [zh ? '數量' : 'Quantity', order.qty], [zh ? '小計' : 'Subtotal', money(order.subtotalCents)], [zh ? '折扣' : 'Discount', money(order.discountCents)],
    [zh ? '優惠碼' : 'Promo code', order.promoCode || '—'], [zh ? '運費' : 'Shipping', money(order.shippingCents)], [zh ? '付款總額' : 'Total paid', money(order.totalCents)]];
  if (team) facts.push(['Buyer email', customer.email || 'Not returned by PayPal'], ['Phone', customer.phone || 'Not returned by PayPal'], ['PayPal capture', order.paypalCaptureId || '—']);
  const attention = order.deliveryStatus === 'needs_attention' ? (zh ? '配送資料需要確認，請回覆此郵件與我們聯絡。' : 'Delivery details need review. Please reply to this email so we can confirm them before shipping.') : '';
  const footer = zh ? '如有任何問題，請回覆此郵件，並提供訂單編號。' : 'Questions? Reply to this email and include your order reference.';
  const link = team ? baseUrl + '/backoffice/' : '';
  const sandboxNote = sandbox ? 'SANDBOX TEST — no live purchase.' + (sandboxBuyerDirect ? '' : ' Buyer confirmation is redirected to the team mailbox.') : '';
  const text = [sandboxNote, heading, intro,
    ...facts.map(([key, value]) => key + ': ' + value), zh ? '配送地址：' : 'Delivery address:', address || 'Requires review', attention, link, footer].filter(Boolean).join('\n\n');
  const html = '<!doctype html><html lang="' + (zh ? 'zh-Hant' : 'en') + '"><body style="margin:0;background:#f7f8f2;color:#233d34;font-family:Arial,sans-serif"><main style="max-width:600px;margin:24px auto;background:white;border-radius:16px;padding:32px">' +
    '<p style="color:#245e47;font-weight:bold">WANWAN PLAY · 灣灣好日子</p>' + (sandbox ? '<p><strong>' + escape(sandboxNote) + '</strong></p>' : '') +
    '<h1 style="font-size:28px">' + escape(heading) + '</h1><p>' + escape(intro) + '</p><table style="width:100%;border-collapse:collapse">' +
    facts.map(([key, value]) => '<tr><th style="padding:10px 0;text-align:left;font-weight:normal;border-bottom:1px solid #e0e7de">' + escape(key) + '</th><td style="padding:10px;text-align:right;border-bottom:1px solid #e0e7de">' + escape(value) + '</td></tr>').join('') +
    '</table><h2 style="font-size:18px">' + (zh ? '配送地址' : 'Delivery address') + '</h2><p style="white-space:pre-line">' + escape(address || 'Requires review') + '</p>' +
    (attention ? '<p>' + escape(attention) + '</p>' : '') + (team ? '<p><a href="' + escape(link) + '" style="color:#245e47">Open backoffice →</a></p>' : '') + '<p>' + escape(footer) + '</p></main></body></html>';
  return { subject, text, html };
}

module.exports = function orderEmails(db, { env = process.env, createTransport = nodemailer.createTransport, now = Date.now } = {}) {
  const from = env.MAIL_FROM || 'play@wanwanplay.com', team = env.MAIL_TO || 'play@wanwanplay.com';
  const port = Number(env.SMTP_PORT || 465), enabled = env.MAIL_ENABLED === 'true';
  let baseUrl = ''; try { const url = new URL(env.BASE_URL || 'https://wanwanplay.com'); if (url.protocol === 'https:' || env.NODE_ENV === 'test' && url.protocol === 'http:') baseUrl = url.origin; } catch {}
  const ready = enabled && validEmail(from) && validEmail(team) && !!env.SMTP_HOST && [465, 587].includes(port) &&
    validEmail(env.SMTP_USER) && !!env.SMTP_PASSWORD && !!baseUrl;
  const sandboxEnabled = env.MAIL_SANDBOX_ENABLED === 'true';
  const sandboxBuyerDirect = env.MAIL_SANDBOX_BUYER_ENABLED === 'true';
  const buyerUsesCustomerEmail = order => order.paypalEnv === 'live' || order.paypalEnv === 'sandbox' && sandboxBuyerDirect;
  let transport, timer, running = false;
  const eligible = order => order.status === 'paid' && order.notificationVersion === 1 && order.provider === 'paypal' && ['live', 'sandbox'].includes(order.paypalEnv);
  const allowed = order => eligible(order) && (order.paypalEnv === 'live' || sandboxEnabled);
  async function run() {
    if (!ready || running) return;
    running = true;
    try {
      const orders = (await db.listOrders()).filter(order => order && /^WW[A-Z0-9]{1,64}$/.test(order.id || '') && allowed(order));
      const records = await db.getNotifications(orders.map(order => order.id));
      for (const order of orders) {
        for (const kind of ['buyer', 'team']) {
          const to = kind === 'buyer' && buyerUsesCustomerEmail(order) ? order.customer?.email : team;
          if (!validEmail(to)) continue;
          const key = order.id + ':' + kind, token = crypto.randomUUID(), record = records[key];
          if (record && (['sent', 'uncertain'].includes(record.status) || record.status === 'sending' && record.leaseUntil > now() ||
              record.status === 'failed' && (record.attempts >= 5 || record.nextAttemptAt > now()))) continue;
          if (!await db.claimNotification(key, token, now(), to)) continue;
          let patch;
          try {
            if (!transport) transport = createTransport({ host: env.SMTP_HOST, port, secure: port === 465, requireTLS: true,
              auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD }, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000,
              logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true });
            const info = await transport.sendMail({ from: { name: 'WanWan Play', address: from }, replyTo: { address: from }, to: { address: to },
              messageId: '<' + order.id + '.' + kind + '@' + from.split('@')[1] + '>', ...message(order, kind, baseUrl, { sandboxBuyerDirect }) });
            if (!info.accepted?.some(address => String(address).toLowerCase() === to.toLowerCase())) {
              patch = { status: 'failed', error: 'REJECTED', nextAttemptAt: now() + 300000 };
            } else patch = { status: 'sent', sentAt: now(), error: null };
          } catch (error) {
            // After an ambiguous DATA/connection failure the server may already
            // have accepted the message. Do not automatically resend it.
            const rejected = Number(error.responseCode) >= 400;
            const beforeData = ['CONN', 'AUTH', 'MAIL FROM', 'RCPT TO'].includes(error.command) || ['EDNS', 'EAUTH'].includes(error.code);
            patch = rejected || beforeData ? { status: 'failed', error: rejected ? 'SMTP_REJECTED' : 'SMTP_CONNECTION', nextAttemptAt: now() + 300000 }
              : { status: 'uncertain', error: 'DELIVERY_UNCERTAIN' };
          }
          await db.finishNotification(key, token, { ...patch, updatedAt: now() });
        }
      }
    } catch { console.error('[order emails] Storage unavailable; retry on next cycle.'); }
    finally { running = false; }
  }
  return {
    ready, run,
    start() { if (ready && !timer) { timer = setInterval(run, 15000); timer.unref(); void run(); } },
    stop() { clearInterval(timer); timer = null; transport?.close?.(); },
    async statuses(orders) {
      const records = await db.getNotifications(orders.map(order => order.id));
      return Object.fromEntries(orders.map(order => [order.id, { ready, buyer: status(order, 'buyer', records), team: status(order, 'team', records) }]));
    },
    async retry(order) {
      if (!ready || !allowed(order)) return false;
      for (const kind of ['buyer', 'team']) await db.retryNotification(order.id + ':' + kind);
      void run(); return true;
    },
  };
  function status(order, kind, records) {
    const record = records[order.id + ':' + kind];
    if (record) return { status: record.status, attempts: record.attempts, sentAt: record.sentAt || null, nextAttemptAt: record.nextAttemptAt || null, error: record.error || null };
    return { status: !eligible(order) ? 'not_scheduled' : !allowed(order) ? 'sandbox_off' : kind === 'buyer' && buyerUsesCustomerEmail(order) && !validEmail(order.customer?.email) ? 'missing_email' : !ready ? 'not_configured' : 'queued', attempts: 0 };
  }
};
module.exports.message = message;
module.exports.validEmail = validEmail;

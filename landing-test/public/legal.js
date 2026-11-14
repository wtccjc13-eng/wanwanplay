'use strict';
// The supplied legal text is English. Preserve the store's language on return.
let language = new URLSearchParams(location.search).get('lang');
if (!['en', 'zh'].includes(language)) {
  try { language = localStorage.getItem('ww-lang'); } catch {}
}
language = language === 'zh' ? 'zh' : 'en';
document.querySelectorAll('[data-home-link]').forEach(link => { link.href = '/?lang=' + language; });
if (language === 'zh') document.querySelectorAll('[data-back-label]').forEach(link => { link.textContent = '← 返回商店'; });
// Keep displayed prices in step with the server configuration. Static hosts use the supplied defaults.
fetch('/api/config', { cache: 'no-store' }).then(response => {
  if (!response.ok) throw new Error('Configuration unavailable');
  return response.json();
}).then(config => {
  const money = value => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(value / 100);
  if (Number.isSafeInteger(config.priceCents) && config.priceCents >= 100)
    document.querySelectorAll('[data-product-price]').forEach(el => { el.textContent = money(config.priceCents); });
  if (Number.isSafeInteger(config.shippingCents) && config.shippingCents >= 0)
    document.querySelectorAll('[data-single-shipping]').forEach(el => { el.textContent = money(config.shippingCents); });
}).catch(() => {});

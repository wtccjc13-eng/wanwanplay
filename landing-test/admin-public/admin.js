'use strict';
const $ = id => document.getElementById(id);
const money = cents => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format((cents || 0) / 100);
const date = value => value && !Number.isNaN(Date.parse(value)) ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const label = value => ({ unfulfilled: 'Unfulfilled', packing: 'Packing', shipped: 'Shipped', on_hold: 'On hold', paid: 'Paid', pending: 'Pending', failed: 'Failed', unknown: 'Unclassified', real: 'Real order', test: 'Test order' })[value] || value;
let csrf = '', page = 1, total = 0, current = null, listSequence = 0, detailSequence = 0, saving = false;
const node = (tag, text, className) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; };
function showLogin() {
  csrf = ''; current = null; listSequence++; detailSequence++;
  $('workspace').hidden = true; $('login-panel').hidden = false; $('logout').hidden = true;
  $('orders').replaceChildren(); $('detail').close();
  promoSequence++; promoSnapshot = null; promoCatalog = null;
  $('promo-codes').replaceChildren(); $('promo-preview-rows').replaceChildren(); $('promo-preview').close();
  $('promo-sheet').value = ''; $('promo-setup').textContent = ''; $('promo-fetch').disabled = true;
}
async function api(route, options = {}) {
  const response = await fetch('/api/admin' + route, { cache: 'no-store', credentials: 'same-origin', ...options,
    headers: { 'Content-Type': 'application/json', 'X-Admin-Request': '1', ...(csrf ? { 'X-CSRF-Token': csrf } : {}), ...options.headers } });
  if (response.status === 401 && route !== '/login') showLogin();
  if (!response.ok) { const body = await response.json().catch(() => ({})); throw Object.assign(new Error(body.error || 'The request failed. Please try again.'), { errors: body.errors || [] }); }
  return response;
}
function query() {
  return new URLSearchParams(Object.fromEntries(['search', 'payment', 'fulfillment', 'archived', 'type'].map(id => [id, $(id).value])));
}
function badge(text, className = '') { return node('span', text, 'badge ' + className); }
function showWorkspace(session) {
  csrf = session.csrf; $('login-panel').hidden = true; $('workspace').hidden = false; $('logout').hidden = false;
  $('orders-panel').hidden = false; $('promos-panel').hidden = true;
  $('tab-orders').setAttribute('aria-pressed', 'true'); $('tab-promos').setAttribute('aria-pressed', 'false');
  $('environment').textContent = session.paymentEnv === 'sandbox'
    ? 'PayPal checkout is in SANDBOX. Sandbox payments are tests. Older orders may have no environment label: classify them before fulfillment.'
    : 'Payment status and fulfillment are separate. Older records may include sandbox tests: check the payment reference and classify each order before fulfillment.';
}
async function load() {
  const sequence = ++listSequence;
  $('message').textContent = 'Loading your order book…';
  try {
    const params = query(); params.set('page', page);
    const result = await (await api('/orders?' + params)).json();
    if (sequence !== listSequence || !csrf) return;
    total = result.total;
    if (page > 1 && (page - 1) * result.limit >= total) { page--; return load(); }
    $('stat-paid').textContent = result.summary.paid;
    $('stat-prepare').textContent = result.summary.toPrepare;
    $('stat-pending').textContent = result.summary.pending;
    $('stat-total').textContent = money(result.summary.paidTotalCents);
    $('orders').replaceChildren();
    for (const order of result.orders) {
      const row = node('tr'), ref = node('td');
      const open = node('button', order.id.length > 22 ? order.id.slice(0, 10) + '…' + order.id.slice(-6) : order.id, 'row-open reference');
      open.title = order.id; open.addEventListener('click', () => openOrder(order.id));
      ref.append(open, node('small', date(order.createdAt)));
      const customer = node('td'); customer.append(node('strong', order.customer.name || 'Awaiting PayPal details'), node('small', [order.customer.city, order.customer.country].filter(Boolean).join(' · ')));
      if (order.deliveryStatus === 'needs_attention') customer.append(badge('Delivery needs review', 'failed'));
      const payment = node('td'); payment.append(badge(label(order.status), order.status), node('small', order.provider + ' · ' + (order.paymentEnv === 'unknown' ? 'Environment unknown' : order.paymentEnv)));
      if (order.management.orderType !== 'unknown') payment.append(node('small', label(order.management.orderType)));
      const amount = node('td'); amount.append(node('strong', money(order.totalCents)), node('small', order.qty + ' item' + (order.qty === 1 ? '' : 's')));
      const fulfillment = node('td'); fulfillment.append(badge(label(order.management.fulfillment), order.management.fulfillment));
      if (order.management.archived) fulfillment.append(node('small', 'Archived'));
      const action = node('td'), view = node('button', 'View →', 'row-open');
      view.setAttribute('aria-label', 'View order ' + order.id); view.addEventListener('click', () => openOrder(order.id)); action.append(view);
      row.append(ref, customer, payment, amount, fulfillment, action); $('orders').append(row);
    }
    $('empty').hidden = total !== 0;
    $('result-count').textContent = total ? ((page - 1) * result.limit + 1) + '–' + Math.min(page * result.limit, total) + ' of ' + total + ' orders' : '0 orders';
    $('page-number').textContent = 'Page ' + page;
    $('previous').disabled = page === 1; $('next').disabled = page * result.limit >= total;
    $('message').textContent = '';
  } catch (error) { if (sequence === listSequence) $('message').textContent = error.message; }
}
async function openOrder(id) {
  if (saving) return;
  const sequence = ++detailSequence;
  $('message').textContent = 'Opening order…';
  try {
    const order = await (await api('/orders/' + encodeURIComponent(id))).json();
    if (sequence !== detailSequence || !csrf) return;
    current = order;
    $('detail-title').textContent = 'A little adventure, ready?'; $('detail-reference').textContent = order.id;
    $('detail-badges').replaceChildren(badge(label(order.status), order.status), badge(order.provider), badge(order.paymentEnv === 'unknown' ? 'Environment unknown' : order.paymentEnv));
    if (order.deliveryStatus === 'needs_attention') $('detail-badges').append(badge('Delivery needs review', 'failed'));
    const customer = order.customer;
    $('recipient-name').textContent = customer.name || 'Awaiting PayPal details';
    $('recipient-address').textContent = [customer.address, [customer.zip, customer.city].filter(Boolean).join(' '), customer.state, customer.country].filter(Boolean).join('\n');
    $('recipient-contact').replaceChildren(node('p', [customer.email, customer.phone].filter(Boolean).join(' · ')));
    $('order-facts').replaceChildren();
    const facts = { Created: date(order.createdAt), 'Paid at': date(order.paidAt), Quantity: order.qty,
      Subtotal: money(order.subtotalCents), Discount: money(order.discountCents), Shipping: money(order.shippingCents),
      Total: money(order.totalCents), Promotion: order.promoCode || 'None', 'PayPal order': order.paypalOrderId || '—',
      'PayPal capture': order.paypalCaptureId || '—', 'Legacy payment': order.legacyPaymentId || '—' };
    for (const [key, value] of Object.entries(facts)) $('order-facts').append(node('dt', key), node('dd', String(value)));
    const meta = order.management;
    $('edit-fulfillment').value = meta.fulfillment; $('edit-type').value = meta.orderType;
    for (const option of $('edit-fulfillment').options) option.disabled = (order.status !== 'paid' || order.deliveryStatus === 'needs_attention') && ['packing', 'shipped'].includes(option.value);
    $('edit-carrier').value = meta.carrier; $('edit-tracking').value = meta.trackingNumber;
    $('edit-notes').value = meta.notes; $('edit-archived').checked = meta.archived;
    $('save-message').textContent = ''; $('message').textContent = '';
    if (!$('detail').open) $('detail').showModal();
  } catch (error) { $('message').textContent = error.message; }
}
$('login-form').addEventListener('submit', async event => {
  event.preventDefault(); $('login-button').disabled = true; $('login-error').textContent = '';
  try {
    const session = await (await api('/login', { method: 'POST', body: JSON.stringify({ password: $('password').value }) })).json();
    $('password').value = ''; showWorkspace(session); await load();
  } catch (error) { $('login-error').textContent = error.message; }
  finally { $('login-button').disabled = false; }
});
$('logout').addEventListener('click', async () => {
  try { await api('/logout', { method: 'POST', body: '{}' }); showLogin(); }
  catch (error) { $('message').textContent = error.message; }
});
$('management-form').addEventListener('submit', async event => {
  event.preventDefault(); if (!current || saving) return;
  saving = true; $('save-order').disabled = true; $('save-message').textContent = 'Saving…';
  try {
    const result = await (await api('/orders/' + encodeURIComponent(current.id), { method: 'PATCH', body: JSON.stringify({
      version: current.management.version, fulfillment: $('edit-fulfillment').value, orderType: $('edit-type').value,
      carrier: $('edit-carrier').value, trackingNumber: $('edit-tracking').value, notes: $('edit-notes').value, archived: $('edit-archived').checked,
    }) })).json();
    current.management = result.management; $('save-message').textContent = 'Saved. Your order book is up to date.'; await load();
  } catch (error) { $('save-message').textContent = error.message; }
  finally { saving = false; $('save-order').disabled = false; }
});
$('close-detail').addEventListener('click', () => { if (!saving) $('detail').close(); });
$('detail').addEventListener('cancel', event => { if (saving) event.preventDefault(); });
let debounce;
$('search').addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(() => { page = 1; load(); }, 250); });
for (const id of ['payment', 'fulfillment', 'archived', 'type']) $(id).addEventListener('change', () => { page = 1; load(); });
$('filters').addEventListener('submit', event => { event.preventDefault(); page = 1; load(); });
$('refresh').addEventListener('click', load);
$('previous').addEventListener('click', () => { if (page > 1) { page--; load(); } });
$('next').addEventListener('click', () => { if (page * 50 < total) { page++; load(); } });
$('export').addEventListener('click', async () => {
  $('export').disabled = true;
  try {
    const response = await api('/orders/export.csv?' + query());
    const url = URL.createObjectURL(await response.blob()), link = node('a');
    link.href = url; link.download = 'wanwan-orders.csv'; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) { $('message').textContent = error.message; }
  finally { $('export').disabled = false; }
});
let promoSequence = 0, promoCatalog = null, promoSnapshot = null, promoBusy = false;
const promoDescription = p => !p ? 'New code' : [p.type === 'percent' ? p.value + '%' : money(Math.round(p.value * 100)), p.active ? 'enabled' : 'disabled', 'limit ' + (p.maxUses ?? 'unlimited'), p.expires || 'no expiry', p.partner].filter(Boolean).join(' · ');
function renderPromos() {
  if (!promoCatalog) return;
  const search = $('promo-search').value.trim().toLowerCase();
  const codes = promoCatalog.codes.filter(p => (p.code + ' ' + p.partner).toLowerCase().includes(search));
  $('promo-codes').replaceChildren();
  for (const p of codes) {
    const row = node('tr'), ref = node('td'); ref.append(node('strong', p.code), node('small', p.partner || '—'));
    const state = !p.active ? 'Disabled' : p.expires && Date.parse(p.expires + 'T23:59:59.999Z') < Date.now() ? 'Expired' : p.maxUses && p.uses >= p.maxUses ? 'Limit reached' : 'Active';
    const status = node('td'); status.append(badge(state, state === 'Active' ? 'paid' : 'pending'));
    row.append(ref, node('td', p.type === 'percent' ? p.value + '%' : money(p.value * 100)), node('td', p.uses + ' / ' + (p.maxUses ?? 'Unlimited')), node('td', p.expires || 'No expiry'), status);
    $('promo-codes').append(row);
  }
  if (!codes.length) { const row = node('tr'), cell = node('td', 'No codes match your search.'); cell.setAttribute('colspan', '5'); row.append(cell); $('promo-codes').append(row); }
  $('promo-count').textContent = codes.length + ' of ' + promoCatalog.codes.length + ' codes';
}
function renderSource(source) {
  $('promo-sheet').value = source.url || ''; $('promo-tab').value = source.tabName;
  $('promo-fetch').disabled = promoBusy || !source.spreadsheetId || !source.credentialsReady;
  $('promo-setup').textContent = source.credentialsReady
    ? 'Share the sheet as Viewer with ' + source.serviceAccountEmail + '. Keep the sheet private. Headers: code, type, value, max_uses, expires, active, partner.'
    : 'Connection needs two Hostinger environment variables: GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY. Enable Google Sheets API, restart the app, then share the private sheet with that service account as Viewer. Never enter the private key here.';
}
async function loadPromos() {
  const sequence = ++promoSequence;
  $('promo-message').textContent = 'Loading promo codes…';
  try {
    const result = await (await api('/promos')).json();
    if (sequence !== promoSequence || !csrf) return;
    promoCatalog = result; renderPromos(); renderSource(result.source);
    $('promo-status').textContent = result.syncedAt ? 'Last applied: ' + date(result.syncedAt) + ' · Revision ' + result.revision + '. Imports are manual.' : 'Using the original website codes. No Google Sheet import has been applied yet.';
    $('promo-message').textContent = '';
  } catch (error) { if (sequence === promoSequence) $('promo-message').textContent = error.message; }
}
function switchSection(promos) {
  $('orders-panel').hidden = promos; $('promos-panel').hidden = !promos;
  $('tab-orders').setAttribute('aria-pressed', String(!promos)); $('tab-promos').setAttribute('aria-pressed', String(promos));
  if (promos) loadPromos();
}
$('tab-orders').addEventListener('click', () => switchSection(false));
$('tab-promos').addEventListener('click', () => switchSection(true));
$('promo-search').addEventListener('input', renderPromos);
function promoError(error) {
  $('promo-message').textContent = error.message;
  $('promo-errors').replaceChildren(...(error.errors || []).map(text => node('li', text)));
}
$('promo-source-form').addEventListener('submit', async event => {
  event.preventDefault(); if (promoBusy || !promoCatalog) return;
  promoBusy = true; $('promo-save-source').disabled = true;
  $('promo-message').textContent = 'Saving connection…'; $('promo-errors').replaceChildren();
  try {
    const source = await (await api('/promos/config', { method: 'PUT', body: JSON.stringify({ sheet: $('promo-sheet').value, tabName: $('promo-tab').value, revision: promoCatalog.source.revision }) })).json();
    if (!csrf) return;
    promoCatalog.source = source; promoSnapshot = null;
    $('promo-message').textContent = 'Connection saved. Current checkout codes have not changed.';
  } catch (error) { promoError(error); }
  finally { promoBusy = false; $('promo-save-source').disabled = false; if (promoCatalog) renderSource(promoCatalog.source); }
});
$('promo-fetch').addEventListener('click', async () => {
  if (promoBusy) return;
  const sequence = promoSequence;
  promoBusy = true; $('promo-fetch').disabled = true; $('promo-save-source').disabled = true;
  $('promo-message').textContent = 'Reading and validating your private sheet…'; $('promo-errors').replaceChildren();
  promoSnapshot = null;
  try {
    const result = await (await api('/promos/preview', { method: 'POST', body: '{}' })).json();
    if (!csrf || sequence !== promoSequence) return;
    promoSnapshot = result;
    $('promo-preview-summary').textContent = Object.entries(result.counts).map(([action, count]) => count + ' ' + action).join(' · ');
    $('promo-preview-rows').replaceChildren();
    for (const change of result.changes) {
      const row = node('tr'), code = node('td'); code.append(node('strong', change.code), badge(change.action, change.action === 'disabled' ? 'failed' : 'paid'));
      row.append(code, node('td', promoDescription(change.previous)), node('td', promoDescription(change.next)), node('td', String(change.uses)));
      $('promo-preview-rows').append(row);
    }
    $('promo-apply-message').textContent = ''; $('promo-message').textContent = ''; $('promo-apply').disabled = false;
    $('promo-preview').showModal();
  } catch (error) { promoError(error); }
  finally { promoBusy = false; $('promo-save-source').disabled = false; if (promoCatalog) renderSource(promoCatalog.source); }
});
function closePromoPreview() { if (!promoBusy) { promoSnapshot = null; $('promo-preview').close(); } }
$('promo-close-preview').addEventListener('click', closePromoPreview);
$('promo-cancel-preview').addEventListener('click', closePromoPreview);
$('promo-preview').addEventListener('cancel', event => { if (promoBusy) event.preventDefault(); else promoSnapshot = null; });
$('promo-apply').addEventListener('click', async () => {
  if (promoBusy || !promoSnapshot) return;
  promoBusy = true; $('promo-apply').disabled = true; $('promo-apply-message').textContent = 'Applying changes…';
  try {
    await api('/promos/apply', { method: 'POST', body: JSON.stringify({ token: promoSnapshot.token }) });
    promoSnapshot = null; $('promo-preview').close(); await loadPromos();
    $('promo-message').textContent = 'Applied. New checkouts now use this promo list. Paid-use counts are preserved.';
  } catch (error) { $('promo-apply-message').textContent = error.message; }
  finally { promoBusy = false; $('promo-apply').disabled = false; if (promoCatalog) renderSource(promoCatalog.source); }
});
(async () => {
  try { showWorkspace(await (await api('/session')).json()); await load(); }
  catch (error) { showLogin(); if (!/sign in/i.test(error.message)) $('login-error').textContent = error.message; }
})();

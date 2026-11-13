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
}
async function api(route, options = {}) {
  const response = await fetch('/api/admin' + route, { cache: 'no-store', credentials: 'same-origin', ...options,
    headers: { 'Content-Type': 'application/json', 'X-Admin-Request': '1', ...(csrf ? { 'X-CSRF-Token': csrf } : {}), ...options.headers } });
  if (response.status === 401 && route !== '/login') showLogin();
  if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || 'The request failed. Please try again.'); }
  return response;
}
function query() {
  return new URLSearchParams(Object.fromEntries(['search', 'payment', 'fulfillment', 'archived', 'type'].map(id => [id, $(id).value])));
}
function badge(text, className = '') { return node('span', text, 'badge ' + className); }
function showWorkspace(session) {
  csrf = session.csrf; $('login-panel').hidden = true; $('workspace').hidden = false; $('logout').hidden = false;
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
      const customer = node('td'); customer.append(node('strong', order.customer.name || 'No recipient'), node('small', [order.customer.city, order.customer.country].filter(Boolean).join(' · ')));
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
    const customer = order.customer;
    $('recipient-name').textContent = customer.name;
    $('recipient-address').textContent = [customer.address, [customer.zip, customer.city].filter(Boolean).join(' '), customer.country].filter(Boolean).join('\n');
    $('recipient-contact').replaceChildren(node('p', [customer.email, customer.phone].filter(Boolean).join(' · ')));
    $('order-facts').replaceChildren();
    const facts = { Created: date(order.createdAt), 'Paid at': date(order.paidAt), Quantity: order.qty,
      Subtotal: money(order.subtotalCents), Discount: money(order.discountCents), Shipping: money(order.shippingCents),
      Total: money(order.totalCents), Promotion: order.promoCode || 'None', 'PayPal order': order.paypalOrderId || '—',
      'PayPal capture': order.paypalCaptureId || '—', 'Legacy payment': order.legacyPaymentId || '—' };
    for (const [key, value] of Object.entries(facts)) $('order-facts').append(node('dt', key), node('dd', String(value)));
    const meta = order.management;
    $('edit-fulfillment').value = meta.fulfillment; $('edit-type').value = meta.orderType;
    for (const option of $('edit-fulfillment').options) option.disabled = order.status !== 'paid' && ['packing', 'shipped'].includes(option.value);
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
(async () => {
  try { showWorkspace(await (await api('/session')).json()); await load(); }
  catch (error) { showLogin(); if (!/sign in/i.test(error.message)) $('login-error').textContent = error.message; }
})();

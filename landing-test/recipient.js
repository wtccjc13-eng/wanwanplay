const COUNTRIES = ['FR','BE','CH','LU','DE','NL','IT','ES','PT','GB','IE','AT','DK','SE','FI','NO','PL','CZ','SK','HU','SI','HR','RO','BG','GR','CY','MT','EE','LV','LT'];
class DeliveryError extends Error {
  constructor(code) { super(code); this.code = code; }
}
function recipient(remote, existing = {}) {
  const shipping = remote.purchase_units?.[0]?.shipping;
  const address = shipping?.address;
  const text = (value, max = 300) => typeof value === 'string' && value.trim().length <= max ? value.trim() : '';
  const name = text(shipping?.name?.full_name);
  const country = text(address?.country_code, 2).toUpperCase();
  const street = text(address?.address_line_1), city = text(address?.admin_area_2), zip = text(address?.postal_code, 60);
  if (!name || !country || !street || !city || !zip) throw new DeliveryError('DELIVERY_MISSING');
  if (!COUNTRIES.includes(country)) throw new DeliveryError('DELIVERY_COUNTRY');
  const wallet = remote.payment_source?.paypal || {};
  const candidates = [shipping.email_address, wallet.email_address, remote.payer?.email_address, existing.email];
  const email = candidates.map(value => text(value, 254)).find(value => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) || '';
  const phones = [shipping.phone_number, wallet.phone_number, wallet.phone?.phone_number, remote.payer?.phone?.phone_number, existing.phone];
  let phone = '';
  for (const entry of phones) {
    const number = typeof entry === 'string' ? entry : entry?.national_number;
    if (typeof number !== 'string' || !/^[+\d\s().-]{6,30}$/.test(number)) continue;
    const prefix = typeof entry === 'object' && /^\d{1,3}$/.test(entry.country_code || '') ? '+' + entry.country_code : '';
    phone = (number.trim().startsWith('+') ? '' : prefix) + number.trim(); break;
  }
  return { name, email, phone,
    address: [street, text(address?.address_line_2), text(address?.address_line_3)].filter(Boolean).join('\n'),
    zip, city, state: text(address?.admin_area_1), country };
}
module.exports = { recipient, DeliveryError };

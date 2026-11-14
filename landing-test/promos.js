const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const userError = message => Object.assign(new Error(message), { publicMessage: message });
const HEADERS = ['code', 'type', 'value', 'max_uses', 'expires', 'active', 'partner'];
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

function validateRows(rows) {
  const errors = [], codes = [], seen = new Set();
  if (!Array.isArray(rows) || !rows.length) return { errors: ['The sheet is empty. Add the header row and at least one code.'] };
  if (rows.length > 1001) return { errors: ['Use at most 1,000 data rows below the header.'] };
  if (!Array.isArray(rows[0])) return { errors: ['Row 1 must contain the seven column headers.'] };
  const header = rows[0].map(value => String(value).trim().toLowerCase());
  if (HEADERS.some((key, index) => header[index] !== key) || header.slice(7).some(Boolean))
    return { errors: ['Row 1 must be exactly: ' + HEADERS.join(', ')] };
  rows.slice(1).forEach((row, index) => {
    if (!Array.isArray(row)) { errors.push('Row ' + (index + 2) + ': invalid row.'); return; }
    if (row.every(value => value === '' || value === null || value === undefined)) return;
    const code = String(row[0] ?? '').trim().toUpperCase(), type = String(row[1] ?? '').trim().toLowerCase();
    const rawValue = row[2], value = typeof rawValue === 'number' ? rawValue : /^\d+(\.\d{1,2})?$/.test(String(rawValue ?? '').trim()) ? Number(rawValue) : NaN;
    const rawMax = row[3], maxUses = rawMax === '' || rawMax === null || rawMax === undefined ? null : Number(rawMax);
    const expires = String(row[4] ?? '').trim();
    const rawActive = String(row[5] ?? '').trim().toUpperCase();
    const partner = String(row[6] ?? '').trim();
    const invalid = [];
    if (!/^[A-Z0-9][A-Z0-9_-]{1,39}$/.test(code)) invalid.push('code must contain 2–40 letters, digits, hyphens or underscores');
    if (seen.has(code)) invalid.push('duplicate code (case-insensitive)');
    seen.add(code);
    if (!['percent', 'amount_eur'].includes(type)) invalid.push('type must be percent or amount_eur');
    if (!Number.isFinite(value) || value <= 0 || value > (type === 'percent' ? 100 : 10000) || Math.abs(value * 100 - Math.round(value * 100)) > 0.000001)
      invalid.push('value must be positive, with at most two decimals (percent: max 100)');
    if (maxUses !== null && (typeof rawMax === 'boolean' || !Number.isSafeInteger(maxUses) || maxUses <= 0)) invalid.push('max_uses must be a positive whole number, or blank for unlimited');
    if (expires && (!/^\d{4}-\d{2}-\d{2}$/.test(expires) || !Number.isFinite(Date.parse(expires)) || new Date(expires).toISOString().slice(0, 10) !== expires))
      invalid.push('expires must be a real YYYY-MM-DD date, or blank');
    if (!['TRUE', 'FALSE'].includes(rawActive)) invalid.push('active must be TRUE or FALSE');
    if (partner.length > 100) invalid.push('partner must be at most 100 characters');
    if (row.slice(7).some(value => String(value ?? '').trim())) invalid.push('unexpected data beyond column G');
    if (invalid.length) errors.push('Row ' + (index + 2) + ': ' + invalid.join('; ') + '.');
    codes.push({ code, type, value, maxUses, expires: expires || null, active: rawActive === 'TRUE', partner });
  });
  if (!codes.length) errors.push('Add at least one code. To disable all codes, keep their rows and set active to FALSE.');
  return { codes, errors: errors.slice(0, 100) };
}
const canonical = promo => ({ code: promo.code.toUpperCase(), type: promo.type, value: promo.value,
  maxUses: promo.maxUses || null, expires: promo.expires || null, active: promo.active !== false, partner: promo.partner || '' });

module.exports = function promos(db, reader = require('./google-sheets')()) {
  async function state() {
    const stored = await db.getPromoState();
    if (stored) return stored;
    const codes = JSON.parse(fs.readFileSync(path.join(__dirname, 'promo-codes.json'), 'utf8')).map(canonical);
    return { revision: 0, codes, syncedAt: null };
  }
  async function config() { return await db.getPromoConfig() || { revision: 0, spreadsheetId: '', tabName: 'Promos' }; }
  const source = conf => ({ ...conf, url: conf.spreadsheetId ? 'https://docs.google.com/spreadsheets/d/' + conf.spreadsheetId + '/edit' : '',
    serviceAccountEmail: reader.email, credentialsReady: reader.credentialsReady });
  async function overview() {
    const [current, conf] = await Promise.all([state(), config()]);
    const uses = await db.promoCounts(current.codes.map(code => code.code));
    return { codes: current.codes.map(code => ({ ...code, uses: uses[code.code] || 0 })), revision: current.revision,
      syncedAt: current.syncedAt, source: source(conf) };
  }
  return {
    codes: async () => (await state()).codes,
    overview,
    async saveConfig(input) {
      let spreadsheetId = String(input.sheet || '').trim();
      if (spreadsheetId.startsWith('https://')) {
        let url; try { url = new URL(spreadsheetId); } catch { throw userError('Paste a Google Sheets link or spreadsheet ID.'); }
        const match = url.hostname === 'docs.google.com' && url.pathname.match(/^\/spreadsheets\/d\/([A-Za-z0-9_-]+)(?:\/|$)/);
        if (!match) throw userError('Use a docs.google.com/spreadsheets/d/… link.');
        spreadsheetId = match[1];
      }
      if (!/^[A-Za-z0-9_-]{20,150}$/.test(spreadsheetId)) throw userError('Paste a valid Google spreadsheet link or ID.');
      const tabName = String(input.tabName || '').trim();
      if (!tabName || tabName.length > 80 || /[\[\]*?/:\\\x00-\x1f]/.test(tabName)) throw userError('Enter the worksheet tab name, for example Promos (maximum 80 characters).');
      const revision = input.revision;
      if (!Number.isSafeInteger(revision) || revision < 0) throw userError('Refresh the promo section before saving the connection.');
      if (!await db.savePromoConfig({ spreadsheetId, tabName, revision: revision + 1 }, revision))
        throw userError('The connection changed in another window. Refresh and try again.');
      return source(await config());
    },
    async preview(sessionHash) {
      const conf = await config();
      if (!conf.spreadsheetId) throw userError('Save your Google Sheet link and tab name first.');
      const rows = await reader.read(conf), parsed = validateRows(rows);
      if (parsed.errors.length) return { errors: parsed.errors };
      const current = await state(), previous = new Map(current.codes.map(code => [code.code, canonical(code)]));
      const proposed = new Map(parsed.codes.map(code => [code.code, code]));
      for (const [code, promo] of previous) if (!proposed.has(code)) proposed.set(code, { ...promo, active: false });
      if (proposed.size > 10000) throw userError('The catalog exceeds 10,000 historical codes. Contact support before importing.');
      const uses = await db.promoCounts([...proposed.keys()]);
      const changes = [...proposed.values()].map(next => {
        const old = previous.get(next.code) || null;
        const action = !old ? 'added' : old.active && !next.active ? 'disabled' : !old.active && next.active ? 'enabled'
          : JSON.stringify(old) === JSON.stringify(next) ? 'unchanged' : 'updated';
        return { code: next.code, action, previous: old, next, uses: uses[next.code] || 0 };
      });
      const token = crypto.randomBytes(32).toString('hex');
      const preview = { sessionHash, expires: Date.now() + 900000, baseRevision: current.revision,
        configRevision: conf.revision, source: { spreadsheetId: conf.spreadsheetId, tabName: conf.tabName }, codes: [...proposed.values()] };
      await db.savePromoPreview(hash(token), preview);
      return { token, expiresAt: preview.expires, changes,
        counts: Object.fromEntries(['added', 'updated', 'enabled', 'disabled', 'unchanged'].map(action => [action, changes.filter(row => row.action === action).length])) };
    },
    async apply(token, sessionHash) {
      if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw userError('Fetch a fresh preview before applying changes.');
      const preview = await db.getPromoPreview(hash(token));
      if (!preview || preview.sessionHash !== sessionHash || preview.expires <= Date.now()) throw userError('This preview expired or belongs to another session. Fetch a fresh preview.');
      const value = { revision: preview.baseRevision + 1, codes: preview.codes, syncedAt: new Date().toISOString(), source: preview.source };
      const result = await db.savePromoState(value, preview.baseRevision, preview.configRevision);
      if (result !== 1) throw userError('The promo catalog or connection changed. Fetch a fresh preview before applying.');
      // A failed cleanup must not misreport a successful atomic update as a failure.
      await db.deletePromoPreview(hash(token)).catch(() => {});
      return { ok: true, revision: value.revision, syncedAt: value.syncedAt };
    },
  };
};
module.exports.validateRows = validateRows;

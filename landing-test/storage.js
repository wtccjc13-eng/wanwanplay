const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

module.exports = function storage(dataDir, redis) {
  const file = name => path.join(dataDir, name);
  function read(name, fallback = {}) {
    try { return JSON.parse(fs.readFileSync(file(name), 'utf8')); }
    catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
  }
  function write(name, value) {
    const temp = file(name + '.' + crypto.randomUUID() + '.tmp');
    try {
      const fd = fs.openSync(temp, 'wx', 0o600);
      try { fs.writeFileSync(fd, JSON.stringify(value, null, 2)); fs.fsyncSync(fd); }
      finally { fs.closeSync(fd); }
      fs.renameSync(temp, file(name));
    } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
  }
  // A journal makes the two legacy JSON files recoverable as one transaction.
  // This synchronous backend requires exactly one Node.js process.
  function recover() {
    const journal = read('payment-journal.json', null);
    if (!journal) return;
    write('orders.json', journal.orders);
    write('promo-uses.json', journal.uses);
    fs.unlinkSync(file('payment-journal.json'));
  }
  if (!redis) {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.accessSync(dataDir, fs.constants.W_OK);
    recover();
  }
  return {
    async listOrders() {
      if (!redis) { recover(); return Object.values(read('orders.json')); }
      const keys = new Set();
      let cursor = '0';
      do {
        const page = await redis('SCAN', cursor, 'MATCH', 'order:*', 'COUNT', 100);
        cursor = String(page[0]);
        for (const key of page[1]) keys.add(key);
        if (keys.size > 10000) throw new Error('ORDER_LIST_LIMIT');
      } while (cursor !== '0');
      const orders = [], all = [...keys];
      for (let i = 0; i < all.length; i += 100) {
        const values = await redis('MGET', ...all.slice(i, i + 100));
        for (const value of values) if (value) orders.push(JSON.parse(value));
      }
      return orders;
    },
    async getManagement(ids) {
      if (!redis) return read('order-management.json');
      const result = {};
      for (let i = 0; i < ids.length; i += 100) {
        const batch = ids.slice(i, i + 100);
        const values = await redis('MGET', ...batch.map(id => 'order-admin:' + id));
        values.forEach((value, index) => { if (value) result[batch[index]] = JSON.parse(value); });
      }
      return result;
    },
    async updateManagement(id, value, expectedVersion) {
      if (redis) return redis('EVAL', `
        local raw = redis.call('GET', KEYS[1])
        local current = raw and cjson.decode(raw) or {version=0}
        if tonumber(current.version) ~= tonumber(ARGV[1]) then return 0 end
        redis.call('SET', KEYS[1], ARGV[2])
        return 1
      `, 1, 'order-admin:' + id, String(expectedVersion), JSON.stringify(value));
      const records = read('order-management.json');
      if ((records[id]?.version || 0) !== expectedVersion) return 0;
      records[id] = value; write('order-management.json', records); return 1;
    },
    async getAdminSession(hash) {
      if (redis) { const value = await redis('GET', 'admin-session:' + hash); return value ? JSON.parse(value) : null; }
      return read('admin-sessions.json')[hash] || null;
    },
    async saveAdminSession(hash, session) {
      if (redis) return redis('SET', 'admin-session:' + hash, JSON.stringify(session), 'EX', 28800);
      const sessions = read('admin-sessions.json');
      for (const [key, value] of Object.entries(sessions)) if (value.expires <= Date.now()) delete sessions[key];
      sessions[hash] = session; write('admin-sessions.json', sessions);
    },
    async deleteAdminSession(hash) {
      if (redis) return redis('DEL', 'admin-session:' + hash);
      const sessions = read('admin-sessions.json'); delete sessions[hash]; write('admin-sessions.json', sessions);
    },
    async getOrder(id) {
      if (redis) { const raw = await redis('GET', 'order:' + id); return raw ? JSON.parse(raw) : null; }
      recover(); return read('orders.json')[id] || null;
    },
    async saveOrder(order) {
      if (redis) return redis('SET', 'order:' + order.id, JSON.stringify(order));
      recover(); const orders = read('orders.json'); orders[order.id] = order; write('orders.json', orders);
    },
    async promoUses(code) {
      if (redis) return Number(await redis('GET', 'promo:' + code)) || 0;
      recover(); return read('promo-uses.json')[code] || 0;
    },
    async setPaymentStatus(id, status) {
      if (redis) return redis('EVAL', `
        local raw = redis.call('GET', KEYS[1])
        if not raw then return -1 end
        local current = cjson.decode(raw)
        if current.status == 'paid' then return 0 end
        current.status = ARGV[1]
        redis.call('SET', KEYS[1], cjson.encode(current))
        return 1
      `, 1, 'order:' + id, status);
      recover(); const orders = read('orders.json'), order = orders[id];
      if (!order || order.status === 'paid') return;
      order.status = status; write('orders.json', orders);
    },
    async markPaid(id, captureId) {
      const paidAt = new Date().toISOString();
      if (redis) {
        const order = await this.getOrder(id);
        if (!order) throw new Error('ORDER_UNKNOWN');
        return redis('EVAL', `
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
          current.paypalCaptureId = ARGV[2]
          local encoded = cjson.encode(current)
          if uses then redis.call('SET', KEYS[2], tostring(uses + 1)) end
          redis.call('SET', KEYS[1], encoded)
          return 1
        `, 2, 'order:' + id, order.promoCode ? 'promo:' + order.promoCode : 'order:' + id, paidAt, captureId);
      }
      recover(); const orders = read('orders.json'), order = orders[id];
      if (!order) throw new Error('ORDER_UNKNOWN');
      if (order.status === 'paid') return 0;
      const uses = read('promo-uses.json');
      order.status = 'paid'; order.paidAt = paidAt; order.paypalCaptureId = captureId;
      if (order.promoCode) uses[order.promoCode] = (uses[order.promoCode] || 0) + 1;
      write('payment-journal.json', { orders, uses });
      recover(); return 1;
    },
  };
};

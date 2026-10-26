// Developer console (server side). Hidden: it only opens when the secret code is typed as the name.
// Everything here is guarded by socket.isAdmin, which is set only after the code is checked on the server.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

module.exports = function createAdmin({ io, app, connections, waitingUsers, endCurrentChat, removeFromQueue, sanitize }) {
  const CODE = String(process.env.ADMIN_CODE || '6393300502');
  const DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
  const FILE = path.join(DIR, 'db.json');
  const DAY = 864e5;
  const MAX_BYTES = (Number(process.env.MAX_STORE_MB) || 25) * 1048576;
  const BY_IP = process.env.BLOCK_BY_IP !== 'false';
  let UI = '';
  try { UI = fs.readFileSync(path.join(__dirname, 'panel.js'), 'utf8'); } catch (e) { console.error('[admin] panel.js missing', e.message); }

  let db = { store: true, blocked: [], reports: [], archive: [] };
  try { db = Object.assign(db, JSON.parse(fs.readFileSync(FILE, 'utf8'))); } catch (e) { /* first run */ }

  const users = new Map();   // socket.id -> online user
  const live = new Map();    // chat id -> live chat
  const chatOf = new Map();  // socket.id -> live chat
  const tokens = new Map();  // admin token -> expiry
  const tries = new Map();   // ip -> wrong code attempts
  const seen = new Map();    // report rate limit
  let dirty = false;
  const save = () => { dirty = true; };
  const rnd = (n) => crypto.randomBytes(n).toString('hex');
  const toAdmins = (ev, data) => io.to('admins').emit(ev, data);
  const cb = (f) => (typeof f === 'function' ? f : () => {});

  const deviceId = (s) => (String(s.handshake.headers.cookie || '').match(/(?:^|;\s*)ck_d=([a-f0-9]{24})/) || [])[1] || null;
  const clientIp = (s) => {
    const h = s.handshake;
    const x = (String(h.headers['x-forwarded-for'] || '').split(',')[0].trim() || h.address || '').replace(/^::ffff:/, '');
    return !x || /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1$|f[cd][0-9a-f]{2}:)/i.test(x) ? null : x;
  };
  const isBlocked = (dv, ip) => db.blocked.some((b) => (dv && b.dev === dv) || (BY_IP && ip && b.ip === ip));
  const pub = (u) => ({ sid: u.sid, id: u.id, name: u.name, gender: u.gender });
  const arch = (u) => ({ id: u.id, name: u.name, gender: u.gender });

  // Passwords are stored as salted scrypt hashes, never as plain text.
  const hashPw = (pw, salt) => crypto.scryptSync(String(pw), salt, 32).toString('hex');
  const mkPw = (pw) => { const s = rnd(8); return { s, h: hashPw(pw, s) }; };
  const okPw = (o, pw) => !!(o && o.h && o.s) && crypto.timingSafeEqual(Buffer.from(hashPw(pw, o.s), 'hex'), Buffer.from(o.h, 'hex'));
  const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
  const devUser = () => (db.dev && db.dev.user) || CODE;
  if (process.env.RESET_ADMIN === '1') delete db.dev;
  const BOOT = process.env.ADMIN_PASSWORD || rnd(5);
  if (!(db.dev && db.dev.h)) {
    console.log(process.env.ADMIN_PASSWORD
      ? '[admin] Developer login: username "' + CODE + '" with your ADMIN_PASSWORD. Set your own in the console (menu > Developer login).'
      : '[admin] FIRST DEVELOPER LOGIN -> username: ' + CODE + '   temporary password: ' + BOOT + '   (change both in the console: menu > Developer login)');
  }

  const status = (u) => {
    const p = connections[u.sid];
    if (p) { const ps = io.sockets.sockets.get(p); return ps && ps.isAdmin ? 'with admin' : 'chatting'; }
    return ['male', 'female', 'other'].some((g) => waitingUsers[g].some((s) => s.id === u.sid)) ? 'searching' : 'idle';
  };
  const userList = () => [...users.values()].map((u) => ({ ...pub(u), st: status(u) }));
  const liveList = () => [...live.values()].map((c) => {
    const l = c.m[c.m.length - 1];
    return { id: c.id, start: c.start, a: pub(c.a), b: pub(c.b), n: c.m.length, last: l ? (l.photo !== undefined ? '📷 Photo' : l.text) : '' };
  });
  const pastList = () => db.archive.map((c) => ({ id: c.id, start: c.start, end: c.end, a: c.a, b: c.b, n: c.m.length }));
  const reportList = () => db.reports.map((r) => ({ id: r.id, t: r.t, reason: r.reason, a: r.a, b: r.b, by: r.by, s: r.s, n: r.m.length }));
  const blockedList = () => db.blocked.map((b) => ({ k: b.k, id: b.id, name: b.name, gender: b.gender, reason: b.reason, t: b.t, dev: !!b.dev, net: !!b.ip }));

  let ut = null;
  const pushUsers = () => { if (ut) return; ut = setTimeout(() => { ut = null; toAdmins('admin:users', userList()); toAdmins('admin:accts', P.acctList()); }, 300); };

  // Saved chats: deleted 24h after they end. Disk write is debounced.
  const size = (c) => c.m.reduce((n, e) => n + (e.photo ? e.photo.length : (e.text || '').length), 0);
  const trim = () => { let t = 0; db.archive = db.archive.filter((c) => (t += size(c)) < MAX_BYTES); };
  setInterval(() => {
    const n = db.archive.length;
    db.archive = db.archive.filter((c) => Date.now() - c.end < DAY);
    if (db.archive.length !== n) { dirty = true; toAdmins('admin:past', pastList()); }
    for (const [k, v] of tokens) if (v < Date.now()) tokens.delete(k);
    if (seen.size > 5000) seen.clear();
    if (!dirty) return;
    dirty = false;
    try {
      fs.mkdirSync(DIR, { recursive: true });
      fs.writeFileSync(FILE + '.tmp', JSON.stringify(db));
      fs.renameSync(FILE + '.tmp', FILE);
    } catch (e) { console.error('[admin] save failed:', e.message); }
  }, 5000).unref();

  function endLive(c) {
    live.delete(c.id);
    if (chatOf.get(c.a.sid) === c) chatOf.delete(c.a.sid);
    if (chatOf.get(c.b.sid) === c) chatOf.delete(c.b.sid);
    if (db.store && c.m.length) {
      db.archive.unshift({ id: c.id, start: c.start, end: Date.now(), a: arch(c.a), b: arch(c.b), m: c.m });
      trim(); save(); toAdmins('admin:past', pastList());
    }
    toAdmins('admin:live', liveList());
    pushUsers();
  }

  // Developer sign-in: username + password typed on the front page. Wrong guesses are throttled per network address.
  function login(socket, name, pw) {
    const n = String(name == null ? '' : name).trim().replace(/\s+/g, ' ').toLowerCase();
    if (n !== devUser().toLowerCase()) return false;
    const ip = clientIp(socket) || 'x';
    const r = tries.get(ip) || { c: 0, t: 0 };
    if (Date.now() > r.t) { r.c = 0; r.t = Date.now() + 9e5; }
    if (r.c >= 8) return 'fail';
    const first = !(db.dev && db.dev.h);
    const given = String(pw == null ? '' : pw);
    if (!(first ? safeEq(given, BOOT) : okPw(db.dev, given))) {
      r.c++; tries.set(ip, r); console.warn('[admin] wrong developer login');
      return 'fail';
    }
    const token = rnd(24);
    tokens.set(token, Date.now() + 12 * 36e5);
    socket.isAdmin = true;
    socket.join('admins');
    socket.emit('adminGranted', { token, js: UI, first });
    return true;
  }

  // Permanent block by device cookie and (optionally) network address.
  function block(t, reason) {
    if (!(t.dev || (BY_IP && t.ip) || t.acct)) return false;
    if (!isBlocked(t.dev, t.ip)) db.blocked.unshift({ k: rnd(4), acct: t.acct, id: t.id, name: t.name, gender: t.gender, dev: t.dev, ip: t.ip, reason, t: Date.now() });
    save();
    for (const u of [...users.values()]) {
      if ((t.dev && u.dev === t.dev) || (BY_IP && t.ip && u.ip === t.ip) || (t.acct && u.acct === t.acct)) {
        const s = io.sockets.sockets.get(u.sid);
        if (s) { endCurrentChat(s, true); removeFromQueue(s); s.emit('blocked'); s.disconnect(true); }
      }
    }
    toAdmins('admin:blocked', blockedList());
    pushUsers();
    return true;
  }

  function attach(socket) {
    const A = (ev, fn) => socket.on(ev, (...args) => {
      try { if (socket.isAdmin) fn(...args); } catch (e) { console.error('[admin]', ev, e); }
    });

    socket.on('admin:resume', (tk, ack) => {
      const ok = typeof tk === 'string' && tokens.get(tk) > Date.now();
      if (ok) { socket.isAdmin = true; socket.join('admins'); }
      cb(ack)({ ok });
    });
    A('admin:sync', (_, ack) => cb(ack)({ live: liveList(), users: userList(), past: pastList(), reports: reportList(), blocked: blockedList(), store: db.store, dev: devUser(), first: !(db.dev && db.dev.h), ...P.snapshot() }));
    A('admin:store', (on, ack) => { db.store = !!on; save(); toAdmins('admin:store', db.store); cb(ack)({ ok: true }); });
    A('admin:open', ({ kind, id }, ack) => {
      let c;
      if (kind === 'live') { const l = live.get(id); c = l && { a: pub(l.a), b: pub(l.b), m: l.m }; }
      else if (kind === 'past') c = db.archive.find((x) => x.id === id);
      else if (kind === 'report') c = db.reports.find((x) => x.id === id);
      cb(ack)(c ? { a: c.a, b: c.b, m: c.m, by: c.by } : { error: 'This chat is no longer available.' });
    });
    A('admin:block', ({ sid, rpt, reason }, ack) => {
      const why = String(reason || 'No reason given').slice(0, 120);
      let t, rep;
      if (rpt) {
        rep = db.reports.find((x) => x.id === rpt);
        if (rep) { const o = rep[rep.by === 'a' ? 'b' : 'a']; t = { id: o.id, name: o.name, gender: o.gender, dev: rep.dev, ip: rep.ip, acct: String(o.name).toLowerCase() }; }
      } else t = users.get(sid);
      if (!t) return cb(ack)({ error: 'That user is no longer online.' });
      if (!block(t, why)) return cb(ack)({ error: 'This user cannot be identified well enough to block.' });
      if (t.acct && db.accts && db.accts[t.acct]) db.accts[t.acct].blocked = why;
      if (rep) { rep.s = 'blocked'; save(); toAdmins('admin:reports', reportList()); }
      cb(ack)({ ok: true });
    });
    A('admin:unblock', ({ k }, ack) => {
      const e = db.blocked.find((x) => x.k === k);
      if (e && e.acct && db.accts && db.accts[e.acct]) db.accts[e.acct].blocked = null;
      db.blocked = db.blocked.filter((x) => x.k !== k);
      save(); toAdmins('admin:blocked', blockedList()); pushUsers();
      cb(ack)({ ok: true });
    });
    A('admin:dismiss', ({ id }, ack) => {
      const r = db.reports.find((x) => x.id === id);
      if (r && r.s === 'new') { r.s = 'dismissed'; save(); toAdmins('admin:reports', reportList()); }
      cb(ack)({ ok: true });
    });

    // Chat with a user: the admin becomes that user's chat partner (shown to them as "Admin").
    A('admin:chat', ({ sid }, ack) => {
      const t = io.sockets.sockets.get(sid);
      if (!t || !users.has(sid)) return cb(ack)({ error: 'This user is offline.' });
      const cur = io.sockets.sockets.get(connections[sid]);
      if (cur && cur.isAdmin && cur.id !== socket.id) return cb(ack)({ error: 'Another admin is already chatting with this user.' });
      endCurrentChat(socket, true);
      endCurrentChat(t, true);
      removeFromQueue(t);
      connections[socket.id] = sid;
      connections[sid] = socket.id;
      t.emit('chatConnected', { partnerName: 'Admin', partnerGender: 'other' });
      pushUsers();
      cb(ack)({ ok: true });
    });
    A('admin:say', ({ text }, ack) => {
      const t = io.sockets.sockets.get(connections[socket.id]);
      const m = String(text == null ? '' : text).trim().slice(0, 500);
      if (!t || !m) return cb(ack)({ error: 'No active chat.' });
      t.emit('receiveMessage', { name: 'Admin', message: m });
      cb(ack)({ ok: true });
    });
    A('admin:end', (_, ack) => { endCurrentChat(socket, true); pushUsers(); cb(ack)({ ok: true }); });
    P.attach(socket, A);

    // Open to every user: report the current chat partner.
    socket.on('reportUser', (p) => {
      try {
        const c = chatOf.get(socket.id);
        if (!c) return;
        const by = c.a.sid === socket.id ? 'a' : 'b';
        const me = c[by], o = c[by === 'a' ? 'b' : 'a'];
        const key = (me.dev || me.ip || me.sid) + '>' + o.id;
        if (Date.now() - (seen.get(key) || 0) < 6e5) return;
        seen.set(key, Date.now());
        db.reports.unshift({
          id: rnd(5), t: Date.now(), reason: String((p && p.reason) || 'Other').slice(0, 60),
          a: arch(c.a), b: arch(c.b), by, m: c.m.slice(-30).map((e) => ({ ...e })), dev: o.dev, ip: o.ip, s: 'new'
        });
        db.reports = db.reports.slice(0, 200);
        save();
        toAdmins('admin:reports', reportList());
      } catch (e) { console.error('[admin] report', e); }
    });
  }

  // Download of saved chats as one HTML file (photos included). Needs the admin token.
  const esc = (s) => String(s == null ? '' : s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const when = (t) => new Date(t).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const page = (list) => '<!doctype html><meta charset="utf-8"><title>Chat Karo saved chats</title>' +
    '<style>body{font:15px system-ui,sans-serif;max-width:640px;margin:24px auto;padding:0 12px}h2{font-size:16px;margin:28px 0 2px}.m{margin:6px 0}img{max-width:220px;border-radius:8px;display:block;margin-top:4px}small{color:#777}</style>' +
    (list.length ? list.map((c) => `<h2>${esc(c.a.name)} (${esc(c.a.gender)}) and ${esc(c.b.name)} (${esc(c.b.gender)})</h2><small>${when(c.start)} to ${when(c.end)}</small>` +
      c.m.map((e) => `<div class="m"><b>${esc(c[e.w].name)}:</b> ${e.photo ? `<img src="${esc(e.photo)}">` : e.photo === null ? '[photo removed]' : esc(e.text)}</div>`).join('')).join('') : '<p>No saved chats.</p>');
  app.get('/__a/dl', (req, res) => {
    if (!(tokens.get(req.get('x-admin-token')) > Date.now())) return res.sendStatus(404);
    const id = req.query.id;
    const list = id ? db.archive.filter((c) => c.id === id) : db.archive;
    res.set({ 'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': 'attachment; filename="chat-karo-chats.html"', 'Cache-Control': 'no-store' }).send(page(list));
  });

  const ctx = { io, db, save, rnd, toAdmins, users, connections, waitingUsers, endCurrentChat, removeFromQueue, sanitize, clientIp, deviceId, mkPw, okPw, status, pushUsers, block, blockedList };
  const P = require('./premium')(ctx);

  const safe = (f) => (...a) => { try { return f(...a); } catch (e) { console.error('[admin]', e); } };
  const api = {
    attach: safe(attach),
    // Sets a device cookie on page loads so a permanent block can recognise the same browser later.
    cookie: (req, res, next) => {
      try {
        if ((req.path === '/' || req.path.endsWith('.html')) && !/(?:^|;\s*)ck_d=/.test(req.headers.cookie || '')) {
          res.cookie('ck_d', rnd(12), { maxAge: 31536e6, httpOnly: true, sameSite: 'lax', secure: req.secure || req.get('x-forwarded-proto') === 'https' });
        }
      } catch (e) { /* ignore */ }
      next();
    },
    // Called first in startSearch. Returns true when the request was handled (secret code or blocked user).
    gate: (socket, name, gender, pw) => {
      try {
        const r = login(socket, name, pw);
        if (r === true) return true;
        if (r === 'fail') { socket.emit('authError', 'Wrong password, or that name is already taken. Pick another name if it is not yours.'); return true; }
        if (P.auth(socket, name, gender, pw)) return true;
        const dv = deviceId(socket), ip = clientIp(socket);
        if (isBlocked(dv, ip)) { socket.emit('blocked'); return true; }
        users.set(socket.id, { sid: socket.id, id: (dv || socket.id).slice(0, 6), name: socket.dn, acct: socket.acct, gender: gender === 'male' || gender === 'female' ? gender : 'other', dev: dv, ip, since: Date.now() });
        pushUsers();
        return false;
      } catch (e) {
        console.error('[admin] gate', e);
        socket.emit('authError', 'Something went wrong. Please try again.');
        return true; // fail closed
      }
    },
    paired: safe((a, b) => {
      const ua = users.get(a.id), ub = users.get(b.id);
      if (!ua || !ub) return;
      [a.id, b.id].forEach((id) => { const old = chatOf.get(id); if (old) endLive(old); });
      const c = { id: rnd(6), start: Date.now(), a: ua, b: ub, m: [] };
      live.set(c.id, c); chatOf.set(a.id, c); chatOf.set(b.id, c);
      toAdmins('admin:live', liveList());
      pushUsers();
    }),
    msg: safe((socket, m) => {
      const c = chatOf.get(socket.id);
      if (!c) return;
      const e = Object.assign({ t: Date.now(), w: c.a.sid === socket.id ? 'a' : 'b' }, m);
      c.m.push(e);
      if (e.photo) { const ph = c.m.filter((x) => x.photo); if (ph.length > 12) ph[0].photo = null; }
      if (c.m.length > 300) c.m.shift();
      toAdmins('admin:msg', { c: c.id, e });
    }),
    ended: safe((sid) => { const c = chatOf.get(sid); if (c) endLive(c); }),
    left: safe((socket) => { users.delete(socket.id); P.left(socket); pushUsers(); }),
    okPhoto: (s) => typeof s === 'string' && s.length < 1.5e6 && /^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(s),
    label: (s) => (s.acct ? P.label(s) : s.userData.name)
  };
  ctx.msg = api.msg;
  ctx.paired = api.paired;
  return api;
};

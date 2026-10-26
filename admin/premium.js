// Accounts, premium plans, payment requests, gifts, picking a chat partner and groups (server side).
// Every premium feature is checked here on the server, so nobody can switch one on from their browser.
const HOURS = 120; // each premium feature lasts 120 hours (5 days)
const PLANS = {
  1: { price: 10, name: 'Blue Tick', perks: ['tick'] },
  2: { price: 25, name: 'Plus', perks: ['tick', 'emoji', 'pick'] },
  3: { price: 50, name: 'Ultra', perks: ['tick', 'emoji', 'pick', 'bg', 'gifts', 'group'] }
};
const LABEL = {
  tick: 'Blue tick', emoji: 'Emoji tray', pick: 'Pick who to chat with',
  bg: '10 chat backgrounds', gifts: 'Gift buttons like ☕ coffee', group: 'Password-protected groups'
};
const EMOJI = '😀 😂 🥰 😍 😘 😎 🤩 🥳 😇 😉 😋 🤗 🤭 😏 😢 😭 😡 😱 🙄 🤔 👍 👏 🙏 💪 🔥 ✨ 💯 🎉 💖 💔 🌹 🎶'.split(' ');
const GIFTS = {
  coffee: ['☕', 'a coffee'], rose: ['🌹', 'a rose'], choc: ['🍫', 'a chocolate'], cake: ['🎂', 'a cake'],
  teddy: ['🧸', 'a teddy bear'], gift: ['🎁', 'a gift'], bouquet: ['💐', 'a bouquet'], pizza: ['🍕', 'a pizza']
};
// Taken from the QR you sent. Change them with the UPI_ID and UPI_NAME environment variables.
const PAY = { upi: process.env.UPI_ID || '6393300502@ibl', name: process.env.UPI_NAME || 'VISHAL KUMAR SINGH' };
const NAME_RE = /^[\p{L}\p{M}\p{N} ._-]{2,24}$/u;
const BAD = 'Wrong password, or that name is already taken. Pick another name if it is not yours.';

module.exports = function createPremium(c) {
  const { io, db, save, rnd, toAdmins, users, connections, endCurrentChat, removeFromQueue, sanitize, clientIp, deviceId, mkPw, okPw, status, pushUsers, block, blockedList } = c;
  db.accts = db.accts || {};
  db.reqs = db.reqs || [];
  const groups = new Map(), fails = new Map(), asks = new Map();
  const keys = Object.keys(LABEL);
  const now = () => Date.now();
  const rem = (a, p) => Math.max(0, (a.perks[p] || 0) - now());
  const on = (a, p) => rem(a, p) > 0;
  const kOf = (a) => a.n.toLowerCase();
  const sockOf = (id) => io.sockets.sockets.get(id);
  const acctOf = (s) => db.accts[s.acct];
  const label = (s) => { const a = acctOf(s); return s.userData.name + (a && on(a, 'tick') ? ' ✔' : ''); };
  const perksOf = (a) => Object.fromEntries(keys.map((p) => [p, rem(a, p)]));
  const meOf = (a) => ({ name: a.n, perks: perksOf(a), bg: on(a, 'bg') ? a.bg : 0, inbox: a.inbox.slice(-20), plans: PLANS, labels: LABEL, emoji: EMOJI, gifts: GIFTS, pay: PAY });
  const pushMe = (a) => io.to('u:' + kOf(a)).emit('me', meOf(a));
  const note = (a, text) => {
    a.inbox.push({ t: now(), text });
    a.inbox = a.inbox.slice(-30);
    save();
    io.to('u:' + kOf(a)).emit('note', text);
    pushMe(a);
    pushUsers();
  };
  const approve = (a, plan) => {
    const pl = PLANS[plan];
    pl.perks.forEach((p) => { a.perks[p] = Math.max(now(), a.perks[p] || 0) + HOURS * 36e5; });
    note(a, `🎉 ${pl.name} plan is active for 5 days. You got: ${pl.perks.map((p) => LABEL[p]).join(', ')}.`);
  };
  const reqs = () => db.reqs.slice(0, 100);

  // ---- groups ----
  const gList = () => [...groups.values()].map((g) => ({ id: g.id, name: g.name, owner: g.owner, n: g.mem.size }));
  const gInfo = (g) => io.to('g:' + g.id).emit('groupInfo', { name: g.name, n: g.mem.size });
  function closeGroup(g, why) {
    io.to('g:' + g.id).emit('groupClosed', why);
    for (const id of g.mem) { const s = sockOf(id); if (s) { s.leave('g:' + g.id); s.gid = null; } }
    groups.delete(g.id);
    toAdmins('admin:groups', gList());
  }
  function leaveGroup(s, g, dropped) {
    if (g.owner === s.acct && !dropped) return closeGroup(g, 'The owner closed the group.');
    g.mem.delete(s.id); s.leave('g:' + g.id); s.gid = null;
    io.to('g:' + g.id).emit('groupMsg', { sys: true, t: s.dn + ' left' });
    gInfo(g);
    toAdmins('admin:groups', gList());
  }
  setInterval(() => {
    for (const g of [...groups.values()]) {
      const o = db.accts[g.owner];
      if (!o || !on(o, 'group')) closeGroup(g, 'The owner’s premium ended, so this group is closed.');
    }
  }, 6e4).unref();

  // ---- sign in / create account (name + password from the front page) ----
  const fail = (s, m) => { s.emit('authError', m); return true; };
  function auth(socket, name, gender, pw) {
    const ip = clientIp(socket) || 'x';
    const f = fails.get(ip) || { c: 0, t: 0 };
    if (now() > f.t) { f.c = 0; f.t = now() + 9e5; }
    if (f.c >= 10) return fail(socket, 'Too many tries. Please wait a few minutes.');
    const nm = String(name == null ? '' : name).trim().replace(/\s+/g, ' ');
    if (!NAME_RE.test(nm)) return fail(socket, 'Name: 2 to 24 letters, numbers, spaces or . _ - only.');
    pw = String(pw == null ? '' : pw);
    if (pw.length < 4 || pw.length > 64) return fail(socket, 'Password must be 4 to 64 characters.');
    const k = nm.toLowerCase();
    let a = db.accts[k];
    if (!a) a = db.accts[k] = Object.assign({ n: nm, t: now(), seen: now(), perks: {}, bg: 0, inbox: [] }, mkPw(pw));
    else if (!a.h) Object.assign(a, mkPw(pw)); // developer reset this password: the user sets a new one now
    else if (!okPw(a, pw)) { f.c++; fails.set(ip, f); return fail(socket, BAD); }
    if (a.blocked) { socket.emit('blocked'); return true; }
    Object.assign(a, { seen: now(), g: gender === 'male' || gender === 'female' ? gender : 'other', dv: deviceId(socket), ip: clientIp(socket) });
    socket.acct = k;
    socket.dn = a.n;
    socket.join('u:' + k);
    save();
    socket.emit('me', meOf(a));
    return false;
  }

  function acctList() {
    const live = new Map([...users.values()].map((u) => [u.acct, u]));
    return Object.values(db.accts)
      .filter((a) => live.has(kOf(a)) || now() - a.seen < 864e5 || keys.some((p) => on(a, p)))
      .map((a) => {
        const u = live.get(kOf(a));
        return { k: kOf(a), name: a.n, gender: a.g || 'other', seen: a.seen, sid: u && u.sid, st: u ? status(u) : 'offline', perks: perksOf(a), blocked: a.blocked || null };
      });
  }

  function attach(socket, A) {
    const ack = (f) => (typeof f === 'function' ? f : () => {});
    // Events from signed-in users (they must have passed the front-page sign in).
    const Q = (ev, fn) => socket.on(ev, (...args) => {
      try { const a = acctOf(socket); if (a && !a.blocked && users.has(socket.id)) fn(a, ...args); } catch (e) { console.error('[premium]', ev, e); }
    });
    const partner = () => { const s = sockOf(connections[socket.id]); return s && !s.isAdmin ? s : null; };

    Q('meGet', (a) => socket.emit('me', meOf(a)));
    Q('payReq', (a, p) => {
      const plan = Number(p && p.plan);
      if (!PLANS[plan]) return;
      if (!db.reqs.some((r) => r.k === kOf(a) && r.plan === plan && r.s === 'new')) {
        db.reqs.unshift({ id: rnd(4), t: now(), k: kOf(a), name: a.n, plan, s: 'new' });
        db.reqs = db.reqs.slice(0, 200);
        save();
        toAdmins('admin:reqs', reqs());
      }
      socket.emit('note', 'Request sent. Your plan starts as soon as your payment is checked.');
    });

    // Emoji tray and gifts: only with the matching premium feature.
    Q('sendSticker', (a, p) => {
      const t = partner();
      if (!on(a, 'emoji') || !t || !EMOJI.includes(p && p.e)) return;
      t.emit('receiveSticker', { name: label(socket), e: p.e });
      c.msg(socket, { text: p.e });
    });
    Q('sendGift', (a, p) => {
      const t = partner(), g = p && Object.hasOwn(GIFTS, p.k) && GIFTS[p.k];
      if (!on(a, 'gifts') || !t || !g) return;
      t.emit('receiveSticker', { name: label(socket), e: g[0], txt: `${a.n} sent you ${g[1]}` });
      c.msg(socket, { text: `${g[0]} ${g[1]}` });
    });
    Q('setBg', (a, p) => {
      const i = Number(p && p.i);
      if (on(a, 'bg') && Number.isInteger(i) && i >= 0 && i <= 10) { a.bg = i; save(); pushMe(a); }
    });

    // Pick a person: the other user must accept before a chat starts.
    Q('pickList', (a, _, f) => {
      if (!on(a, 'pick')) return ack(f)({ error: 'Picking a person is part of the Plus and Ultra plans.' });
      ack(f)({
        list: [...users.values()].filter((u) => u.sid !== socket.id).slice(0, 100).map((u) => {
          const b = db.accts[u.acct];
          return { sid: u.sid, name: u.name + (b && on(b, 'tick') ? ' ✔' : ''), gender: u.gender, st: status(u) };
        })
      });
    });
    Q('pickReq', (a, p, f) => {
      if (!on(a, 'pick')) return ack(f)({ error: 'Picking a person is a premium feature.' });
      const t = p && sockOf(p.sid);
      if (!t || !users.has(t.id) || t.id === socket.id) return ack(f)({ error: 'That user is not online any more.' });
      const k = t.id + '<' + socket.id;
      if (asks.get(k) > now()) return ack(f)({ error: 'You already asked this person. Wait a minute.' });
      asks.set(k, now() + 6e4);
      t.emit('pickAsk', { from: socket.id, name: label(socket) });
      ack(f)({ ok: true });
    });
    Q('pickAns', (a, p) => {
      const r = p && sockOf(p.from), k = socket.id + '<' + (p && p.from);
      if (!r || !users.has(r.id) || !(asks.get(k) > now())) return;
      asks.delete(k);
      if (!p.ok) return r.emit('note', `${label(socket)} declined your request.`);
      [r, socket].forEach((s) => { endCurrentChat(s, true); removeFromQueue(s); });
      connections[r.id] = socket.id;
      connections[socket.id] = r.id;
      r.emit('chatConnected', { partnerName: label(socket), partnerGender: users.get(socket.id).gender });
      socket.emit('chatConnected', { partnerName: label(r), partnerGender: users.get(r.id).gender });
      c.paired(r, socket);
    });

    // Groups: anyone with the password can join, creating one needs the Ultra plan.
    const myGroup = () => groups.get(socket.gid);
    const join = (g) => {
      const old = myGroup(); if (old && old !== g) leaveGroup(socket, old);
      g.mem.add(socket.id); socket.gid = g.id; socket.join('g:' + g.id);
      io.to('g:' + g.id).emit('groupMsg', { sys: true, t: socket.dn + ' joined' });
      gInfo(g);
      toAdmins('admin:groups', gList());
    };
    Q('groupMk', (a, p, f) => {
      if (!on(a, 'group')) return ack(f)({ error: 'Creating groups is part of the Ultra plan.' });
      const nm = String((p && p.name) || '').trim().replace(/\s+/g, ' '), pw = String((p && p.pw) || '');
      if (!NAME_RE.test(nm) || pw.length < 4 || pw.length > 32) return ack(f)({ error: 'Group name: 2 to 24 characters. Password: 4 to 32 characters.' });
      const all = [...groups.values()];
      if (all.some((x) => x.name.toLowerCase() === nm.toLowerCase())) return ack(f)({ error: 'That group name is taken.' });
      if (all.some((x) => x.owner === socket.acct)) return ack(f)({ error: 'You already own a group. Close it first.' });
      const g = Object.assign({ id: rnd(3), name: nm, owner: socket.acct, mem: new Set(), m: [], t: now() }, mkPw(pw));
      groups.set(g.id, g);
      join(g);
      ack(f)({ ok: true });
    });
    Q('groupJoin', (a, p, f) => {
      const nm = String((p && p.name) || '').trim().toLowerCase();
      const g = [...groups.values()].find((x) => x.name.toLowerCase() === nm);
      if (!g || !okPw(g, String((p && p.pw) || ''))) return ack(f)({ error: 'Wrong group name or password.' });
      if (g.mem.size >= 30 && !g.mem.has(socket.id)) return ack(f)({ error: 'This group is full.' });
      join(g);
      ack(f)({ ok: true });
    });
    Q('groupSend', (a, p) => {
      const g = myGroup(), t = String((p && p.text) || '').trim().slice(0, 300);
      if (!g || !t) return;
      g.m = g.m.concat({ n: a.n, t: sanitize(t), at: now() }).slice(-100);
      io.to('g:' + g.id).emit('groupMsg', { n: label(socket), t: sanitize(t) });
    });
    Q('groupLeave', () => { const g = myGroup(); if (g) leaveGroup(socket, g); });

    // ---- developer actions ----
    const acct = (k) => db.accts[k];
    A('admin:perk', ({ k, p, on: v }, f) => {
      const a = acct(k);
      if (!a || !LABEL[p]) return ack(f)({ error: 'Not found.' });
      if (!v) { delete a.perks[p]; save(); pushMe(a); pushUsers(); }
      else if (!on(a, p)) { a.perks[p] = now() + HOURS * 36e5; note(a, `⭐ You got ${LABEL[p]} for 5 days.`); }
      ack(f)({ ok: true });
    });
    A('admin:plan', ({ k, plan }, f) => {
      const a = acct(k);
      if (!a || !PLANS[plan]) return ack(f)({ error: 'Not found.' });
      approve(a, plan);
      db.reqs.forEach((r) => { if (r.k === k && r.plan === Number(plan) && r.s === 'new') r.s = 'done'; });
      toAdmins('admin:reqs', reqs());
      ack(f)({ ok: true });
    });
    A('admin:master', ({ k, on: v }, f) => {
      const a = acct(k);
      if (!a) return ack(f)({ error: 'Not found.' });
      if (v) approve(a, 3); else { a.perks = {}; save(); pushMe(a); pushUsers(); }
      ack(f)({ ok: true });
    });
    A('admin:req', ({ id, ok }, f) => {
      const r = db.reqs.find((x) => x.id === id), a = r && acct(r.k);
      if (!r || r.s !== 'new' || !a) return ack(f)({ error: 'Not found.' });
      if (ok) approve(a, r.plan); else note(a, 'We could not find your payment. If you paid, please contact support with a screenshot.');
      r.s = ok ? 'done' : 'rejected';
      save();
      toAdmins('admin:reqs', reqs());
      ack(f)({ ok: true });
    });
    A('admin:note', ({ k, text }, f) => {
      const a = acct(k), t = String(text || '').trim().slice(0, 300);
      if (!a || !t) return ack(f)({ error: 'Type a message first.' });
      note(a, '💬 Admin: ' + t);
      ack(f)({ ok: true });
    });
    A('admin:ublock', ({ k, on: v, reason }, f) => {
      const a = acct(k);
      if (!a) return ack(f)({ error: 'Not found.' });
      if (v) {
        a.blocked = String(reason || 'No reason given').slice(0, 120);
        block({ id: a.n, name: a.n, gender: a.g || 'other', dev: a.dv, ip: a.ip, acct: k }, a.blocked);
      } else {
        a.blocked = null;
        db.blocked = db.blocked.filter((b) => b.acct !== k);
        toAdmins('admin:blocked', blockedList());
      }
      save(); pushUsers();
      ack(f)({ ok: true });
    });
    A('admin:resetpw', ({ k }, f) => { const a = acct(k); if (a) { a.h = null; save(); } ack(f)({ ok: !!a }); });
    A('admin:gclose', ({ id }, f) => { const g = groups.get(id); if (g) closeGroup(g, 'The developer closed this group.'); ack(f)({ ok: true }); });
    A('admin:creds', ({ cur, user, pw }, f) => {
      const first = !(db.dev && db.dev.h);
      if (!first && !okPw(db.dev, String(cur || ''))) return ack(f)({ error: 'Current password is wrong.' });
      user = String(user || '').trim().replace(/\s+/g, ' ');
      if (!/^[\p{L}\p{M}\p{N} ._-]{3,24}$/u.test(user)) return ack(f)({ error: 'Username: 3 to 24 letters, numbers, spaces or . _ -' });
      if (String(pw || '').length < 8) return ack(f)({ error: 'Password must be at least 8 characters.' });
      if (db.accts[user.toLowerCase()]) return ack(f)({ error: 'That name belongs to a user account. Pick another.' });
      db.dev = Object.assign({ user }, mkPw(String(pw)));
      save();
      ack(f)({ ok: true });
    });
  }

  return {
    auth, attach, label, acctList,
    left: (s) => {
      const a = acctOf(s);
      if (a) { a.seen = now(); save(); }
      const g = groups.get(s.gid);
      if (g) leaveGroup(s, g, true);
    },
    snapshot: () => ({ accts: acctList(), reqs: reqs(), groups: gList() })
  };
};

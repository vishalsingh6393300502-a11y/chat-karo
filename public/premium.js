// Premium features on the user side. Locked features only open the buy popup; the server checks everything again.
(() => {
  const $ = (id) => document.getElementById(id);
  const h = (t, p, ...k) => {
    const e = document.createElement(t);
    for (const a in p || {}) a === 'c' ? (e.className = p[a]) : a in e ? (e[a] = p[a]) : e.setAttribute(a, p[a]);
    k.flat(2).forEach((x) => x != null && x !== false && e.append(x.nodeType ? x : String(x)));
    return e;
  };
  const ICONS = { tick: '✔', emoji: '😊', pick: '👥', bg: '🎨', gifts: '☕', group: '👪' };
  const BG = ['linear-gradient(160deg,#1d2b64,#f8cdda)', 'linear-gradient(160deg,#0f2027,#2c5364)', 'linear-gradient(160deg,#42275a,#734b6d)',
    'linear-gradient(160deg,#134e5e,#71b280)', 'linear-gradient(160deg,#614385,#516395)', 'linear-gradient(160deg,#232526,#414345)',
    'linear-gradient(160deg,#4b1248,#f0c27b)', 'linear-gradient(160deg,#0b486b,#f56217)', 'linear-gradient(160deg,#1e3c72,#2a5298)',
    'linear-gradient(160deg,#3a1c71,#d76d77,#ffaf7b)'];
  let ME = null, at = 0, shown = false, plan = 3, tick = null, rt = 0, curG = '';

  const rem = (p) => Math.max(0, ((ME && ME.perks[p]) || 0) - (Date.now() - at));
  const has = (p) => rem(p) > 0;
  const anyPrem = () => !!ME && Object.keys(ME.labels).some(has);
  const clock = (ms) => {
    const s = Math.ceil(ms / 1000), d = (s / 86400) | 0;
    return (d ? d + 'd ' : '') + [((s % 86400) / 3600) | 0, ((s % 3600) / 60) | 0, s % 60].map((x) => String(x).padStart(2, '0')).join(':');
  };
  const inChat = () => $('chat').classList.contains('active');
  const seenT = () => { try { return +localStorage.cb_seen || 0; } catch (e) { return 0; } };

  const CSS = `
.pmo{display:none;position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:300;align-items:flex-end;justify-content:center}.pmo.on{display:flex}
.pmb{width:min(560px,100%);max-height:88dvh;overflow:auto;background:#1a1a2e;border:1px solid #2a2a4a;border-radius:16px 16px 0 0;padding:16px;display:flex;flex-direction:column;gap:12px;color:#e0e0e0}
.pmh{display:flex;justify-content:space-between;align-items:center;font-size:1.05rem;color:#fff}
.pmx{background:none;border:0;color:#aaa;font-size:1.1rem;cursor:pointer;padding:4px 8px}
.pb{position:fixed;top:10px;left:50%;transform:translateX(-50%);width:min(340px,92vw);background:#1a1a2e;border:1px solid #7b8cde;border-radius:12px;padding:12px 36px 12px 14px;z-index:250;display:flex;flex-direction:column;gap:6px;font-size:.85rem;color:#e0e0e0}
.pb .pmx{position:absolute;top:4px;right:4px}
.pl{text-align:left;background:#15152a;border:1px solid #2a2a4a;border-radius:10px;padding:10px 12px;color:#e0e0e0;display:flex;flex-direction:column;gap:2px;cursor:pointer;font:inherit}.pl.on{border-color:#7b8cde;background:#20203c}
.pl small,.pmb small{color:#9a9ab5}
.nt{background:#3a2d00;border:2px solid #ffc83d;color:#ffe08a;border-radius:10px;padding:12px;font-size:1.1rem;font-weight:700;line-height:1.4;text-align:center}
.nt b{display:block;font-size:1.6rem;color:#fff;margin:4px 0;word-break:break-all}
.qr{width:min(280px,100%);align-self:center;border-radius:10px;background:#fff}
.gr{display:grid;grid-template-columns:repeat(auto-fill,minmax(56px,1fr));gap:8px}
.gr button{font-size:1.6rem;background:#15152a;border:1px solid #2a2a4a;border-radius:10px;padding:8px;cursor:pointer;color:#fff;min-height:48px;display:flex;flex-direction:column;align-items:center}
.gr button small{font-size:.65rem}
.row2{display:flex;gap:8px}.row2>*{flex:1}
.pr{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #2a2a4a}
.pmb input{padding:10px 12px;border-radius:8px;border:1px solid #333;background:#1e1e1e;color:#e0e0e0;font-size:1rem;width:100%}
.vt{color:#3ea6ff;font-weight:700}
.big{font-size:2.6rem;line-height:1.15}.gt{font-size:.8rem;opacity:.8}
.tt{position:fixed;top:12px;left:50%;transform:translateX(-50%);background:#111;border:1px solid #7b8cde;color:#fff;padding:10px 14px;border-radius:10px;z-index:400;max-width:92vw;font-size:.9rem}
.bdg{display:none;position:absolute;top:2px;right:2px;width:9px;height:9px;border-radius:50%;background:#e05c5c}
#gp{display:none;position:fixed;inset:0;background:#0d0d0d;z-index:260;flex-direction:column;max-width:640px;margin:0 auto;color:#e0e0e0}#gp.on{display:flex}
.gh{display:flex;gap:10px;align-items:center;padding:10px 14px;background:#1a1a2e;border-bottom:1px solid #2a2a4a}.gh b{flex:1;color:#fff}
#gm{flex:1;overflow:auto;padding:14px;display:flex;flex-direction:column;gap:8px}
#gm .gb{background:#2a2a3e;border-radius:12px;padding:8px 12px;word-break:break-word;align-self:flex-start;max-width:85%}#gm .gb.sys{background:none;color:#888;font-style:italic;align-self:center}
.gi{display:flex;gap:8px;padding:10px 14px;background:#1a1a2e;border-top:1px solid #2a2a4a}.gi input{flex:1;padding:10px 12px;border-radius:8px;border:1px solid #333;background:#1e1e1e;color:#e0e0e0;font-size:1rem}`;
  document.head.append(h('style', {}, CSS));

  // ---- small helpers: toast, bottom sheet, blue tick ----
  const toast = (m) => { const e = h('div', { c: 'tt' }, m); document.body.append(e); setTimeout(() => e.remove(), 6000); };
  const ov = h('div', { c: 'pmo', onclick: (e) => { if (e.target === ov) close(); } }), box = h('div', { c: 'pmb' });
  ov.append(box);
  document.body.append(ov);
  function close() { ov.classList.remove('on'); tick = null; }
  function sheet(title, ...nodes) {
    tick = null;
    box.replaceChildren(h('div', { c: 'pmh' }, h('b', {}, title), h('button', { c: 'pmx', 'aria-label': 'Close', onclick: close }, '✕')), ...nodes);
    ov.classList.add('on');
  }
  const tickify = (el) => {
    const parts = el.textContent.split('✔');
    if (parts.length < 2) return;
    el.textContent = '';
    parts.forEach((t, i) => { if (i) el.append(h('span', { c: 'vt', title: 'Premium member' }, '✔')); el.append(t); });
  };
  const _add = window.addMessage;
  window.addMessage = function () {
    _add.apply(this, arguments);
    const m = $('messages'), s = m.lastChild && m.lastChild.querySelector && m.lastChild.querySelector('.sender');
    if (s) tickify(s);
  };
  socket.on('chatConnected', () => tickify($('partnerName')));

  // ---- buying: plans, QR and the big "write your user id" note ----
  const minPlan = (p) => +Object.keys(ME.plans).find((k) => ME.plans[k].perks.includes(p));
  const need = (p) => { toast(ME.labels[p] + ' is a premium feature.'); buy(minPlan(p)); };
  function buy(sel) {
    if (!ME) return;
    if (sel) plan = sel;
    const P = ME.plans[plan], pay = ME.pay || {};
    const upi = pay.upi ? 'upi://pay?pa=' + pay.upi + '&pn=' + encodeURIComponent(pay.name || '') + '&am=' + P.price + '&cu=INR&tn=' + encodeURIComponent(ME.name) : '';
    sheet('Buy membership',
      ...Object.keys(ME.plans).map((k) => h('button', { c: 'pl' + (+k === plan ? ' on' : ''), onclick: () => buy(+k) },
        h('b', {}, '₹' + ME.plans[k].price + ' ' + ME.plans[k].name + ', 5 days'), h('small', {}, ME.plans[k].perks.map((p) => ME.labels[p]).join(', ')))),
      h('div', { c: 'nt' }, 'Send ₹' + P.price + ' to this QR code', h('b', {}, ME.name), 'Write this user id in the payment note. Do not forget!'),
      h('img', { c: 'qr', src: '/pay-qr.jpg', alt: 'Payment QR code' }),
      upi && h('a', { c: 'btn btn-primary', style: 'text-align:center;text-decoration:none', href: upi }, 'Pay ₹' + P.price + ' with a UPI app'),
      h('small', {}, 'On a phone: tap the button above, or save the QR image and scan it from your gallery in your UPI app.'),
      h('button', { c: 'btn btn-success', onclick: () => { socket.emit('payReq', { plan }); close(); } }, 'I have paid'),
      h('small', {}, 'After your payment is checked, your plan starts and a message appears in your 🔔.'));
  }
  const banner = h('div', { c: 'pb' },
    h('button', { c: 'pmx', 'aria-label': 'Close', onclick: () => banner.remove() }, '❌'),
    h('b', {}, '⭐ Go Premium'),
    h('div', {}, '✔ Blue tick from ₹10. Emoji, gifts, backgrounds and groups from ₹25.'),
    h('button', { c: 'btn btn-primary btn-sm', onclick: () => { banner.remove(); buy(); } }, 'Buy membership'));

  // ---- 🔔 bell: running timers and messages ----
  function bell() {
    if (!ME) return;
    try { localStorage.cb_seen = Date.now(); } catch (e) { /* ignore */ }
    bellBtn.querySelector('.bdg').style.display = 'none';
    const act = Object.keys(ME.labels).filter(has);
    sheet('Your premium',
      ...(act.length ? act.map((p) => h('div', { c: 'pl' }, h('b', {}, ICONS[p] + ' ' + ME.labels[p]), h('small', { 'data-p': p }, clock(rem(p)) + ' left')))
        : [h('small', {}, 'No active premium right now. Tap ⭐ to see what you can get.')]),
      h('b', {}, 'Messages'),
      ...(ME.inbox.length ? ME.inbox.slice().reverse().map((m) => h('div', { c: 'pl' }, h('small', {}, new Date(m.t).toLocaleString()), m.text)) : [h('small', {}, 'No messages yet.')]));
    tick = () => ov.querySelectorAll('[data-p]').forEach((e) => { e.textContent = clock(rem(e.dataset.p)) + ' left'; });
  }
  setInterval(() => tick && tick(), 1000);

  // ---- ⭐ menu and the features inside it ----
  const go = {
    emoji: () => emojiTray(), pick: () => pick(), bg: () => bgs(), gifts: () => gifts(), group: () => groupsMenu(),
    tick: () => toast('Your blue tick shows next to your name in chats.')
  };
  function menu() {
    if (!ME) return;
    sheet('Premium',
      ...Object.keys(ME.labels).map((p) => h('button', { c: 'pl', onclick: () => (has(p) ? go[p]() : need(p)) },
        h('b', {}, ICONS[p] + ' ' + ME.labels[p]), h('small', {}, has(p) ? 'Active, ' + clock(rem(p)) + ' left' : 'Locked. Buy a plan to use it.'))),
      h('button', { c: 'pl', onclick: () => groupsMenu() }, h('b', {}, '👪 Join a group'), h('small', {}, 'Enter a group name and its password.')),
      h('button', { c: 'btn btn-primary', onclick: () => buy() }, 'Buy membership'));
  }
  function sticker(e, name, cls, txt) {
    const m = $('messages');
    const d = h('div', { c: 'msg ' + cls }, name && h('div', { c: 'sender' }, name), h('div', { c: 'big' }, e), txt && h('div', { c: 'gt' }, txt));
    const s = d.querySelector('.sender');
    if (s) tickify(s);
    m.append(d);
    m.scrollTop = m.scrollHeight;
  }
  socket.on('receiveSticker', ({ name, e, txt }) => sticker(e, name, 'theirs', txt));
  function emojiTray() {
    sheet('Emoji', h('div', { c: 'gr' }, ME.emoji.map((e) => h('button', {
      onclick: () => { if (!inChat()) return toast('Start a chat first.'); socket.emit('sendSticker', { e }); sticker(e, null, 'mine'); close(); }
    }, e))));
  }
  function gifts() {
    sheet('Send a gift', h('div', { c: 'gr' }, Object.entries(ME.gifts).map(([k, [e, t]]) => h('button', {
      onclick: () => { if (!inChat()) return toast('Start a chat first.'); socket.emit('sendGift', { k }); sticker(e, null, 'mine', 'You sent ' + t); close(); }
    }, e, h('small', {}, t.replace(/^an? /, ''))))));
  }
  const applyBg = () => { const m = $('messages'); if (m) m.style.background = ME && has('bg') && ME.bg ? BG[ME.bg - 1] : ''; };
  function bgs() {
    const set = (i) => { socket.emit('setBg', { i }); close(); };
    sheet('Chat background', h('div', { c: 'gr' }, [h('button', { onclick: () => set(0) }, '⬜', h('small', {}, 'Default')), ...BG.map((g, i) => h('button', { style: 'background:' + g, onclick: () => set(i + 1) }, ' '))]));
  }
  function pick() {
    socket.emit('pickList', null, (r) => {
      if (r.error) return toast(r.error);
      sheet('Pick who to chat with',
        ...(r.list.length ? r.list.map((u) => h('div', { c: 'pr' }, h('div', {}, h('b', {}, u.name), h('small', {}, ' ' + u.gender + ', ' + u.st)),
          h('button', { c: 'btn btn-primary btn-sm', onclick: () => socket.emit('pickReq', { sid: u.sid }, (x) => { toast(x.error || 'Request sent. Waiting for them to accept.'); close(); }) }, 'Chat')))
          : [h('small', {}, 'Nobody else is online right now.')]));
      box.querySelectorAll('.pr b').forEach(tickify);
    });
  }
  socket.on('pickAsk', ({ from, name }) => {
    const reply = (ok) => { socket.emit('pickAns', { from, ok }); close(); };
    sheet('Chat request', h('p', {}, h('b', { id: 'pkn' }, name), ' wants to chat with you.'),
      h('div', { c: 'row2' }, h('button', { c: 'btn btn-success', onclick: () => reply(true) }, 'Accept'), h('button', { c: 'btn btn-danger', onclick: () => reply(false) }, 'Decline')));
    tickify($('pkn'));
    setTimeout(() => { if (ov.classList.contains('on') && $('pkn')) close(); }, 30000);
  });

  // ---- groups ----
  const gs = () => { const t = $('gt'); if (t.value.trim()) { socket.emit('groupSend', { text: t.value }); t.value = ''; } };
  const gp = h('div', { id: 'gp' },
    h('div', { c: 'gh' }, h('b', { id: 'gn' }, 'Group'), h('small', { id: 'gc' }), h('button', { c: 'btn btn-danger btn-sm', onclick: () => { socket.emit('groupLeave'); gp.classList.remove('on'); } }, 'Leave')),
    h('div', { id: 'gm' }),
    h('div', { c: 'gi' }, h('input', { id: 'gt', placeholder: 'Message the group', maxlength: 300, onkeydown: (e) => { if (e.key === 'Enter') gs(); } }), h('button', { c: 'btn btn-primary', onclick: gs }, 'Send')));
  document.body.append(gp);
  socket.on('groupInfo', ({ name, n }) => {
    if (name !== curG) { curG = name; $('gm').replaceChildren(); }
    $('gn').textContent = name;
    $('gc').textContent = n + ' in group';
    gp.classList.add('on');
  });
  socket.on('groupMsg', ({ n, t, sys }) => {
    const m = $('gm'), d = h('div', { c: 'gb' + (sys ? ' sys' : '') }, !sys && h('b', {}, n), !sys && ': ', t);
    const b = d.querySelector('b');
    if (b) tickify(b);
    m.append(d);
    m.scrollTop = m.scrollHeight;
  });
  socket.on('groupClosed', (why) => { gp.classList.remove('on'); curG = ''; toast(why); });
  function groupsMenu() {
    const n = h('input', { placeholder: 'Group name', maxlength: 24 }), p = h('input', { type: 'password', placeholder: 'Group password', maxlength: 32 });
    const run = (ev) => socket.emit(ev, { name: n.value, pw: p.value }, (r) => { if (r.error) toast(r.error); else close(); });
    sheet('Groups', h('small', {}, 'Join with the group name and password. Creating a group needs the Ultra plan.'), n, p,
      h('div', { c: 'row2' }, h('button', { c: 'btn btn-success', onclick: () => run('groupJoin') }, 'Join'),
        h('button', { c: 'btn btn-primary', onclick: () => (has('group') ? run('groupMk') : need('group')) }, 'Create')));
  }

  // ---- header buttons, emoji button and server messages ----
  const bellBtn = h('button', { c: 'btn btn-sm', style: 'background:#2a2a4a;color:#ccc;position:relative;display:none', title: 'Your premium', 'aria-label': 'Your premium', onclick: bell }, '🔔', h('b', { c: 'bdg' }));
  const starBtn = h('button', { c: 'btn btn-sm', style: 'background:#2a2a4a;color:#ccc', title: 'Premium', 'aria-label': 'Premium menu', onclick: menu }, '⭐');
  document.querySelector('.chat-actions').prepend(bellBtn, starBtn);
  $('inputArea').querySelector('.btn-primary').before(h('button', {
    c: 'btn', style: 'background:#2a2a4a;padding:12px 14px', 'aria-label': 'Emoji', title: 'Emoji',
    onclick: () => { if (!ME) return; if (has('emoji')) emojiTray(); else need('emoji'); }
  }, '😊'));

  socket.on('me', (m) => {
    ME = m; at = Date.now();
    bellBtn.style.display = anyPrem() || m.inbox.length ? '' : 'none';
    bellBtn.querySelector('.bdg').style.display = m.inbox.some((x) => x.t > seenT()) ? 'block' : 'none';
    applyBg();
    if (!shown && !anyPrem()) { shown = true; document.body.append(banner); }
    clearTimeout(rt);
    const next = Math.min(...Object.keys(m.labels).map(rem).filter((x) => x > 0));
    if (isFinite(next)) rt = setTimeout(() => socket.emit('meGet'), next + 800);
  });
  socket.on('note', (m) => toast(m));
  socket.on('authError', (m) => { alert(m); showScreen('landing'); });
})();

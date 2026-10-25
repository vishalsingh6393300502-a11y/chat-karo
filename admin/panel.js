(() => {
  const TK = window.__dvToken;
  const G = { male: '#5b9cff', female: '#ff69b4', other: '#ffa500' };
  const S = { tab: 'live', live: [], users: [], past: [], reports: [], blocked: [], store: true, view: null, chat: null, pulse: {} };
  const stack = [];

  // Names and messages are always inserted as text, never as HTML.
  const d = (s) => String(s == null ? '' : s).replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  const h = (t, p, ...k) => {
    const e = document.createElement(t);
    for (const a in p || {}) a === 'c' ? (e.className = p[a]) : a in e ? (e[a] = p[a]) : e.setAttribute(a, p[a]);
    k.flat(2).forEach((x) => x != null && x !== false && e.append(x.nodeType ? x : String(x)));
    return e;
  };
  const ask = (ev, data) => new Promise((r) => socket.timeout(10000).emit(ev, data, (err, res) => r(err ? { error: 'No response from server' } : res || {})));
  const ago = (t) => { const s = Math.max(0, ((Date.now() - t) / 1000) | 0); return s < 60 ? s + 's' : s < 3600 ? ((s / 60) | 0) + 'm' : ((s / 3600) | 0) + 'h'; };
  const dot = (g) => h('span', { c: 'g', style: 'background:' + (G[g] || G.other), title: g });
  const img = (s) => /^data:image\/(png|jpe?g|gif|webp);base64,/.test(s || '');
  const zoom = (src) => { const z = h('div', { c: 'z', onclick: () => z.remove() }, h('img', { src })); document.body.append(z); };
  const who = (u) => h('span', { c: 'wh' }, dot(u.gender), d(u.name), h('small', {}, ' #' + u.id + ' ' + u.gender));

  function bubble(c, e) {
    const u = c[e.w];
    return h('div', { c: 'm ' + (e.w === 'a' ? 'l' : 'r') },
      h('i', {}, d(u.name) + '  ' + new Date(e.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })),
      img(e.photo) ? h('img', { src: e.photo, onclick: () => zoom(e.photo) }) : e.photo === null ? '[photo removed]' : d(e.text));
  }

  // ---- sheets (full-screen panels with a back arrow) ----
  const sh = h('div', { c: 'sh' }), shTitle = h('b', { c: 'grow' }), shBody = h('div', { c: 'sb' });
  sh.append(h('div', { c: 'top' }, h('button', { c: 'ib', 'aria-label': 'Back', onclick: () => back() }, '←'), shTitle), shBody);
  function draw() {
    const s = stack[stack.length - 1];
    sh.classList.toggle('on', !!s);
    if (!s) return;
    shTitle.textContent = s.title;
    shBody.replaceChildren(...[].concat(s.build()));
  }
  function open(title, build, o) { stack.push({ title, build, ...o }); draw(); }
  function back() {
    const s = stack.pop();
    if (s && s.talk) { S.chat = null; ask('admin:end'); }
    if (s && s.view) S.view = null;
    draw();
  }

  async function doBlock(sid, rpt, name, why) {
    const reason = prompt('Why block ' + d(name) + '? It is saved in the blocked list.', why || 'Inappropriate behaviour');
    if (reason === null) return;
    const r = await ask('admin:block', { sid, rpt, reason });
    if (r.error) alert(r.error);
  }
  async function dl(id) {
    const r = await fetch('/__a/dl' + (id ? '?id=' + encodeURIComponent(id) : ''), { headers: { 'X-Admin-Token': TK } });
    if (!r.ok) return alert('Download failed');
    const a = h('a', { href: URL.createObjectURL(await r.blob()), download: 'chat-karo-chats.html' });
    document.body.append(a); a.click(); a.remove();
  }

  // Read-only view of a live chat, a saved chat or a reported chat.
  async function openChat(kind, id) {
    const c = await ask('admin:open', { kind, id });
    if (c.error) return alert(c.error);
    const list = h('div', { c: 'thread' });
    c.m.forEach((e) => list.append(bubble(c, e)));
    const o = c[c.by === 'a' ? 'b' : 'a'];
    const foot = h('div', { c: 'foot' },
      kind === 'live' ? [c.a, c.b].map((u) => h('button', { c: 'bt dn', onclick: () => doBlock(u.sid, null, u.name) }, 'Block ' + d(u.name)))
        : kind === 'report' ? h('button', { c: 'bt dn', onclick: () => doBlock(null, id, o.name) }, 'Block ' + d(o.name))
        : h('button', { c: 'bt', onclick: () => dl(id) }, 'Download this chat'));
    S.view = { kind, id, c, list, foot };
    open(d(c.a.name) + ' & ' + d(c.b.name), () => [h('div', { c: 'who' }, who(c.a), who(c.b)), list, foot], { view: true });
    list.scrollTop = list.scrollHeight;
  }

  // Chat with one online user.
  const say = (cls, x) => { const c = S.chat; if (!c) return; c.list.append(h('div', { c: 'm ' + cls }, x)); c.list.scrollTop = c.list.scrollHeight; };
  function openTalk(u) {
    const list = h('div', { c: 'thread' }), bar = h('div', { c: 'foot' });
    const inp = h('input', { c: 'in', placeholder: 'Message ' + d(u.name), maxlength: 500 });
    const send = () => { const t = inp.value.trim(); if (!t || !S.chat) return; ask('admin:say', { text: t }); say('r', t); inp.value = ''; };
    inp.onkeydown = (e) => { if (e.key === 'Enter') send(); };
    const note = h('p', { c: 'note' }, 'Starting a chat disconnects ' + d(u.name) + ' from their current partner. They will see you as "Admin".');
    bar.append(h('button', {
      c: 'bt',
      onclick: async () => {
        const r = await ask('admin:chat', { sid: u.sid });
        if (r.error) return alert(r.error);
        S.chat = { list, bar }; note.remove();
        bar.replaceChildren(inp, h('button', { c: 'bt', onclick: send }, 'Send')); inp.focus();
      }
    }, 'Start chat'));
    open(d(u.name), () => [h('div', { c: 'who' }, who(u)), note, list, bar], { talk: true });
  }

  // ---- bell and blocked-users panels ----
  const bellBody = () => S.reports.length ? S.reports.map((r) => {
    const by = r[r.by], on = r[r.by === 'a' ? 'b' : 'a'];
    return h('div', { c: 'row col' },
      h('div', {}, h('b', {}, d(on.name)), ' reported by ' + d(by.name), h('small', {}, '  ' + ago(r.t) + ' ago')),
      h('div', { c: 'why' }, r.reason, r.s !== 'new' && h('span', { c: 'tag' }, r.s)),
      h('div', { c: 'acts' },
        h('button', { c: 'bt', onclick: () => openChat('report', r.id) }, 'View chat'),
        r.s === 'new' && h('button', { c: 'bt dn', onclick: () => doBlock(null, r.id, on.name, r.reason) }, 'Block'),
        r.s === 'new' && h('button', { c: 'bt', onclick: () => ask('admin:dismiss', { id: r.id }) }, 'Dismiss')));
  }) : [h('p', { c: 'empty' }, 'No reports yet. When a user reports their chat partner it shows up here.')];

  const blockedBody = () => S.blocked.length ? S.blocked.map((b) => h('div', { c: 'row col' },
    h('div', {}, dot(b.gender), h('b', {}, ' ' + d(b.name)), h('small', {}, '  #' + b.id + '  ' + new Date(b.t).toLocaleDateString())),
    h('div', { c: 'why' }, d(b.reason), h('span', { c: 'tag' }, b.dev && b.net ? 'device + network' : b.dev ? 'device' : 'network')),
    h('div', { c: 'acts' }, h('button', { c: 'bt', onclick: () => confirm('Unblock ' + d(b.name) + '?') && ask('admin:unblock', { k: b.k }) }, 'Unblock'))))
    : [h('p', { c: 'empty' }, 'Nobody is blocked.')];

  // ---- main tabs ----
  const vLive = () => [h('h2', { c: 'hd' }, 'Live connections'), ...(S.live.length ? S.live.map((c) =>
    h('div', { c: 'conn' + (Date.now() - (S.pulse[c.id] || 0) < 1500 ? ' pulse' : ''), onclick: () => openChat('live', c.id) },
      h('div', { c: 'pair' }, h('span', {}, dot(c.a.gender), d(c.a.name)), h('i', { c: 'wire' }), h('span', {}, dot(c.b.gender), d(c.b.name))),
      h('small', {}, c.last ? d(c.last) : 'No messages yet'),
      h('small', {}, c.n + ' messages, started ' + ago(c.start) + ' ago'))) : [h('p', { c: 'empty' }, 'Nobody is chatting right now.')])];

  const vPast = () => [
    h('h2', { c: 'hd' }, 'Past connections, last 24 hours'),
    h('div', { c: 'bar2' },
      h('label', { c: 'sw' },
        h('input', { type: 'checkbox', checked: S.store, onchange: (e) => { S.store = e.target.checked; ask('admin:store', S.store); render(); } }),
        h('span', { c: 'knob' }), S.store ? 'Storing chats' : 'Not storing chats'),
      h('button', { c: 'bt', onclick: () => dl() }, 'Download all')),
    h('p', { c: 'note' }, S.store ? 'Finished chats are saved and deleted automatically 24 hours later.' : 'New chats are not being saved.'),
    ...(S.past.length ? S.past.map((c) => h('div', { c: 'row', onclick: () => openChat('past', c.id) },
      h('div', { c: 'grow' }, h('b', {}, d(c.a.name) + ' & ' + d(c.b.name)), h('small', {}, c.n + ' messages, ended ' + ago(c.end) + ' ago')),
      h('small', {}, Math.max(1, Math.ceil(24 - (Date.now() - c.end) / 36e5)) + 'h left'))) : [h('p', { c: 'empty' }, 'No saved chats.')])];

  const vUsers = () => [h('h2', { c: 'hd' }, 'Online users'), ...(S.users.length ? S.users.map((u) =>
    h('div', { c: 'row', onclick: () => openTalk(u) }, dot(u.gender),
      h('div', { c: 'grow' }, h('b', {}, d(u.name)), h('small', {}, '#' + u.id + '  ' + u.gender + ', ' + u.st)),
      h('button', { c: 'bt dn', onclick: (e) => { e.stopPropagation(); doBlock(u.sid, null, u.name); } }, 'Block'))) : [h('p', { c: 'empty' }, 'Nobody is online yet.')])];

  const pane = h('div', { id: 'pane' }), tabs = h('div', { c: 'tabs' }), bd = h('b', { c: 'bd', hidden: true });
  function render() {
    const n = S.reports.filter((r) => r.s === 'new').length;
    bd.textContent = n; bd.hidden = !n;
    tabs.replaceChildren(...[['live', 'Live', S.live.length], ['past', 'Past', S.past.length], ['users', 'Online', S.users.length]]
      .map(([k, l, c]) => h('button', { c: S.tab === k ? 'on' : '', onclick: () => { S.tab = k; render(); } }, l + ' ' + c)));
    pane.replaceChildren(...[].concat(S.tab === 'live' ? vLive() : S.tab === 'past' ? vPast() : vUsers()));
    const s = stack[stack.length - 1];
    if (s && s.refresh) draw();
  }

  // ---- live updates from the server ----
  socket.on('admin:live', (v) => {
    S.live = v;
    const w = S.view;
    if (w && w.kind === 'live' && !v.some((x) => x.id === w.id)) { w.kind = 'ended'; w.list.append(h('div', { c: 'm sys' }, 'This chat has ended.')); w.foot.remove(); }
    render();
  });
  socket.on('admin:users', (v) => { S.users = v; render(); });
  socket.on('admin:past', (v) => { S.past = v; render(); });
  socket.on('admin:reports', (v) => { S.reports = v; render(); });
  socket.on('admin:blocked', (v) => { S.blocked = v; render(); });
  socket.on('admin:store', (v) => { S.store = v; render(); });
  socket.on('admin:msg', ({ c, e }) => {
    const l = S.live.find((x) => x.id === c);
    if (l) { l.n++; l.last = img(e.photo) ? '📷 Photo' : e.text; S.pulse[c] = Date.now(); }
    const w = S.view;
    if (w && w.kind === 'live' && w.id === c) { w.list.append(bubble(w.c, e)); w.list.scrollTop = w.list.scrollHeight; }
    if (S.tab === 'live') render();
  });
  // Replies from the user while chatting with them.
  socket.on('receiveMessage', ({ message }) => say('l', d(message)));
  socket.on('receivePhoto', ({ photo }) => say('l', img(photo) ? h('img', { src: photo, onclick: () => zoom(photo) }) : '[photo]'));
  socket.on('partnerDisconnected', () => { if (S.chat) { say('sys', 'The user left the chat.'); S.chat.bar.replaceChildren(); S.chat = null; } });

  const ban = h('div', { c: 'ban', hidden: true }, 'Connection lost. Reconnecting…');
  async function sync() { Object.assign(S, await ask('admin:sync')); render(); }
  socket.on('disconnect', () => { ban.textContent = 'Connection lost. Reconnecting…'; ban.hidden = false; });
  socket.on('connect', async () => {
    const r = await ask('admin:resume', TK);
    if (r.ok) { ban.hidden = true; sync(); } else { ban.textContent = 'Session ended. Reload the page and enter the code again.'; ban.hidden = false; }
  });

  // ---- shell ----
  const menu = h('div', { c: 'menu' },
    h('button', { onclick: () => { menu.classList.remove('on'); open('Blocked users', blockedBody, { refresh: true }); } }, 'Blocked users'),
    h('button', { onclick: () => location.reload() }, 'Exit developer mode'));
  document.addEventListener('click', (e) => { if (!e.target.closest('.menu') && !e.target.closest('.more')) menu.classList.remove('on'); });

  const CSS = `
#dv{position:fixed;top:0;bottom:0;left:0;right:0;max-width:760px;margin:0 auto;z-index:9999;background:#0d0d0d;color:#e0e0e0;font:15px "Segoe UI",system-ui,sans-serif;display:flex;flex-direction:column}
#dv *{box-sizing:border-box}#dv button,#dv input{font:inherit;color:inherit}#dv button{cursor:pointer}
#dv :focus-visible{outline:2px solid #7b8cde;outline-offset:2px}
.top{display:flex;align-items:center;gap:4px;padding:8px 10px;background:#1a1a2e;border-bottom:1px solid #2a2a4a;min-height:54px}
.top h1{flex:1;font-size:1.05rem;color:#7b8cde;padding-left:4px}
.ib{position:relative;background:none;border:0;font-size:1.25rem;padding:6px 11px;border-radius:8px}.ib:hover{background:#2a2a4a}
.bd{position:absolute;top:0;right:2px;min-width:18px;height:18px;border-radius:9px;background:#e05c5c;color:#fff;font-size:.7rem;display:flex;align-items:center;justify-content:center;padding:0 4px}.bd[hidden]{display:none}
.menu{position:absolute;right:10px;top:52px;background:#111;border:1px solid #2a2a4a;border-radius:8px;display:none;flex-direction:column;z-index:5;overflow:hidden}.menu.on{display:flex}
.menu button{background:none;border:0;padding:12px 18px;text-align:left}.menu button:hover{background:#2a2a4a}
.ban{background:#5a2a2a;padding:8px 12px;font-size:.85rem}
.tabs{display:flex;border-bottom:1px solid #2a2a4a}
.tabs button{flex:1;background:none;border:0;padding:13px 4px;color:#888;border-bottom:2px solid transparent}.tabs .on{color:#fff;border-color:#7b8cde}
#pane,.sb{flex:1;overflow:auto;padding:12px}
.sb{display:flex;flex-direction:column;gap:8px}
.hd{font-size:.9rem;color:#aaa;font-weight:500;margin:2px 2px 10px}
.row,.conn{display:flex;align-items:center;gap:10px;padding:12px;border:1px solid #2a2a4a;border-radius:10px;background:#15152a;margin-bottom:8px;cursor:pointer}
.row.col{flex-direction:column;align-items:stretch;cursor:default;gap:8px}
.conn{flex-direction:column;align-items:stretch;gap:4px}
.grow{flex:1;min-width:0;display:flex;flex-direction:column}
small{color:#888;font-size:.78rem}
.g{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:7px;flex:none}
.pair{display:flex;align-items:center;font-weight:600}.pair span{display:flex;align-items:center;max-width:38%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wire{flex:1;height:2px;background:#2a2a4a;position:relative;margin:0 12px}
.pulse .wire::after{content:"";position:absolute;top:-3px;width:8px;height:8px;border-radius:50%;background:#6bcb77;animation:go 1s linear}
@keyframes go{from{left:0}to{left:calc(100% - 8px)}}
@media (prefers-reduced-motion:reduce){.pulse .wire::after{animation:none;left:50%}}
.empty,.note{color:#888;font-size:.88rem;padding:6px 2px}
.bar2{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:4px 2px 8px}
.sw{position:relative;display:flex;align-items:center;gap:10px;cursor:pointer}.sw input{position:absolute;opacity:0;width:44px;height:24px;margin:0}
.knob{width:44px;height:24px;border-radius:12px;background:#333;position:relative;transition:background .2s;flex:none}
.knob::after{content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;transition:left .2s}
.sw input:checked+.knob{background:#6bcb77}.sw input:checked+.knob::after{left:23px}.sw input:focus-visible+.knob{outline:2px solid #7b8cde}
.bt{padding:8px 14px;border-radius:8px;border:0;background:#2a2a4a}.bt.dn{background:#e05c5c;color:#fff}
.acts,.foot{display:flex;gap:8px;flex-wrap:wrap}.foot{padding-top:8px}
.why{display:flex;gap:8px;align-items:center;color:#ccc}.tag{font-size:.72rem;background:#2a2a4a;border-radius:6px;padding:2px 7px;color:#aaa}
.sh{position:absolute;top:0;bottom:0;left:0;right:0;background:#0d0d0d;display:none;flex-direction:column;z-index:4}.sh.on{display:flex}
.who{display:flex;gap:16px;flex-wrap:wrap;font-weight:600}.wh{display:flex;align-items:center}.wh small{margin-left:6px;font-weight:400}
.thread{flex:1;overflow:auto;display:flex;flex-direction:column;gap:8px;padding:6px 0;min-height:120px}
.m{max-width:80%;padding:8px 12px;border-radius:12px;background:#2a2a3e;word-break:break-word}
.m.r{align-self:flex-end;background:#7b8cde;color:#fff}.m.l{align-self:flex-start}.m.sys{align-self:center;background:none;color:#888;font-style:italic}
.m i{display:block;font-size:.72rem;opacity:.7;font-style:normal;margin-bottom:2px}
.m img{max-width:200px;border-radius:8px;display:block;cursor:zoom-in}
.in{flex:1;min-width:0;padding:10px 12px;border-radius:8px;border:1px solid #333;background:#1e1e1e}
.z{position:fixed;top:0;bottom:0;left:0;right:0;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;z-index:10000}.z img{max-width:96%;max-height:96%}`;

  document.head.append(h('style', {}, CSS));
  document.body.append(h('div', { id: 'dv' },
    h('div', { c: 'top' }, h('h1', {}, 'Developer console'),
      h('button', { c: 'ib', 'aria-label': 'Reports', onclick: () => open('Reports', bellBody, { refresh: true }) }, '🔔', bd),
      h('button', { c: 'ib more', 'aria-label': 'More', onclick: () => menu.classList.toggle('on') }, '⋮')),
    menu, ban, tabs, pane, sh));
  render();
  sync();
  setInterval(render, 30000);
})();


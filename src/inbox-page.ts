// @ts-nocheck
// Single-page staff inbox served at /inbox. Staff get a personal link from
// the bot (type "inbox" in a 1:1 chat with the OA); the token in it is kept in
// localStorage and sent as a bearer token.
export const INBOX_PAGE_HTML = `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Mama Inbox</title>
<style>
:root{--bg:#f2f3f5;--card:#fff;--ink:#16181d;--mute:#6b7280;--line:#e5e7eb;--brand:#06c755;--me:#d9fdd3;--bot:#eef0f3;--ai:#e8f0ff;--warn:#e5484d}
@media (prefers-color-scheme:dark){:root{--bg:#111315;--card:#1b1e22;--ink:#eceef1;--mute:#9aa1ab;--line:#2a2e34;--me:#1f3a26;--bot:#24282e;--ai:#1d2a44}}
*{box-sizing:border-box}html,body{margin:0;height:100%;background:var(--bg);color:var(--ink);font:15px/1.45 -apple-system,BlinkMacSystemFont,"Sukhumvit Set","Noto Sans Thai",sans-serif}
header{position:sticky;top:0;z-index:5;background:var(--card);border-bottom:1px solid var(--line);padding:10px 12px;display:flex;gap:8px;align-items:center}
header h1{font-size:17px;margin:0;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
button{font:inherit;border:0;border-radius:10px;padding:8px 12px;background:var(--bot);color:var(--ink);cursor:pointer}
button.primary{background:var(--brand);color:#fff}button.warn{background:var(--warn);color:#fff}
.tabs{display:flex;gap:6px;padding:8px 12px;overflow-x:auto;background:var(--card);border-bottom:1px solid var(--line)}
.tabs button{white-space:nowrap;padding:6px 12px;border-radius:999px}.tabs button.on{background:var(--ink);color:var(--card)}
.search{padding:8px 12px;background:var(--card);border-bottom:1px solid var(--line)}
input,textarea{font:inherit;width:100%;border:1px solid var(--line);border-radius:10px;padding:9px 11px;background:var(--bg);color:var(--ink)}
.list{padding:0;margin:0;list-style:none}
.row{display:flex;gap:10px;padding:11px 12px;border-bottom:1px solid var(--line);background:var(--card);cursor:pointer}
.av{width:42px;height:42px;border-radius:50%;background:var(--bot);flex:none;object-fit:cover}
.mid{flex:1;min-width:0}.top{display:flex;gap:6px;align-items:baseline}.nm{font-weight:600;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tm{color:var(--mute);font-size:12px;flex:none}.pv{color:var(--mute);font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dot{width:9px;height:9px;border-radius:50%;background:var(--brand);flex:none;margin-top:6px}
.tag{font-size:11px;padding:1px 6px;border-radius:6px;background:var(--bot);color:var(--mute);margin-left:4px}
#thread{display:none;flex-direction:column;height:100dvh}
.msgs{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:6px}
.b{max-width:82%;padding:8px 11px;border-radius:14px;white-space:pre-wrap;word-break:break-word}
.in{align-self:flex-start;background:var(--card);border:1px solid var(--line)}
.out{align-self:flex-end;background:var(--bot)}.out.staff{background:var(--me)}.out.ai{background:var(--ai)}
.who{font-size:11px;color:var(--mute);margin-bottom:2px}.b img{max-width:100%;border-radius:8px;display:block}
.day{align-self:center;font-size:12px;color:var(--mute);margin:6px 0}
.bar{padding:8px 12px;background:var(--card);border-top:1px solid var(--line)}
.hold{font-size:13px;color:var(--mute);padding:6px 12px;background:var(--card);border-top:1px solid var(--line);display:flex;gap:8px;align-items:center}
.hold span{flex:1}.compose{display:flex;gap:8px;align-items:flex-end}.compose textarea{resize:none;max-height:140px}
.empty{padding:40px 16px;text-align:center;color:var(--mute)}
</style>
</head>
<body>
<div id="home">
  <header><h1>Mama Inbox</h1><span id="me" class="tm"></span></header>
  <div class="tabs" id="tabs">
    <button data-f="lead" class="on">ลูกค้าใหม่</button>
    <button data-f="waiting">รอตอบ</button>
    <button data-f="tenant">ผู้เช่า</button>
    <button data-f="all">ทั้งหมด</button>
  </div>
  <div class="search"><input id="q" placeholder="ค้นหาชื่อ ห้อง หรือข้อความ" autocomplete="off"></div>
  <ul class="list" id="list"></ul>
</div>
<div id="thread">
  <header><button id="back">‹</button><h1 id="tname"></h1></header>
  <div class="msgs" id="msgs"></div>
  <div class="hold"><span id="holdtxt"></span><button id="holdbtn"></button></div>
  <div class="bar"><div class="compose">
    <textarea id="text" rows="1" placeholder="พิมพ์ตอบลูกค้า"></textarea>
    <button class="primary" id="send">ส่ง</button>
  </div></div>
</div>
<script>
const qs = new URLSearchParams(location.search);
try { if (qs.get('t')) { localStorage.setItem('inboxToken', qs.get('t')); history.replaceState(null, '', location.pathname); } } catch (_) {}
let token = ''; try { token = localStorage.getItem('inboxToken') || ''; } catch (_) {}
let filter = 'lead', current = null, timer = null, lastSig = '';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const t2 = (ms) => { const d = new Date(ms), n = new Date(); return d.toDateString() === n.toDateString()
  ? d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }); };
async function api(path, opt = {}) {
  const res = await fetch(path, { ...opt, headers: { ...(opt.headers || {}), Authorization: 'Bearer ' + token, 'content-type': 'application/json' } });
  if (res.status === 401) { document.body.innerHTML = '<div class="empty">ลิงก์หมดอายุหรือไม่ถูกต้อง<br>พิมพ์ <b>inbox</b> ในแชท LINE กับมามา แมนชั่น เพื่อรับลิงก์ใหม่</div>'; throw new Error('auth'); }
  return res.json();
}
function who(m) {
  if (m.dir === 'IN') return '';
  if (m.author.startsWith('staff:')) return m.author.slice(6);
  return m.author === 'ai' ? 'AI' : 'บอท';
}
async function loadList() {
  const d = await api('/inbox/api/chats?f=' + filter + '&q=' + encodeURIComponent($('q').value));
  $('list').innerHTML = d.chats.length ? d.chats.map((c) => '<li class="row" data-u="' + c.u + '">' +
    (c.pic ? '<img class="av" src="' + esc(c.pic) + '">' : '<div class="av"></div>') +
    '<div class="mid"><div class="top"><span class="nm">' + esc(c.name || c.u.slice(0, 10)) +
    (c.room ? '<span class="tag">' + esc(c.room) + '</span>' : '') + (c.human ? '<span class="tag">' + esc(c.human) + ' ตอบอยู่</span>' : '') +
    '</span><span class="tm">' + t2(c.at) + '</span></div><div class="pv">' + (c.author && c.author !== 'customer' ? esc(c.author.replace('staff:', '')) + ': ' : '') + esc(c.text) + '</div></div>' +
    (c.waiting ? '<span class="dot"></span>' : '') + '</li>').join('') : '<div class="empty">ไม่มีแชท</div>';
}
function renderThread(d) {
  const c = d.contact || {};
  $('tname').textContent = (c.name || '') + (c.room ? ' · ' + c.room : '');
  let html = '', day = '';
  for (const m of d.messages) {
    const dd = new Date(m.at).toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short' });
    if (dd !== day) { html += '<div class="day">' + dd + '</div>'; day = dd; }
    const cls = m.dir === 'IN' ? 'in' : 'out ' + (m.author.startsWith('staff:') ? 'staff' : m.author === 'ai' ? 'ai' : '');
    const body = m.media ? '<img src="' + esc(m.media) + '" loading="lazy">' : esc(m.text);
    const label = who(m);
    html += '<div class="b ' + cls + '">' + (label ? '<div class="who">' + esc(label) + ' · ' + t2(m.at) + '</div>' : '<div class="who">' + t2(m.at) + '</div>') + body + '</div>';
  }
  const box = $('msgs'), atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  box.innerHTML = html || '<div class="empty">ยังไม่มีข้อความ</div>';
  if (atBottom || !box.dataset.ready) { box.scrollTop = box.scrollHeight; box.dataset.ready = '1'; }
  const human = c.human, until = c.humanUntil;
  $('holdtxt').textContent = human ? human + ' ตอบอยู่ · AI หยุดถึง ' + new Date(until).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : 'AI ตอบได้ในแชทนี้ (เฉพาะลูกค้าใหม่)';
  $('holdbtn').textContent = human ? 'ให้ AI ตอบต่อ' : 'ฉันตอบเอง';
  $('holdbtn').className = human ? '' : 'warn';
  $('holdbtn').dataset.on = human ? '0' : '1';
}
async function loadThread() {
  if (!current) return;
  const d = await api('/inbox/api/messages?u=' + current);
  const sig = d.messages.length + ':' + (d.messages.at(-1) || {}).id + ':' + (d.contact || {}).humanUntil;
  if (sig !== lastSig) { lastSig = sig; renderThread(d); }
}
function openThread(u) {
  current = u; lastSig = ''; $('msgs').dataset.ready = '';
  $('home').style.display = 'none'; $('thread').style.display = 'flex';
  history.pushState({ u }, '', '#' + u);
  loadThread();
}
function closeThread() {
  current = null; $('thread').style.display = 'none'; $('home').style.display = 'block'; loadList();
}
$('list').addEventListener('click', (e) => { const r = e.target.closest('.row'); if (r) openThread(r.dataset.u); });
$('tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return;
  filter = b.dataset.f; [...$('tabs').children].forEach((x) => x.classList.toggle('on', x === b)); loadList(); });
let qt; $('q').addEventListener('input', () => { clearTimeout(qt); qt = setTimeout(loadList, 300); });
$('back').onclick = () => history.back();
window.onpopstate = () => { if (current) closeThread(); };
$('text').addEventListener('input', (e) => { e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 140) + 'px'; });
$('send').onclick = async () => {
  const text = $('text').value.trim(); if (!text || !current) return;
  $('send').disabled = true;
  try {
    const d = await api('/inbox/api/send', { method: 'POST', body: JSON.stringify({ u: current, text }) });
    if (!d.ok) { alert('ส่งไม่สำเร็จ: ' + (d.error || '')); return; }
    $('text').value = ''; $('text').style.height = 'auto'; lastSig = ''; await loadThread();
  } finally { $('send').disabled = false; }
};
$('holdbtn').onclick = async () => {
  await api('/inbox/api/hold', { method: 'POST', body: JSON.stringify({ u: current, on: $('holdbtn').dataset.on === '1' }) });
  lastSig = ''; loadThread();
};
function tick() { (current ? loadThread() : loadList()).catch(() => {}); }
if (!token) { document.body.innerHTML = '<div class="empty">พิมพ์ <b>inbox</b> ในแชท LINE กับมามา แมนชั่น เพื่อรับลิงก์เข้าใช้</div>'; }
else {
  api('/inbox/api/me').then((d) => { $('me').textContent = d.name || ''; });
  if (location.hash.length > 2) openThread(location.hash.slice(1)); else loadList();
  timer = setInterval(tick, 5000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
}
</script>
</body>
</html>`;

// @ts-nocheck
// Single-page staff inbox served at /inbox. Staff get a personal link from
// the bot (type "inbox" in a 1:1 chat with the OA); the token in it is kept in
// localStorage and sent as a bearer token. Layout follows the mockup staff
// reviewed: three tabs, three status colours, AI suggestion above the composer.
export const INBOX_PAGE_HTML = `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#06b54c">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Mama Inbox">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<link rel="manifest" href="/inbox/manifest.webmanifest">
<link rel="apple-touch-icon" href="/inbox/icon-180.png">
<link rel="icon" href="/inbox/icon-180.png">
<title>Mama Inbox</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Anuphan:wght@500;600;700&family=IBM+Plex+Sans+Thai:wght@400;500;600&display=swap">
<style>
:root{
  --ground:#e9efea;--surface:#fff;--raised:#f4f7f4;--ink:#16201a;--mute:#66736b;--line:#dfe6e0;
  --green:#06b54c;--green-ink:#fff;--mine:#c9f5d4;--bot:#eef2ef;--ai:#e4ecff;--ai-ink:#2d4fb8;
  --wait:#e5484d;--wait-soft:#fde8e8;--human:#2f6fe4;--human-soft:#e3ecff;--ai-dot:#06b54c;--idle:#b7c1ba;
  --display:"Anuphan","Noto Sans Thai",system-ui,sans-serif;--body:"IBM Plex Sans Thai","Noto Sans Thai",system-ui,sans-serif;--r:16px}
@media (prefers-color-scheme:dark){:root{
  --ground:#0c110e;--surface:#151b17;--raised:#1c241f;--ink:#e8efe9;--mute:#93a198;--line:#26302a;
  --mine:#17482a;--bot:#212a24;--ai:#1b2747;--ai-ink:#9db4ff;--wait-soft:#3a1a1c;--human-soft:#16264a;--idle:#4a554e;color-scheme:dark}}
*{box-sizing:border-box}html,body{height:100%;margin:0}[hidden]{display:none!important}
body{background:var(--ground);color:var(--ink);font:15px/1.5 var(--body)}
button{font:inherit;color:inherit;border:0;background:none;cursor:pointer;padding:0}
button:focus-visible,input:focus-visible,textarea:focus-visible{outline:2px solid var(--green);outline-offset:2px}
.phone{position:relative;height:100%;max-width:560px;margin:0 auto;background:var(--surface);overflow:hidden}
.screen{position:absolute;inset:0;display:flex;flex-direction:column;background:var(--surface);transition:transform .25s ease;padding-top:env(safe-area-inset-top,0px)}
.screen.thread{transform:translateX(100%)}
.phone.open .screen.thread{transform:none}.phone.open .screen.home{transform:translateX(-25%)}
@media (prefers-reduced-motion:reduce){.screen{transition:none}}
.hd{padding:14px 16px 10px;display:flex;align-items:center;gap:12px}
.hd h1{font:700 22px/1.2 var(--display);margin:0;flex:1}
.me{min-width:36px;height:36px;padding:0 8px;border-radius:999px;display:grid;place-items:center;background:var(--green);color:var(--green-ink);font:600 14px var(--display)}
.today{margin:0 16px 10px;padding:12px 14px;border-radius:var(--r);background:var(--raised);display:flex;gap:14px;align-items:center}
.today b{font:700 22px var(--display);font-variant-numeric:tabular-nums}.today small{display:block;color:var(--mute);font-size:12px}
.today .sep{width:1px;align-self:stretch;background:var(--line)}.today .msg{flex:1;font-size:13px;color:var(--mute);text-align:right}
.tabs{display:flex;gap:8px;padding:0 16px 10px}
.tab{padding:7px 14px;border-radius:999px;background:var(--raised);font-weight:500;font-size:14px;display:flex;gap:6px;align-items:center}
.tab.on{background:var(--ink);color:var(--surface)}
.tab .n{font-size:12px;min-width:20px;padding:0 6px;border-radius:999px;background:var(--wait);color:#fff;text-align:center}
.search{margin:0 16px 8px}.search input{width:100%;border:1px solid var(--line);background:var(--raised);border-radius:12px;padding:10px 12px;font:inherit;color:var(--ink)}
.list{flex:1;overflow-y:auto;padding-bottom:calc(16px + env(safe-area-inset-bottom,0px))}
.row{display:flex;gap:12px;padding:12px 16px;align-items:center;width:100%;text-align:left}
.row:active{background:var(--raised)}
.av{position:relative;width:48px;height:48px;border-radius:50%;flex:none;display:grid;place-items:center;font:600 17px var(--display);color:#fff;background-size:cover;background-position:center}
.av i{position:absolute;right:-1px;bottom:-1px;width:14px;height:14px;border-radius:50%;border:2.5px solid var(--surface)}
.mid{flex:1;min-width:0}.top{display:flex;gap:8px;align-items:baseline}
.nm{font-weight:600;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tm{font-size:12px;color:var(--mute);flex:none;font-variant-numeric:tabular-nums}
.pv{font-size:13.5px;color:var(--mute);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.pv b{color:var(--ink);font-weight:500}
.chip{display:inline-block;font-size:11.5px;padding:1px 8px;border-radius:999px;font-weight:500;margin-left:6px;white-space:nowrap}
.c-room{background:var(--raised);color:var(--mute)}.c-wait{background:var(--wait-soft);color:var(--wait)}
.c-human{background:var(--human-soft);color:var(--human)}.c-ai{background:var(--ai);color:var(--ai-ink)}
.legend{display:flex;gap:14px;justify-content:center;font-size:12px;color:var(--mute);padding:8px 16px calc(10px + env(safe-area-inset-bottom,0px))}
.legend span{display:flex;gap:6px;align-items:center}.legend i{width:9px;height:9px;border-radius:50%}
.empty{padding:40px 16px;text-align:center;color:var(--mute)}
.th{display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid var(--line)}
.back{width:36px;height:36px;border-radius:50%;font-size:26px;line-height:1;display:grid;place-items:center}
.th .av{width:40px;height:40px;font-size:15px}.th h2{font:600 17px/1.2 var(--display);margin:0}.th p{margin:0;font-size:12px;color:var(--mute)}
.facts{display:flex;gap:6px;flex-wrap:wrap;padding:10px 16px;border-bottom:1px solid var(--line);background:var(--raised)}
.fact{font-size:12.5px;padding:3px 10px;border-radius:999px;background:var(--surface);border:1px solid var(--line)}
.fact.miss{color:var(--mute);border-style:dashed}
.msgs{flex:1;overflow-y:auto;padding:14px 12px;display:flex;flex-direction:column;gap:6px;background:var(--ground)}
.day{align-self:center;font-size:12px;color:var(--mute);background:var(--surface);padding:2px 10px;border-radius:999px;margin:4px 0}
.b{max-width:80%;padding:8px 12px;border-radius:18px;white-space:pre-wrap;word-break:break-word;font-size:14.5px}
.b .w{display:block;font-size:11px;color:var(--mute);margin-bottom:1px}
.in{align-self:flex-start;background:var(--surface);border-top-left-radius:6px}
.out{align-self:flex-end;background:var(--bot);border-top-right-radius:6px}.out.ai{background:var(--ai)}.out.mine{background:var(--mine)}
.b img{max-width:100%;border-radius:10px;display:block}
.stk{max-width:120px;padding:2px}.stk img{width:110px;height:auto;display:block}
.stk.in{background:none;border:0}.stk.out{background:none}
.hold{display:flex;align-items:center;gap:10px;padding:8px 12px 8px 16px;font-size:13px;border-top:1px solid var(--line)}
.hold .st{flex:1;display:flex;align-items:center;gap:8px;min-width:0}.hold .st i{width:9px;height:9px;border-radius:50%;flex:none}
.hold button{padding:6px 12px;border-radius:999px;font-weight:600;font-size:13px;flex:none}
.suggest{margin:8px 12px 0;padding:10px 12px;border-radius:14px;background:var(--ai);border:1px solid color-mix(in srgb,var(--ai-ink) 25%,transparent)}
.suggest .lbl{font-size:12px;color:var(--ai-ink);font-weight:600;display:flex;justify-content:space-between;gap:8px}
.suggest p{margin:4px 0 8px;font-size:14.5px;white-space:pre-wrap}
.acts{display:flex;gap:8px}.btn{padding:8px 16px;border-radius:999px;font-weight:600;font-size:14px;background:var(--surface)}
.btn.go{background:var(--green);color:var(--green-ink)}
.quick{display:flex;gap:8px;overflow-x:auto;padding:10px 12px 4px;scrollbar-width:none}
.quick button{white-space:nowrap;padding:6px 12px;border-radius:999px;border:1px solid var(--line);font-size:13px;background:var(--surface)}
.quick button.arm{background:var(--green);color:var(--green-ink);border-color:var(--green)}
.compose{display:flex;gap:8px;align-items:flex-end;padding:8px 12px calc(10px + env(safe-area-inset-bottom,0px))}
.compose textarea{flex:1;resize:none;border:1px solid var(--line);border-radius:20px;padding:9px 14px;font:inherit;background:var(--raised);color:var(--ink);max-height:120px}
.send{width:42px;height:42px;border-radius:50%;background:var(--green);color:var(--green-ink);font-size:18px;display:grid;place-items:center;flex:none}
.send:disabled{opacity:.5}
.endbtn{padding:6px 12px;border-radius:999px;font-weight:600;font-size:13px;background:var(--raised);flex:none}
.closed{display:flex;gap:10px;align-items:center;padding:8px 16px;font-size:13px;background:var(--raised);border-bottom:1px solid var(--line);color:var(--mute)}
.closed span{flex:1}.closed button{padding:5px 12px;border-radius:999px;background:var(--surface);font-weight:600;font-size:13px;color:var(--ink)}
.row.dim{opacity:.6}.c-closed{background:var(--raised);color:var(--mute)}
.more{display:block;margin:4px auto 0;padding:8px 14px;border-radius:999px;font-size:13px;color:var(--mute);background:var(--raised)}
.sheet{position:absolute;inset:0;z-index:30;background:rgba(0,0,0,.35);display:flex;align-items:flex-end}
.sheet .pane{width:100%;max-height:85%;overflow-y:auto;background:var(--surface);border-radius:20px 20px 0 0;padding:16px 16px calc(16px + env(safe-area-inset-bottom,0px))}
.pane h3{font:600 17px var(--display);margin:0 0 4px}.pane p.hint{margin:0 0 12px;font-size:13px;color:var(--mute)}
.opt{display:flex;gap:12px;align-items:flex-start;width:100%;text-align:left;padding:12px;border-radius:14px;background:var(--raised);margin-bottom:8px}
.opt b{display:block;font-weight:600}.opt small{color:var(--mute);font-size:12.5px}.opt .ic{font-size:20px;line-height:1.3}
.sc{display:flex;gap:10px;align-items:center;padding:10px 0;border-bottom:1px solid var(--line)}
.sc .t{flex:1;min-width:0}.sc .t small{display:block;color:var(--mute);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sc button{padding:5px 10px;border-radius:999px;background:var(--raised);font-size:13px}
.form{display:grid;gap:8px;margin-top:12px}.form input,.form select,.form textarea{width:100%;font:inherit;border:1px solid var(--line);border-radius:10px;padding:9px 11px;background:var(--raised);color:var(--ink)}
.toast{position:absolute;left:50%;bottom:150px;z-index:20;transform:translate(-50%,20px);opacity:0;transition:.25s;background:var(--ink);color:var(--surface);
  padding:10px 16px;border-radius:999px;font-size:14px;font-weight:500;white-space:nowrap;pointer-events:none}
.toast.show{opacity:1;transform:translate(-50%,0)}
</style>
</head>
<body>
<div class="phone" id="phone">
  <section class="screen home">
    <div class="hd"><h1>แชทลูกค้า</h1><div class="me" id="me"></div></div>
    <div class="today" id="today">
      <div><b id="sChats">–</b><small>แชทที่คนตอบวันนี้</small></div>
      <div class="sep"></div>
      <div><b id="sAvg">–</b><small>ตอบเร็วเฉลี่ย</small></div>
      <div class="msg" id="sAi"></div>
    </div>
    <div class="tabs" id="tabs">
      <button class="tab on" data-f="waiting">รอตอบ <span class="n" id="waitN" hidden></span></button>
      <button class="tab" data-f="lead">ลูกค้าใหม่</button>
      <button class="tab" data-f="tenant">ผู้เช่า</button>
    </div>
    <div class="search"><input id="q" placeholder="ค้นหาชื่อ ห้อง หรือข้อความ" autocomplete="off"></div>
    <div class="list" id="list"></div>
    <div class="legend"><span><i style="background:var(--wait)"></i>รอตอบ</span><span><i style="background:var(--ai-dot)"></i>AI ดูแล</span><span><i style="background:var(--human)"></i>คนดูแล</span></div>
  </section>
  <section class="screen thread">
    <div class="th">
      <button class="back" id="back" aria-label="กลับ">‹</button>
      <div class="av" id="tav"></div>
      <div style="flex:1;min-width:0"><h2 id="tname"></h2><p id="tsub"></p></div>
      <button class="endbtn" id="endbtn">จบแชท</button>
    </div>
    <div class="closed" id="closedbar" hidden><span id="closedtxt"></span><button id="reopen">เปิดแชทอีกครั้ง</button></div>
    <div class="facts" id="facts" hidden></div>
    <div class="msgs" id="msgs"></div>
    <div class="hold"><div class="st" id="hst"></div><button id="hbtn"></button></div>
    <div id="sugg"></div>
    <div class="quick" id="quick"></div>
    <div class="compose">
      <textarea id="text" rows="1" placeholder="พิมพ์ตอบลูกค้า"></textarea>
      <button class="send" id="send" aria-label="ส่ง">➤</button>
    </div>
  </section>
  <div class="sheet" id="endsheet" hidden><div class="pane">
    <h3>จบแชทนี้</h3><p class="hint">แชทจะออกจากรอตอบ ไม่ต้องตอบทุกแชท</p>
    <button class="opt" data-st="closed" data-r="done"><span class="ic">✅</span><span><b>ตอบครบแล้ว</b><small>ลูกค้าพิมพ์มาใหม่ แชทจะกลับมารอตอบ</small></span></button>
    <button class="opt" data-st="closed" data-r="unfit"><span class="ic">🚫</span><span><b>ไม่ผ่านเกณฑ์</b><small>ไม่ตอบต่อ ลูกค้าพิมพ์มาใหม่จะกลับมาให้เห็น</small></span></button>
    <button class="opt" data-st="closed" data-r="skip"><span class="ic">💤</span><span><b>ไม่ต้องตอบ</b><small>เช่น ขอบคุณ/สติกเกอร์ ลูกค้าพิมพ์มาใหม่จะกลับมา</small></span></button>
    <button class="opt" data-st="muted" data-r="mute"><span class="ic">🔕</span><span><b>ซ่อนถาวร</b><small>ไม่ขึ้นอีกแม้ลูกค้าพิมพ์มา และ AI จะไม่ตอบคนนี้</small></span></button>
    <button class="opt" id="endcancel" style="justify-content:center"><b>ยกเลิก</b></button>
  </div></div>
  <div class="sheet" id="scsheet" hidden><div class="pane">
    <h3>ปุ่มด่วน</h3><p class="hint">ทุกคนในทีมเห็นชุดเดียวกัน ข้อความจะขึ้นในช่องพิมพ์ให้แก้ก่อนส่ง ส่วนรูปและการ์ดส่งทันที</p>
    <div id="sclist"></div>
    <div class="form">
      <input id="scLabel" placeholder="ชื่อปุ่ม เช่น 🔗 ลิงก์จอง" maxlength="40">
      <select id="scKind"><option value="text">ข้อความ</option><option value="image">รูป (ลิงก์ .jpg/.png)</option><option value="roomcard">การ์ดรูปห้อง</option></select>
      <textarea id="scBody" rows="5" placeholder="ข้อความ หรือ ลิงก์รูป https://…jpg"></textarea>
      <div class="acts"><button class="btn go" id="scSave">บันทึก</button><button class="btn" id="scNew">ล้างฟอร์ม</button><button class="btn" id="scClose" style="margin-left:auto">ปิด</button></div>
    </div>
  </div></div>
  <div class="toast" id="toast"></div>
</div>
<script>
const qs = new URLSearchParams(location.search);
try { if (qs.get('t')) { localStorage.setItem('inboxToken', qs.get('t')); history.replaceState(null, '', location.pathname); } } catch (_) {}
let token = ''; try { token = localStorage.getItem('inboxToken') || ''; } catch (_) {}
let filter = 'waiting', current = null, lastSig = '', thread = null, myName = '';
const COLORS = ['#2f9e5b','#d9822b','#7a5af5','#d64f7a','#2a8fbd','#8a6d3b'];
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const colorOf = (u) => COLORS[[...u].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];
const initial = (name, u) => (name || u).trim().slice(0, 1).toUpperCase();
const t2 = (ms) => { const d = new Date(ms), n = new Date(); return d.toDateString() === n.toDateString()
  ? d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }); };
const mins = (m) => m < 60 ? m + ' นาที' : Math.floor(m / 60) + ' ชม.';
async function api(path, opt = {}) {
  const res = await fetch(path, { ...opt, headers: { ...(opt.headers || {}), Authorization: 'Bearer ' + token, 'content-type': 'application/json' } });
  if (res.status === 401) { try { localStorage.removeItem('inboxToken'); } catch (_) {} showLogin('การเข้าสู่ระบบหมดอายุ'); throw new Error('auth'); }
  return res.json();
}
function toast(t) { const el = $('toast'); el.textContent = t; el.classList.add('show'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), 2200); }
function state(c) { if (c.status === 'muted') return 'idle'; if (c.waiting) return 'wait'; if (c.human) return 'human'; return c.type === 'NON_TENANT' ? 'ai' : 'idle'; }
const DOT = { wait: 'var(--wait)', ai: 'var(--ai-dot)', human: 'var(--human)', idle: 'var(--idle)' };
function chipFor(c) {
  const s = state(c);
  if (s === 'wait') return '<span class="chip c-wait">รอ ' + mins(c.waitedMin) + '</span>';
  if (s === 'human') return '<span class="chip c-human">' + esc(c.human) + ' ดูแล</span>';
  if (s === 'ai') return '<span class="chip c-ai">AI ดูแล</span>';
  return '';
}
function stickerImg(text) {
  const m = /^\\(sticker\\s+(\\d+)\\/(\\d+)/.exec(text || '');
  return m ? 'https://stickershop.line-scdn.net/stickershop/v1/sticker/' + m[2] + '/android/sticker.png' : '';
}
function preview(c) {
  const who = c.author && c.author !== 'customer' ? (c.author.startsWith('staff:') ? c.author.slice(6) : c.author === 'ai' ? 'AI' : 'บอท') + ': ' : '';
  const body = stickerImg(c.text) ? 'ส่งสติกเกอร์' : c.text;
  return c.waiting ? '<b>' + esc(body) + '</b>' : esc(who + body);
}
async function loadList() {
  const d = await api('/inbox/api/chats?f=' + filter + '&q=' + encodeURIComponent($('q').value));
  $('waitN').textContent = d.waitingCount; $('waitN').hidden = !d.waitingCount;
  $('list').innerHTML = d.chats.length ? d.chats.map((c) => {
    const st = state(c);
    const av = c.pic ? '<div class="av" style="background:url(' + esc(JSON.stringify(c.pic)) + ') center/cover">' : '<div class="av" style="background:' + colorOf(c.u) + '">' + esc(initial(c.name, c.u));
    const closed = c.status && c.status !== 'open';
    return '<button class="row' + (closed ? ' dim' : '') + '" data-u="' + c.u + '">' + av + '<i style="background:' + DOT[st] + '"></i></div>' +
      '<div class="mid"><div class="top"><span class="nm">' + esc(c.name || 'ลูกค้า') + (c.room ? '<span class="chip c-room">' + esc(c.room) + '</span>' : '') + (closed ? '<span class="chip c-closed">' + esc(c.statusReason || 'ปิดแล้ว') + '</span>' : chipFor(c)) +
      '</span><span class="tm">' + t2(c.at) + '</span></div><div class="pv">' + preview(c) + '</div></div></button>';
  }).join('') : '<div class="empty">' + (filter === 'waiting' ? 'ไม่มีแชทรอตอบ เยี่ยมมาก 🎉' : 'ไม่มีแชท') + '</div>';
  $('list').insertAdjacentHTML('beforeend', filter === 'closed'
    ? '<button class="more" id="moreBtn" data-f="waiting">‹ กลับไปแชทที่รอตอบ</button>'
    : '<button class="more" id="moreBtn" data-f="closed">ดูแชทที่จบ/ซ่อนไว้</button>');
}
async function loadMe() {
  const d = await api('/inbox/api/me');
  myName = d.name || ''; $('me').textContent = myName;
  const t = d.today || {};
  $('sChats').textContent = t.staffChats ?? 0;
  $('sAvg').textContent = t.avgMin ? t.avgMin + ' น.' : '–';
  $('sAi').textContent = t.aiChats ? 'AI ช่วยตอบ ' + t.aiChats + ' แชท' : (t.myChats ? 'คุณตอบ ' + t.myChats + ' แชท' : '');
}
const FACTS = [['job', (v) => v, 'อาชีพ ?'], ['move_in', (v) => 'เข้าอยู่ ' + v, 'เข้าอยู่ ?'], ['people', (v) => v + ' คน', 'จำนวนคน ?'],
  ['pets', (v) => v === true || v === 'ใช่' ? 'มีสัตว์เลี้ยง' : 'ไม่มีสัตว์เลี้ยง', 'สัตว์เลี้ยง ?'], ['contract_months', (v) => 'สัญญา ' + v + ' เดือน', ''],
  ['gender', (v) => v === 'female' ? 'ผู้หญิง (เดาจากคำพิมพ์)' : 'ผู้ชาย (เดาจากคำพิมพ์)', 'เพศ ?']];
function renderThread(d) {
  thread = d;
  const c = d.contact || { u: current, type: 'NON_TENANT' };
  const tav = $('tav'); tav.textContent = ''; tav.style.background = colorOf(current); tav.textContent = initial(c.name, current);
  $('tname').textContent = (c.name || 'ลูกค้า') + (c.room ? ' · ' + c.room : '');
  $('tsub').textContent = c.type === 'TENANT' ? 'ผู้เช่า' + (c.tenant ? ' · ' + c.tenant : '') : 'ลูกค้าใหม่';
  const f = c.facts || {};
  const chips = c.type === 'TENANT' ? [] : FACTS.map(([k, fmt, miss]) => f[k] !== undefined && f[k] !== null && f[k] !== ''
    ? '<span class="fact">' + esc(fmt(f[k])) + '</span>' : (miss ? '<span class="fact miss">' + miss + '</span>' : '')).filter(Boolean);
  $('facts').innerHTML = chips.join(''); $('facts').hidden = !chips.length;
  let html = '', day = '';
  for (const m of d.messages) {
    const dd = new Date(m.at).toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short' });
    if (dd !== day) { html += '<div class="day">' + dd + '</div>'; day = dd; }
    const me = m.author.startsWith('staff:'), side = m.dir === 'IN' ? 'in' : 'out ' + (me ? 'mine' : m.author === 'ai' ? 'ai' : '');
    const label = m.dir === 'IN' ? '' : (me ? m.author.slice(6) : m.author === 'ai' ? 'AI' : 'บอท');
    const stk = stickerImg(m.text);
    if (stk) { html += '<div class="b stk ' + side + '"><img src="' + stk + '" alt="สติกเกอร์" loading="lazy"></div>'; continue; }
    const body = m.media ? '<img src="' + esc(m.media) + '" loading="lazy" alt="รูป">' : esc(m.text);
    html += '<div class="b ' + side + '"><span class="w">' + (label ? esc(label) + ' · ' : '') + t2(m.at) + '</span>' + body + '</div>';
  }
  const box = $('msgs'), fromBottom = box.scrollHeight - box.scrollTop - box.clientHeight;
  const stick = stickToBottom || !box.dataset.ready || fromBottom < 80;
  stickToBottom = false;
  box.innerHTML = html || '<div class="empty">ยังไม่มีข้อความ</div>';
  box.dataset.ready = '1';
  holdPosition(box, stick, fromBottom);
  const closed = c.status && c.status !== 'open';
  $('closedbar').hidden = !closed;
  if (closed) $('closedtxt').textContent = (c.status === 'muted' ? '🔕 ซ่อนถาวร' : '✓ จบแชทแล้ว · ' + (c.statusReason || '')) + (c.statusBy ? ' โดย ' + c.statusBy : '');
  $('endbtn').hidden = !!closed;
  const st = state(c), waited = c.waiting ? Math.round((Date.now() - c.lastCustomerAt) / 60000) : 0;
  $('hst').innerHTML = '<i style="background:' + DOT[st] + '"></i><span>' + (st === 'human' ? esc(c.human) + ' ดูแลแชทนี้ · AI หยุดถึง ' +
    new Date(c.humanUntil).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : st === 'wait' ? 'ลูกค้ารอ ' + mins(waited) : st === 'ai' ? 'AI ดูแลแชทนี้อยู่' : 'บอทตอบอัตโนมัติ') + '</span>';
  $('hbtn').textContent = c.human ? 'ให้ AI ตอบต่อ' : 'ฉันตอบเอง';
  $('hbtn').style.background = c.human ? 'var(--raised)' : 'var(--human-soft)'; $('hbtn').style.color = c.human ? 'var(--ink)' : 'var(--human)';
  $('hbtn').dataset.on = c.human ? '0' : '1';
  $('sugg').innerHTML = d.draft ? '<div class="suggest"><div class="lbl"><span>✨ AI แนะนำคำตอบ</span><span>ยังไม่ได้ส่ง</span></div><p>' + esc(d.draft.text) + '</p>' +
    '<div class="acts"><button class="btn go" id="useDraft">ส่งเลย</button><button class="btn" id="editDraft">แก้ก่อนส่ง</button></div></div>' : '';
  if (d.draft) {
    $('useDraft').onclick = () => send(d.draft.text, d.draft.id);
    $('editDraft').onclick = () => { $('text').value = d.draft.text; $('text').dataset.draft = d.draft.id; grow(); $('text').focus(); };
  }
}
// Re-rendering rebuilds every image and sticker; each one grows when it loads
// and pushes the conversation down, which looked like the chat jumping up.
// Keep the same distance from the bottom (the latest message, when the user
// was there) until the images have settled.
let stickToBottom = false, settleObserver = null;
function holdPosition(box, stick, fromBottom) {
  const apply = () => { box.scrollTop = stick ? box.scrollHeight : Math.max(0, box.scrollHeight - box.clientHeight - fromBottom); };
  apply();
  box.querySelectorAll('img').forEach((img) => { if (!img.complete) img.addEventListener('load', apply, { once: true }); });
  if (settleObserver) settleObserver.disconnect();
  if (window.ResizeObserver) {
    settleObserver = new ResizeObserver(apply);
    [...box.children].forEach((el) => settleObserver.observe(el));
    const stop = () => { if (settleObserver) { settleObserver.disconnect(); settleObserver = null; } };
    setTimeout(stop, 2000);
    // Never fight the user's own scrolling.
    box.addEventListener('wheel', stop, { once: true, passive: true });
    box.addEventListener('touchstart', stop, { once: true, passive: true });
  }
  // The composer and AI card below can change height after this render too.
  requestAnimationFrame(apply);
}
async function loadThread() {
  if (!current) return;
  const d = await api('/inbox/api/messages?u=' + current);
  const sig = d.messages.length + ':' + (d.messages.at(-1) || {}).id + ':' + (d.contact || {}).humanUntil + ':' + (d.draft || {}).id;
  if (sig !== lastSig) { lastSig = sig; renderThread(d); }
}
function openThread(u) {
  current = u; lastSig = ''; $('msgs').dataset.ready = ''; $('msgs').innerHTML = ''; $('sugg').innerHTML = '';
  $('phone').classList.add('open'); history.pushState({ u }, '', '#' + u); loadThread();
}
function closeThread() { current = null; $('phone').classList.remove('open'); loadList(); loadMe(); }
async function send(text, draftId, kind) {
  if (!current || (!kind && !String(text || '').trim())) return;
  const waited = thread && thread.contact && thread.contact.waiting ? Math.max(1, Math.round((Date.now() - thread.contact.lastCustomerAt) / 60000)) : 0;
  $('send').disabled = true;
  try {
    const d = await api('/inbox/api/send', { method: 'POST', body: JSON.stringify({ u: current, text, draftId: draftId || $('text').dataset.draft || undefined, kind }) });
    if (!d.ok) { toast('ส่งไม่สำเร็จ ลองอีกครั้ง'); return; }
    $('text').value = ''; delete $('text').dataset.draft; grow(); lastSig = ''; stickToBottom = true;
    toast('ส่งแล้ว ✓' + (waited ? ' ตอบใน ' + mins(waited) : '') + (draftId ? ' · ใช้คำแนะนำ AI' : ''));
    await loadThread();
  } finally { $('send').disabled = false; }
}
function grow() { const t = $('text'); t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 120) + 'px'; }
$('list').addEventListener('click', (e) => {
  const m = e.target.closest('#moreBtn');
  if (m) { filter = m.dataset.f; [...$('tabs').children].forEach((x) => x.classList.toggle('on', x.dataset.f === filter)); loadList(); return; }
  const r = e.target.closest('.row'); if (r) openThread(r.dataset.u);
});
$('tabs').addEventListener('click', (e) => { const b = e.target.closest('.tab'); if (!b) return;
  filter = b.dataset.f; [...$('tabs').children].forEach((x) => x.classList.toggle('on', x === b)); loadList(); });
let qt; $('q').addEventListener('input', () => { clearTimeout(qt); qt = setTimeout(loadList, 300); });
$('back').onclick = () => history.back();
window.onpopstate = () => { if (current) closeThread(); };
$('text').addEventListener('input', grow);
$('send').onclick = () => send($('text').value);
let shortcuts = [];
function renderQuick() {
  $('quick').innerHTML = shortcuts.map((x) => '<button data-id="' + x.id + '">' + esc(x.label) + '</button>').join('') + '<button data-edit="1">✏️ แก้ปุ่ม</button>';
}
async function loadShortcuts() { const d = await api('/inbox/api/shortcuts'); shortcuts = d.shortcuts || []; renderQuick(); }
$('quick').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.edit) { openScSheet(); return; }
  const x = shortcuts.find((s) => String(s.id) === b.dataset.id); if (!x) return;
  if (x.kind === 'text') { $('text').value = x.body; grow(); $('text').focus(); return; }
  // Two taps for cards and images: they go out at once and cannot be edited.
  if (!b.classList.contains('arm')) { b.classList.add('arm'); b.textContent = 'แตะอีกครั้งเพื่อส่ง';
    setTimeout(() => { b.classList.remove('arm'); b.textContent = x.label; }, 3000); return; }
  b.classList.remove('arm'); b.textContent = x.label; sendShortcut(x);
});
async function sendShortcut(x) {
  const d = await api('/inbox/api/send', { method: 'POST', body: JSON.stringify({ u: current, shortcutId: x.id }) });
  toast(d.ok ? 'ส่ง ' + x.label + ' แล้ว ✓' : 'ส่งไม่สำเร็จ ลองอีกครั้ง'); lastSig = ''; stickToBottom = true; loadThread();
}
let editing = null;
function renderScList() {
  $('sclist').innerHTML = shortcuts.map((x) => '<div class="sc"><div class="t">' + esc(x.label) + '<small>' +
    esc(x.kind === 'roomcard' ? 'การ์ดรูปห้อง + ข้อมูลทุกหัวข้อ' : x.kind === 'image' ? 'รูป: ' + x.body : x.body) + '</small></div>' +
    '<button data-ed="' + x.id + '">แก้</button><button data-del="' + x.id + '">ลบ</button></div>').join('');
}
function fillForm(x) { editing = x ? x.id : null; $('scLabel').value = x ? x.label : ''; $('scKind').value = x ? x.kind : 'text'; $('scBody').value = x ? x.body || '' : ''; }
function openScSheet() { renderScList(); fillForm(null); $('scsheet').hidden = false; }
$('sclist').addEventListener('click', async (e) => {
  const ed = e.target.closest('[data-ed]'), del = e.target.closest('[data-del]');
  if (ed) fillForm(shortcuts.find((s) => String(s.id) === ed.dataset.ed));
  if (del) {
    if (del.dataset.armed !== '1') { del.dataset.armed = '1'; del.textContent = 'ยืนยันลบ'; return; }
    const d = await api('/inbox/api/shortcuts/delete', { method: 'POST', body: JSON.stringify({ id: Number(del.dataset.del) }) });
    shortcuts = d.shortcuts || []; renderScList(); renderQuick(); toast('ลบปุ่มแล้ว');
  }
});
$('scSave').onclick = async () => {
  const d = await api('/inbox/api/shortcuts', { method: 'POST', body: JSON.stringify({ id: editing, label: $('scLabel').value, kind: $('scKind').value, body: $('scBody').value }) });
  if (!d.ok) { toast(d.error === 'image_url' ? 'ลิงก์รูปต้องเป็น https และลงท้าย .jpg หรือ .png' : 'กรอกชื่อปุ่มและข้อความก่อน'); return; }
  shortcuts = d.shortcuts || []; renderScList(); renderQuick(); fillForm(null); toast('บันทึกปุ่มแล้ว');
};
$('scNew').onclick = () => fillForm(null);
$('scClose').onclick = () => { $('scsheet').hidden = true; };
$('endbtn').onclick = () => { $('endsheet').hidden = false; };
$('endcancel').onclick = () => { $('endsheet').hidden = true; };
$('endsheet').addEventListener('click', async (e) => {
  if (e.target === $('endsheet')) { $('endsheet').hidden = true; return; }
  const o = e.target.closest('[data-st]'); if (!o) return;
  await api('/inbox/api/status', { method: 'POST', body: JSON.stringify({ u: current, status: o.dataset.st, reason: o.dataset.r }) });
  $('endsheet').hidden = true; toast(o.dataset.st === 'muted' ? 'ซ่อนแชทนี้แล้ว AI จะไม่ตอบ' : 'จบแชทแล้ว');
  history.back();
});
$('reopen').onclick = async () => {
  await api('/inbox/api/status', { method: 'POST', body: JSON.stringify({ u: current, status: 'open' }) });
  toast('เปิดแชทอีกครั้งแล้ว'); lastSig = ''; loadThread();
};
$('hbtn').onclick = async () => {
  const on = $('hbtn').dataset.on === '1';
  await api('/inbox/api/hold', { method: 'POST', body: JSON.stringify({ u: current, on }) });
  toast(on ? 'AI หยุดตอบแชทนี้ 24 ชม.' : 'ให้ AI ตอบต่อแล้ว'); lastSig = ''; loadThread();
};
function tick() { (current ? loadThread() : loadList()).catch(() => {}); }
// Login. On iPhone a home-screen app does not share storage with Safari, so
// it signs in on its own: "เข้าสู่ระบบด้วย LINE" sends a random state through
// LINE Login and the app polls for the token, wherever LINE finished the login.
function showLogin(note) {
  let pending = ''; try { pending = localStorage.getItem('pendingLogin') || ''; } catch (_) {}
  document.body.innerHTML = '<div class="empty" style="padding-top:80px">' +
    '<img src="/inbox/icon-180.png" width="88" height="88" style="border-radius:20px" alt=""><h2 style="font:700 22px var(--display);color:var(--ink)">Mama Inbox</h2>' +
    (note ? '<p>' + esc(note) + '</p>' : '') +
    '<p id="lgmsg">' + (pending ? 'กำลังรอยืนยันใน LINE…' : 'สำหรับเจ้าหน้าที่มามา แมนชั่น') + '</p>' +
    '<button id="lgbtn" style="margin-top:12px;padding:13px 22px;border-radius:999px;background:#06c755;color:#fff;font-weight:600;font-size:16px">เข้าสู่ระบบด้วย LINE</button>' +
    '<p style="margin-top:24px;font-size:13px">หรือพิมพ์ <b>inbox</b> ในแชท LINE กับมามา แมนชั่น เพื่อรับลิงก์</p></div>';
  const start = () => {
    const s = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
    try { localStorage.setItem('pendingLogin', s); } catch (_) {}
    location.href = '/inbox/auth/start?s=' + s;
  };
  document.getElementById('lgbtn').onclick = start;
  if (pending) { pollLogin(pending); return; }
  // Opening the app signed out goes straight to LINE, once per launch, so a
  // refused or cancelled login shows the button instead of looping.
  let tried = false; try { tried = sessionStorage.getItem('autoLogin') === '1'; sessionStorage.setItem('autoLogin', '1'); } catch (_) { tried = true; }
  if (!tried) { const m = document.getElementById('lgmsg'); if (m) m.textContent = 'กำลังเชื่อมต่อ LINE…'; setTimeout(start, 400); }
}
function pollLogin(s) {
  let tries = 0;
  const t = setInterval(async () => {
    tries++;
    try {
      const d = await (await fetch('/inbox/auth/poll?s=' + s, { cache: 'no-store' })).json();
      if (d.ok && d.token) {
        clearInterval(t);
        try { localStorage.setItem('inboxToken', d.token); localStorage.removeItem('pendingLogin'); } catch (_) {}
        location.replace('/inbox');
      } else if (d.expired || tries > 300) {
        clearInterval(t);
        try { localStorage.removeItem('pendingLogin'); } catch (_) {}
        const m = document.getElementById('lgmsg'); if (m) m.textContent = 'หมดเวลา กดเข้าสู่ระบบอีกครั้ง';
      }
    } catch (_) {}
  }, 2000);
}
if (!token) { showLogin(''); }
else {
  loadMe().catch(() => {});
  loadShortcuts().catch(() => {});
  if (location.hash.length > 2) openThread(location.hash.slice(1)); else loadList();
  setInterval(tick, 5000); setInterval(() => { if (!current) loadMe().catch(() => {}); }, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
}
</script>
</body>
</html>`;

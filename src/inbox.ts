// @ts-nocheck
/* -------------------------------------------------------
 * Staff inbox: every 1:1 LINE conversation in D1 (INBOX_DB), and a web page
 * at /inbox where staff read and answer instead of LINE OA Manager.
 *
 * Messages typed in OA Manager never reach the webhook, so the inbox is the
 * only way a human reply gets recorded with who wrote it. That record is what
 * the AI learns from (drafts table) and how it knows to stay quiet while a
 * person is talking (contacts.human_until).
 *
 * Customers keep talking to the same LINE OA; only staff change where they
 * read and reply. Group chats are not part of the inbox.
 * ----------------------------------------------------- */
import { INBOX_PAGE_HTML } from './inbox-page';
import { INBOX_ICON_180, INBOX_ICON_512 } from './inbox-assets';

const TOKEN_DAYS = 30;
const HUMAN_HOLD_MS = 24 * 3600 * 1000;
const PAGE_SIZE = 60;

const DEFAULT_STAFF = {
  Ue90558b73d62863e2287ac32e69541a3: 'Ma',
  U193cae8dd9197f7d4bd6ada8046fd98b: 'KP',
  U2855d93e108ccebbef7d1b55ec8827e5: "P'Koy",
  U9293d43980e98649e20c8759a2c2d7f0: "P'Yu"
};

// INBOX_STAFF="Uxxx:Name,Uyyy:Name" overrides the default list.
export function inboxStaff(env) {
  const raw = String(env?.INBOX_STAFF || '').trim();
  if (!raw) return { ...DEFAULT_STAFF };
  const out = {};
  for (const part of raw.split(',')) {
    const [id, ...name] = part.split(':');
    if (id && id.trim()) out[id.trim()] = name.join(':').trim() || id.trim().slice(0, 6);
  }
  return out;
}

async function hmac(env, text) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(`inbox:${env?.LINE_CHANNEL_SECRET || ''}`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text));
  return Array.from(new Uint8Array(sig)).slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function issueInboxToken(env, staffId) {
  const exp = Date.now() + TOKEN_DAYS * 24 * 3600 * 1000;
  return `${staffId}.${exp}.${await hmac(env, `${staffId}.${exp}`)}`;
}

async function staffFromRequest(env, request) {
  const auth = request.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  const [id, exp, sig] = token.split('.');
  if (!id || !exp || !sig || Number(exp) < Date.now()) return null;
  if (sig !== await hmac(env, `${id}.${exp}`)) return null;
  const name = inboxStaff(env)[id];
  return name ? { id, name } : null;
}

/* ---------- recording ---------- */

// A customer message that needs nobody to answer: stickers, follow/unfollow,
// button taps (the bot or n8n handles those), and short acknowledgements like
// ขอบคุณค่ะ / ok ครับ / รับทราบ. Only the rest make a chat wait for a reply,
// so a sticker sent after a question does not hide the question. A bare
// สวัสดีค่ะ still waits: it is how many new leads open.
const ACK_RE = /^(?:ขอบคุณ(?:มาก)?(?:ๆ|นะ)?|ขอบใจ|thank(?:s| you)?|ok(?:ay)?|โอเค?|โอเคร|เค|ได้(?:เลย)?|รับทราบ|เรียบร้อย(?:แล้ว)?|ตกลง|ครับผม|ครับ|คับ|ค่ะ|คะ|ค่า|จ้า|จ้ะ|นะ|แล้ว|ไม่เป็นไร|[\s.!~^_]|[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}])+$/iu;
const QUESTION_RE = /[?？]|ไหม|มั้ย|มัย|อะไร|ยังไง|อย่างไร|เท่าไ|กี่|ที่ไหน|เมื่อไ|ทำไม|หรือเปล่า|รึเปล่า|ได้ไหม|ช่วย/;

// A photo the worker handed to a flow (rent slip → PAY_RENT, deposit slip,
// ID card, OCR) is that flow's to answer, and n8n answers by push, which never
// reaches the inbox. Only a photo nothing picked up (the worker tags it
// image:unclaimed) waits for a person. Videos and files have no such flows.
export function needsReply(kind, text, handler = '') {
  if (['sticker', 'follow', 'unfollow', 'postback', 'join', 'leave', 'event'].includes(kind)) return false;
  if (kind === 'image') return !handler || handler === 'image:unclaimed';
  if (kind !== 'text') return true;
  const t = String(text || '').trim();
  if (!t) return false;
  if (QUESTION_RE.test(t)) return true;
  return !(t.length <= 30 && ACK_RE.test(t));
}

// Unanswered for longer than this probably got an answer in LINE OA Manager
// before the inbox existed, so it leaves รอตอบ (still visible in its tab).
export const WAIT_WINDOW_MS = 3 * 24 * 3600 * 1000;

function isWaiting(r, now = Date.now()) {
  return (r.status || 'open') === 'open' && (r.last_ask_at || 0) > (r.last_reply_at || 0) && (r.last_ask_at || 0) > now - WAIT_WINDOW_MS;
}

function kindOf(eventType, messageType) {
  if (eventType === 'message') return messageType || 'message';
  return eventType || 'event';
}

async function touchContact(db, userId, ts, text, author, actionable) {
  const isCustomer = author === 'customer';
  await db.prepare(
    `INSERT INTO contacts (user_id, last_message_at, last_text, last_author, last_customer_at, last_reply_at, last_ask_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
     ON CONFLICT(user_id) DO UPDATE SET
       last_message_at = MAX(contacts.last_message_at, ?2),
       last_text = CASE WHEN ?2 >= contacts.last_message_at THEN ?3 ELSE contacts.last_text END,
       last_author = CASE WHEN ?2 >= contacts.last_message_at THEN ?4 ELSE contacts.last_author END,
       last_customer_at = MAX(contacts.last_customer_at, ?5),
       last_reply_at = MAX(contacts.last_reply_at, ?6),
       last_ask_at = MAX(COALESCE(contacts.last_ask_at, 0), ?7),
       status = CASE WHEN ?7 > 0 AND contacts.status = 'closed' THEN 'open' ELSE contacts.status END`
  ).bind(userId, ts, String(text || '').slice(0, 200), author, isCustomer ? ts : 0, isCustomer ? 0 : ts, isCustomer && actionable ? ts : 0).run();
}

async function insertMessage(db, m) {
  const actionable = m.direction === 'IN' ? (needsReply(m.kind, m.text, m.handler) ? 1 : 0) : 0;
  const res = await db.prepare(
    `INSERT OR IGNORE INTO messages (user_id, ts, direction, author, kind, text, line_message_id, log_id, handler, in_reply_to, actionable)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`
  ).bind(m.userId, m.ts, m.direction, m.author, m.kind || '', String(m.text || '').slice(0, 4000),
    m.lineMessageId || '', m.logId || null, m.handler || '', m.inReplyTo || '', actionable).run();
  if (res?.meta?.changes) await touchContact(db, m.userId, m.ts, m.text, m.author, actionable);
}

// The AI read a customer message and judged that it needs no answer.
async function markNoReply(db, userId, logId) {
  if (!logId) return;
  await db.prepare('UPDATE messages SET actionable = 0 WHERE user_id = ?1 AND log_id = ?2').bind(userId, logId).run();
  await db.prepare(
    `UPDATE contacts SET last_ask_at = COALESCE((SELECT MAX(ts) FROM messages WHERE user_id = ?1 AND direction = 'IN' AND actionable = 1), 0)
     WHERE user_id = ?1`
  ).bind(userId).run();
}

// Called with the same payload the worker sends to MM_LOG.
export async function recordInboxEvent(env, log) {
  const db = env?.INBOX_DB;
  if (!db || !log || log.sourceType !== 'user' || !String(log.userId || '').startsWith('U')) return;
  await insertMessage(db, {
    userId: log.userId,
    ts: Date.parse(log.timestamp) || Date.now(),
    direction: 'IN',
    author: 'customer',
    kind: kindOf(log.eventType, log.messageType),
    text: log.text,
    lineMessageId: log.messageId,
    logId: log.logId,
    handler: log.handler
  });
}

// KV is eventually consistent, so a slip sent seconds after "ชำระค่าเช่า" can
// reach the worker before the payrent_flow key is visible and be bounced as an
// unexpected image. D1 is read-your-writes: if this user typed the command in
// the last `windowMs` and no slip has been forwarded since, the flow is still on.
export async function payRentCommandInWindow(env, userId, windowMs) {
  const db = env?.INBOX_DB;
  if (!db || !String(userId || '').startsWith('U')) return null;
  const cmd = await db.prepare(
    "SELECT ts FROM messages WHERE user_id = ?1 AND direction = 'IN' AND handler = 'pay_rent' AND ts > ?2 ORDER BY ts DESC LIMIT 1"
  ).bind(userId, Date.now() - windowMs).first();
  if (!cmd?.ts) return null;
  const used = await db.prepare(
    "SELECT 1 AS x FROM messages WHERE user_id = ?1 AND direction = 'IN' AND handler = 'image:pay_rent' AND ts > ?2 LIMIT 1"
  ).bind(userId, cmd.ts).first();
  return used ? null : { ts: cmd.ts };
}

export async function recordInboxOutbound(env, payload, author) {
  const db = env?.INBOX_DB;
  if (!db || !payload || payload.sourceType !== 'user' || !String(payload.userId || '').startsWith('U')) return;
  await insertMessage(db, {
    userId: payload.userId,
    ts: Date.parse(payload.timestamp) || Date.now(),
    direction: 'OUT',
    author: author || 'bot',
    kind: String(payload.messageType || 'text').split(',')[0] || 'text',
    text: payload.text,
    logId: payload.logId,
    handler: payload.handler,
    inReplyTo: payload.inReplyTo
  });
}

/* ---------- API ---------- */

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

async function fillProfiles(env, rows) {
  const missing = rows.filter((r) => !r.display_name && Date.now() - (r.profile_checked_at || 0) > 24 * 3600 * 1000).slice(0, 8);
  await Promise.all(missing.map(async (r) => {
    let name = '';
    let pic = '';
    try {
      const res = await fetch(`https://api.line.me/v2/bot/profile/${r.user_id}`, {
        headers: { Authorization: `Bearer ${env.LINE_ACCESS_TOKEN}` }
      });
      if (res.ok) {
        const p = await res.json();
        name = p.displayName || '';
        pic = p.pictureUrl || '';
      }
    } catch (_) {}
    r.display_name = name || r.display_name;
    r.picture_url = pic || r.picture_url;
    await env.INBOX_DB.prepare(
      'UPDATE contacts SET display_name = COALESCE(NULLIF(?2, \'\'), display_name), picture_url = COALESCE(NULLIF(?3, \'\'), picture_url), profile_checked_at = ?4 WHERE user_id = ?1'
    ).bind(r.user_id, name, pic, Date.now()).run();
  }));
}

async function listChats(env, url) {
  const filter = url.searchParams.get('f') || 'lead';
  const q = (url.searchParams.get('q') || '').trim();
  const where = [];
  const binds = [];
  // A search looks through every chat; staff type a room like a102 from the
  // default ลูกค้าใหม่ tab, where tenants are not listed.
  // Closed chats leave รอตอบ; muted ones only show under ปิดแล้ว or a search.
  if (!q && filter === 'lead') where.push("COALESCE(contact_type, 'NON_TENANT') = 'NON_TENANT'", "COALESCE(status, 'open') <> 'muted'");
  if (!q && filter === 'tenant') where.push("contact_type = 'TENANT'", "COALESCE(status, 'open') <> 'muted'");
  if (!q && filter === 'waiting') {
    binds.push(Date.now() - WAIT_WINDOW_MS);
    where.push("COALESCE(status, 'open') = 'open'", 'COALESCE(last_ask_at, 0) > COALESCE(last_reply_at, 0)', `last_ask_at > ?${binds.length}`);
  }
  if (!q && filter === 'closed') where.push("status IN ('closed', 'muted')");
  if (q) {
    binds.push(`%${q}%`);
    where.push(`(display_name LIKE ?${binds.length} OR room_id LIKE ?${binds.length} OR tenant_name LIKE ?${binds.length} OR last_text LIKE ?${binds.length})`);
  }
  const sql = `SELECT * FROM contacts ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY last_message_at DESC LIMIT 100`;
  const rows = (await env.INBOX_DB.prepare(sql).bind(...binds).all()).results || [];
  await fillProfiles(env, rows);
  return rows.map((r) => ({
    u: r.user_id,
    name: r.display_name || '',
    pic: r.picture_url || '',
    room: r.room_id || '',
    tenant: r.tenant_name || '',
    type: r.contact_type || 'NON_TENANT',
    at: r.last_message_at,
    text: r.last_text || '',
    author: r.last_author || '',
    status: r.status || 'open',
    statusReason: r.status_reason || '',
    waiting: isWaiting(r),
    waitedMin: isWaiting(r) ? Math.max(0, Math.round((Date.now() - r.last_ask_at) / 60000)) : 0,
    human: (r.human_until || 0) > Date.now() ? r.human_by || 'staff' : ''
  }));
}

function parseFacts(raw) {
  try { return raw ? JSON.parse(raw) : {}; } catch (_) { return {}; }
}

// The newest AI draft nobody has used yet, offered above the composer. A draft
// older than the last reply in the chat is stale: someone already answered.
async function pendingDraft(env, userId) {
  const d = await env.INBOX_DB.prepare(
    'SELECT * FROM drafts WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 1'
  ).bind(userId).first();
  if (!d || d.sent_at || d.ai_sent || !d.draft) return null;
  const lastOut = await env.INBOX_DB.prepare(
    "SELECT MAX(ts) AS t FROM messages WHERE user_id = ?1 AND direction = 'OUT'"
  ).bind(userId).first();
  if ((lastOut?.t || 0) > d.created_at) return null;
  // The keyword bot may already have answered the message this draft is for.
  if (d.in_log_id) {
    const answered = await env.INBOX_DB.prepare(
      "SELECT 1 FROM messages WHERE user_id = ?1 AND direction = 'OUT' AND in_reply_to = ?2 LIMIT 1"
    ).bind(userId, d.in_log_id).first();
    if (answered) return null;
  }
  return { id: d.id, text: d.draft, verdict: d.verdict || '' };
}

function bangkokDayStart() {
  const now = Date.now() + 7 * 3600 * 1000;
  return now - (now % (24 * 3600 * 1000)) - 7 * 3600 * 1000;
}

async function todayStats(env, staff) {
  const since = bangkokDayStart();
  const row = await env.INBOX_DB.prepare(
    `SELECT
       COUNT(DISTINCT CASE WHEN author LIKE 'staff:%' THEN user_id END) AS staffChats,
       COUNT(DISTINCT CASE WHEN author = ?2 THEN user_id END) AS myChats,
       COUNT(DISTINCT CASE WHEN author = 'ai' THEN user_id END) AS aiChats,
       AVG(CASE WHEN author LIKE 'staff:%' AND gap BETWEEN 0 AND 43200000 THEN gap END) AS avgMs
     FROM (
       SELECT user_id, author, ts - (
         SELECT MAX(i.ts) FROM messages i WHERE i.user_id = o.user_id AND i.direction = 'IN' AND i.actionable = 1 AND i.ts < o.ts
       ) AS gap
       FROM messages o WHERE o.ts >= ?1 AND o.direction = 'OUT'
     )`
  ).bind(since, `staff:${staff.name}`).first();
  return {
    staffChats: row?.staffChats || 0,
    myChats: row?.myChats || 0,
    aiChats: row?.aiChats || 0,
    avgMin: row?.avgMs ? Math.max(1, Math.round(row.avgMs / 60000)) : null
  };
}

async function listMessages(env, url, deps) {
  const userId = url.searchParams.get('u') || '';
  const before = Number(url.searchParams.get('before') || 0) || Date.now() + 60000;
  const rows = ((await env.INBOX_DB.prepare(
    'SELECT * FROM messages WHERE user_id = ?1 AND ts < ?2 ORDER BY ts DESC, id DESC LIMIT ?3'
  ).bind(userId, before, PAGE_SIZE).all()).results || []).reverse();
  const origin = url.origin;
  const out = [];
  for (const r of rows) {
    let media = '';
    if (r.kind === 'image' && r.line_message_id) media = await deps.repairMediaUrl(env, origin, r.line_message_id, 'preview');
    out.push({ id: r.id, at: r.ts, dir: r.direction, author: r.author, kind: r.kind, text: r.text, media });
  }
  const contact = await env.INBOX_DB.prepare('SELECT * FROM contacts WHERE user_id = ?1').bind(userId).first();
  return {
    contact: contact ? {
      u: contact.user_id, name: contact.display_name || '', room: contact.room_id || '', tenant: contact.tenant_name || '',
      type: contact.contact_type || 'NON_TENANT',
      human: (contact.human_until || 0) > Date.now() ? contact.human_by || 'staff' : '',
      humanUntil: contact.human_until || 0,
      waiting: isWaiting(contact),
      status: contact.status || 'open',
      statusReason: contact.status_reason || '',
      statusBy: contact.status_by || '',
      statusAt: contact.status_at || 0,
      lastCustomerAt: contact.last_ask_at || contact.last_customer_at || 0,
      facts: parseFacts(contact.facts)
    } : null,
    // An ended chat offers no draft; a new customer message reopens it.
    draft: (contact?.status || 'open') === 'open' ? await pendingDraft(env, userId) : null,
    messages: out,
    more: rows.length === PAGE_SIZE
  };
}

async function setHuman(env, userId, staff, holdMs) {
  const until = holdMs > 0 ? Date.now() + holdMs : 0;
  await env.INBOX_DB.prepare('UPDATE contacts SET human_until = ?2, human_by = ?3 WHERE user_id = ?1')
    .bind(userId, until, holdMs > 0 ? staff.name : '').run();
  // The live AI (n8n MM_AI_Shadow) still reads its own pause table.
  const pauseUrl = String(env.AI_PAUSE_URL || '').trim();
  if (pauseUrl) {
    const m = holdMs > 30 * 24 * 3600 * 1000 ? 'forever' : holdMs > 0 ? 'pause' : 'resume';
    await fetch(`${pauseUrl}&u=${encodeURIComponent(userId)}&m=${m}`).catch((err) => console.error('inbox_ai_pause_failed', err));
  }
  return until;
}

async function sendReply(env, request, staff, deps) {
  const body = await request.json().catch(() => ({}));
  const userId = String(body.u || '');
  const text = String(body.text || '').trim();
  let kind = body.kind === 'roomcard' ? 'roomcard' : 'text';
  let imageUrl = '';
  if (body.shortcutId) {
    const sc = await env.INBOX_DB.prepare('SELECT * FROM shortcuts WHERE id = ?1').bind(Number(body.shortcutId)).first();
    if (!sc) return json({ ok: false, error: 'shortcut' }, 404);
    kind = sc.kind;
    imageUrl = sc.kind === 'image' ? String(sc.body || '') : '';
  }
  if (!userId.startsWith('U') || (kind === 'text' && !text)) return json({ ok: false, error: 'missing' }, 400);
  if (text.length > 4900) return json({ ok: false, error: 'too_long' }, 400);
  if (kind === 'image' && !/^https:\/\/\S+\.(jpe?g|png)(\?\S*)?$/i.test(imageUrl)) return json({ ok: false, error: 'image_url' }, 400);
  const messages = kind === 'roomcard'
    ? deps.roomDetailMessages()
    : kind === 'image'
      ? [{ type: 'image', originalContentUrl: imageUrl, previewImageUrl: imageUrl }]
      : [{ type: 'text', text }];
  const store = deps.chatLogContext.getStore();
  if (store) {
    store.author = `staff:${staff.name}`;
    store.handler = 'inbox';
  }
  try {
    await deps.linePush(env.LINE_ACCESS_TOKEN, userId, messages);
  } catch (err) {
    return json({ ok: false, error: String(err?.message || err).slice(0, 200) }, 502);
  }
  const until = await setHuman(env, userId, staff, HUMAN_HOLD_MS);
  if (body.draftId) {
    await env.INBOX_DB.prepare(
      'UPDATE drafts SET final_text = ?2, final_author = ?3, sent_at = ?4, edited = CASE WHEN draft = ?2 THEN 0 ELSE 1 END WHERE id = ?1'
    ).bind(Number(body.draftId), text, staff.name, Date.now()).run();
  }
  await logAccess(env, staff, kind === 'text' ? 'send' : `send_${kind}`, userId);
  return json({ ok: true, humanUntil: until });
}

async function logAccess(env, staff, action, userId) {
  await env.INBOX_DB.prepare('INSERT INTO access_log (ts, staff, action, user_id) VALUES (?1, ?2, ?3, ?4)')
    .bind(Date.now(), staff.name, action, userId || '').run().catch(() => {});
}

/* ---------- what the AI reads before drafting ---------- */

// Thai has no spaces, so similarity is the overlap of character pairs after
// dropping polite particles and punctuation.
const FILLER_RE = /ครับผม|ครับ|คับ|ค่ะ|คะ|ค่า|นะคะ|นะครับ|นะ|จ้า|หน่อย|รบกวน|สอบถาม|สวัสดี|[\s\p{P}\p{S}]/gu;
function bigrams(text) {
  const t = String(text || '').toLowerCase().replace(FILLER_RE, '');
  const out = new Set();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}
export function similarity(a, b) {
  const x = bigrams(a), y = bigrams(b);
  if (!x.size || !y.size) return 0;
  let common = 0;
  for (const g of x) if (y.has(g)) common++;
  return common / (x.size + y.size - common);
}

const EXAMPLE_POOL = 400;
const EXAMPLE_COUNT = 5;
const EDITED_BONUS = 0.15;

// Real staff answers to new customers, each paired with the customer message
// it answered. Answers staff wrote over an AI draft come first at equal
// similarity: they say exactly what the AI got wrong.
export async function staffExamples(env, query, excludeUserId) {
  const db = env.INBOX_DB;
  const pairs = ((await db.prepare(
    `SELECT o.user_id, o.text AS answer, o.ts,
       (SELECT i.text FROM messages i WHERE i.user_id = o.user_id AND i.direction = 'IN' AND i.actionable = 1
          AND i.ts < o.ts AND i.ts > o.ts - 86400000 ORDER BY i.ts DESC LIMIT 1) AS question
     FROM messages o JOIN contacts c ON c.user_id = o.user_id
     WHERE o.author LIKE 'staff:%' AND o.kind = 'text' AND COALESCE(c.contact_type, 'NON_TENANT') = 'NON_TENANT'
     ORDER BY o.ts DESC LIMIT ?1`
  ).bind(EXAMPLE_POOL).all()).results || []).map((r) => ({ ...r, edited: false }));
  const edited = ((await db.prepare(
    `SELECT d.user_id, d.final_text AS answer, d.draft, d.sent_at AS ts, m.text AS question
     FROM drafts d LEFT JOIN messages m ON m.user_id = d.user_id AND m.log_id = d.in_log_id
     WHERE d.edited = 1 AND d.final_text IS NOT NULL ORDER BY d.sent_at DESC LIMIT 200`
  ).all()).results || []).map((r) => ({ ...r, edited: true }));
  const seen = new Set();
  return [...edited, ...pairs]
    .filter((p) => p.question && p.answer && p.user_id !== excludeUserId && String(p.answer).trim().length > 3)
    .map((p) => ({ ...p, score: similarity(query, p.question) + (p.edited ? EDITED_BONUS : 0) }))
    .filter((p) => p.score > 0.05)
    .sort((a, b) => b.score - a.score || b.ts - a.ts)
    .filter((p) => { const k = String(p.answer).trim(); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, EXAMPLE_COUNT)
    .map((p) => ({ question: p.question, answer: p.answer, aiDraft: p.edited ? p.draft || '' : '', edited: p.edited, score: Math.round(p.score * 100) / 100 }));
}

// The conversation as the inbox has it: unlike n8n's own history, this
// includes what staff typed, so the AI does not repeat or contradict them.
async function threadForAi(env, userId) {
  const rows = ((await env.INBOX_DB.prepare(
    'SELECT ts, direction, author, kind, text FROM messages WHERE user_id = ?1 ORDER BY ts DESC, id DESC LIMIT 30'
  ).bind(userId).all()).results || []).reverse();
  return rows.map((r) => ({
    who: r.direction === 'IN' ? 'customer' : r.author.startsWith('staff:') ? 'staff' : r.author,
    text: r.kind === 'text' ? r.text : `(${r.kind})`
  }));
}

async function aiContext(env, request, url) {
  const secret = String(env.INBOX_INGEST_SECRET || '');
  if (!secret || request.headers.get('x-inbox-secret') !== secret) return json({ ok: false }, 401);
  const userId = url.searchParams.get('u') || '';
  const query = url.searchParams.get('q') || '';
  return json({
    ok: true,
    thread: userId.startsWith('U') ? await threadForAi(env, userId) : [],
    examples: query ? await staffExamples(env, query, userId) : []
  });
}

// n8n posts here: contact facts from MM_LOG (room, tenant) and the live AI's
// replies, which it sends to LINE itself.
async function ingest(env, request) {
  const secret = String(env.INBOX_INGEST_SECRET || '');
  if (!secret || request.headers.get('x-inbox-secret') !== secret) return json({ ok: false }, 401);
  const body = await request.json().catch(() => ({}));
  const userId = String(body.userId || '');
  if (!userId.startsWith('U')) return json({ ok: false, error: 'userId' }, 400);
  if (body.contactType) {
    await env.INBOX_DB.prepare(
      `INSERT INTO contacts (user_id, room_id, tenant_name, contact_type) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(user_id) DO UPDATE SET room_id = ?2, tenant_name = ?3, contact_type = ?4`
    ).bind(userId, String(body.roomId || ''), String(body.tenantName || ''), String(body.contactType)).run();
  }
  if (body.facts && typeof body.facts === 'object') {
    const row = await env.INBOX_DB.prepare('SELECT facts FROM contacts WHERE user_id = ?1').bind(userId).first();
    const merged = { ...parseFacts(row?.facts) };
    for (const [k, v] of Object.entries(body.facts)) if (v !== null && v !== undefined && v !== '') merged[k] = v;
    await env.INBOX_DB.prepare(
      'INSERT INTO contacts (user_id, facts) VALUES (?1, ?2) ON CONFLICT(user_id) DO UPDATE SET facts = ?2'
    ).bind(userId, JSON.stringify(merged)).run();
  }
  if (body.verdict === 'NO_REPLY' && body.inLogId) await markNoReply(env.INBOX_DB, userId, String(body.inLogId));
  if (body.draft) {
    await env.INBOX_DB.prepare(
      'INSERT INTO drafts (user_id, in_log_id, created_at, draft, verdict, meta, ai_sent) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)'
    ).bind(userId, String(body.inLogId || ''), Date.now(), String(body.draft).slice(0, 4000), String(body.verdict || ''),
      JSON.stringify(body.facts || {}), body.aiSent ? 1 : 0).run();
  }
  if (body.text && body.direction === 'OUT') {
    await insertMessage(env.INBOX_DB, {
      userId,
      ts: Date.parse(body.timestamp) || Date.now(),
      direction: 'OUT',
      author: String(body.author || 'ai'),
      kind: 'text',
      text: body.text,
      logId: body.logId || null,
      handler: body.handler || 'ai_reply',
      inReplyTo: body.inReplyTo || ''
    });
  }
  return json({ ok: true });
}

const STATUS_REASONS = { done: 'ตอบครบแล้ว', unfit: 'ไม่ผ่านเกณฑ์', skip: 'ไม่ต้องตอบ', mute: 'ซ่อนถาวร' };
const MUTE_HOLD_MS = 3650 * 24 * 3600 * 1000;

async function setStatus(env, request, staff) {
  const body = await request.json().catch(() => ({}));
  const userId = String(body.u || '');
  const status = ['open', 'closed', 'muted'].includes(body.status) ? body.status : '';
  if (!userId.startsWith('U') || !status) return json({ ok: false }, 400);
  const reason = status === 'open' ? '' : STATUS_REASONS[body.reason] || (status === 'muted' ? STATUS_REASONS.mute : STATUS_REASONS.done);
  const prev = await env.INBOX_DB.prepare('SELECT status FROM contacts WHERE user_id = ?1').bind(userId).first();
  await env.INBOX_DB.prepare('UPDATE contacts SET status = ?2, status_reason = ?3, status_by = ?4, status_at = ?5 WHERE user_id = ?1')
    .bind(userId, status, reason, staff.name, Date.now()).run();
  // A muted chat keeps the AI quiet for good; un-muting hands it back.
  if (status === 'muted') await setHuman(env, userId, staff, MUTE_HOLD_MS);
  else if (prev?.status === 'muted') await setHuman(env, userId, staff, 0);
  await logAccess(env, staff, `status_${status}`, userId);
  return json({ ok: true });
}

async function listShortcuts(env) {
  return ((await env.INBOX_DB.prepare('SELECT id, label, kind, body, sort FROM shortcuts ORDER BY sort, id').all()).results || []);
}

async function saveShortcut(env, request, staff) {
  const body = await request.json().catch(() => ({}));
  const label = String(body.label || '').trim().slice(0, 40);
  const kind = ['text', 'roomcard', 'image'].includes(body.kind) ? body.kind : 'text';
  const text = String(body.body || '').trim().slice(0, 4900);
  if (!label || (kind !== 'roomcard' && !text)) return json({ ok: false, error: 'missing' }, 400);
  if (kind === 'image' && !/^https:\/\/\S+\.(jpe?g|png)(\?\S*)?$/i.test(text)) return json({ ok: false, error: 'image_url' }, 400);
  if (body.id) {
    await env.INBOX_DB.prepare('UPDATE shortcuts SET label = ?2, kind = ?3, body = ?4, updated_by = ?5, updated_at = ?6 WHERE id = ?1')
      .bind(Number(body.id), label, kind, text, staff.name, Date.now()).run();
  } else {
    await env.INBOX_DB.prepare(
      'INSERT INTO shortcuts (label, kind, body, sort, updated_by, updated_at) VALUES (?1, ?2, ?3, (SELECT COALESCE(MAX(sort), 0) + 10 FROM shortcuts), ?4, ?5)'
    ).bind(label, kind, text, staff.name, Date.now()).run();
  }
  await logAccess(env, staff, 'shortcut_save', '');
  return json({ ok: true, shortcuts: await listShortcuts(env) });
}

/* ---------- home-screen app + เข้าสู่ระบบด้วย LINE ---------- */

const MANIFEST = JSON.stringify({
  name: 'Mama Inbox',
  short_name: 'Mama Inbox',
  start_url: '/inbox',
  scope: '/inbox',
  display: 'standalone',
  background_color: '#0c110e',
  theme_color: '#06b54c',
  icons: [
    { src: '/inbox/icon-180.png', sizes: '180x180', type: 'image/png' },
    { src: '/inbox/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
  ]
});

function pngResponse(b64) {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new Response(bytes, { headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=604800' } });
}

const LOGIN_STATE_TTL_MS = 10 * 60 * 1000;
const STATE_RE = /^[a-f0-9]{32}$/;

function htmlPage(title, body, script = '') {
  return new Response(`<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>body{font-family:-apple-system,"Noto Sans Thai",sans-serif;margin:0;padding:40px 24px;text-align:center;background:#0c110e;color:#e8efe9}
a{display:inline-block;margin-top:16px;padding:12px 20px;border-radius:999px;background:#06b54c;color:#fff;text-decoration:none;font-weight:600}</style></head>
<body>${body}${script ? `<script>${script}</script>` : ''}</body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

function lineLoginConfigured(env) {
  return !!(String(env.LINE_LOGIN_CHANNEL_ID || '').trim() && String(env.LINE_LOGIN_CHANNEL_SECRET || '').trim());
}

async function loginStart(env, url) {
  const state = url.searchParams.get('s') || '';
  if (!STATE_RE.test(state)) return htmlPage('Mama Inbox', '<p>ลิงก์เข้าสู่ระบบไม่ถูกต้อง เปิดแอปแล้วกดเข้าสู่ระบบอีกครั้ง</p>');
  if (!lineLoginConfigured(env)) return htmlPage('Mama Inbox', '<p>ยังไม่ได้ตั้งค่า LINE Login</p>');
  await env.INBOX_DB.prepare('INSERT OR IGNORE INTO auth_states (state, created_at) VALUES (?1, ?2)').bind(state, Date.now()).run();
  const auth = new URL('https://access.line.me/oauth2/v2.1/authorize');
  auth.searchParams.set('response_type', 'code');
  auth.searchParams.set('client_id', String(env.LINE_LOGIN_CHANNEL_ID).trim());
  auth.searchParams.set('redirect_uri', `${url.origin}/inbox/auth/callback`);
  auth.searchParams.set('state', state);
  auth.searchParams.set('scope', 'profile openid');
  return Response.redirect(auth.toString(), 302);
}

// LINE returns here with a code. The LINE user id in the verified ID token
// has to be on the staff list, the same check as the "inbox" command.
async function loginCallback(env, url) {
  const state = url.searchParams.get('state') || '';
  const code = url.searchParams.get('code') || '';
  const row = STATE_RE.test(state)
    ? await env.INBOX_DB.prepare('SELECT * FROM auth_states WHERE state = ?1').bind(state).first()
    : null;
  if (!row || row.token || Date.now() - row.created_at > LOGIN_STATE_TTL_MS || !code) {
    return htmlPage('Mama Inbox', '<p>การเข้าสู่ระบบหมดเวลาหรือถูกใช้แล้ว เปิดแอปแล้วกดเข้าสู่ระบบอีกครั้ง</p><a href="/inbox">เปิด Mama Inbox</a>');
  }
  const clientId = String(env.LINE_LOGIN_CHANNEL_ID).trim();
  const tokenRes = await fetch('https://api.line.me/oauth2/v2.1/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code', code, redirect_uri: `${url.origin}/inbox/auth/callback`,
      client_id: clientId, client_secret: String(env.LINE_LOGIN_CHANNEL_SECRET).trim()
    })
  });
  const tok = tokenRes.ok ? await tokenRes.json() : null;
  const verifyRes = tok?.id_token ? await fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ id_token: tok.id_token, client_id: clientId })
  }) : null;
  const claims = verifyRes?.ok ? await verifyRes.json() : null;
  const lineUserId = String(claims?.sub || '');
  const name = inboxStaff(env)[lineUserId];
  if (!name) {
    console.warn('inbox_login_refused', { lineUserId, tokenOk: !!tok, verifyOk: !!claims });
    return htmlPage('Mama Inbox', `<p>บัญชี LINE นี้ไม่มีสิทธิ์เข้า Mama Inbox</p><p style="opacity:.6;font-size:13px">${lineUserId ? 'ID: ' + lineUserId : 'ยืนยันกับ LINE ไม่สำเร็จ'}</p>`);
  }
  const token = await issueInboxToken(env, lineUserId);
  await env.INBOX_DB.prepare('UPDATE auth_states SET token = ?2, staff = ?3 WHERE state = ?1').bind(state, token, name).run();
  await logAccess(env, { name }, 'login_line', '');
  // Finished in the app itself: keep the token and go straight in. Finished in
  // Safari or LINE: the home-screen app picks the token up by polling.
  return htmlPage('Mama Inbox', `<p>✅ เข้าสู่ระบบแล้ว (${name})</p><p>กลับไปที่แอป Mama Inbox ได้เลย</p><a href="/inbox">เปิด Mama Inbox</a>`,
    `try{localStorage.setItem('inboxToken',${JSON.stringify(token)});localStorage.removeItem('pendingLogin')}catch(e){}`);
}

async function loginPoll(env, url) {
  const state = url.searchParams.get('s') || '';
  if (!STATE_RE.test(state)) return json({ ok: false }, 400);
  const row = await env.INBOX_DB.prepare('SELECT * FROM auth_states WHERE state = ?1').bind(state).first();
  if (!row || Date.now() - row.created_at > LOGIN_STATE_TTL_MS || row.used) return json({ ok: false, expired: true });
  if (!row.token) return json({ ok: false, pending: true });
  await env.INBOX_DB.prepare('UPDATE auth_states SET used = 1 WHERE state = ?1').bind(state).run();
  return json({ ok: true, token: row.token, name: row.staff });
}

export async function handleInboxRequest(request, env, url, deps) {
  const path = url.pathname;
  if (request.method === 'GET' && path === '/inbox/manifest.webmanifest') {
    return new Response(MANIFEST, { headers: { 'content-type': 'application/manifest+json', 'cache-control': 'public, max-age=3600' } });
  }
  if (request.method === 'GET' && path === '/inbox/icon-180.png') return pngResponse(INBOX_ICON_180);
  if (request.method === 'GET' && path === '/inbox/icon-512.png') return pngResponse(INBOX_ICON_512);
  if (request.method === 'GET' && path === '/inbox/auth/start') return loginStart(env, url);
  if (request.method === 'GET' && path === '/inbox/auth/callback') return loginCallback(env, url);
  if (request.method === 'GET' && path === '/inbox/auth/poll') return loginPoll(env, url);
  if (request.method === 'GET' && path === '/inbox/api/login-config') return json({ ok: true, lineLogin: lineLoginConfigured(env) });
  if (request.method === 'GET' && (path === '/inbox' || path === '/inbox/')) {
    return new Response(INBOX_PAGE_HTML, {
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }
    });
  }
  if (!env.INBOX_DB) return json({ ok: false, error: 'no_db' }, 500);
  if (request.method === 'POST' && path === '/inbox/api/ingest') return ingest(env, request);
  if (request.method === 'GET' && path === '/inbox/api/ai-context') return aiContext(env, request, url);

  const staff = await staffFromRequest(env, request);
  if (!staff) return json({ ok: false, error: 'auth' }, 401);

  if (request.method === 'GET' && path === '/inbox/api/me') return json({ ok: true, name: staff.name, today: await todayStats(env, staff) });
  if (request.method === 'GET' && path === '/inbox/api/chats') {
    const waiting = await env.INBOX_DB.prepare(
      "SELECT COUNT(*) AS n FROM contacts WHERE COALESCE(status, 'open') = 'open' AND COALESCE(last_ask_at, 0) > COALESCE(last_reply_at, 0) AND last_ask_at > ?1"
    ).bind(Date.now() - WAIT_WINDOW_MS).first();
    return json({ ok: true, chats: await listChats(env, url), waitingCount: waiting?.n || 0 });
  }
  if (request.method === 'GET' && path === '/inbox/api/messages') {
    const data = await listMessages(env, url, deps);
    if (!url.searchParams.get('before')) await logAccess(env, staff, 'open', url.searchParams.get('u'));
    return json({ ok: true, ...data });
  }
  if (request.method === 'POST' && path === '/inbox/api/send') return sendReply(env, request, staff, deps);
  if (request.method === 'POST' && path === '/inbox/api/status') return setStatus(env, request, staff);
  if (request.method === 'GET' && path === '/inbox/api/shortcuts') return json({ ok: true, shortcuts: await listShortcuts(env) });
  if (request.method === 'POST' && path === '/inbox/api/shortcuts') return saveShortcut(env, request, staff);
  if (request.method === 'POST' && path === '/inbox/api/shortcuts/delete') {
    const body = await request.json().catch(() => ({}));
    await env.INBOX_DB.prepare('DELETE FROM shortcuts WHERE id = ?1').bind(Number(body.id)).run();
    await logAccess(env, staff, 'shortcut_delete', '');
    return json({ ok: true, shortcuts: await listShortcuts(env) });
  }
  if (request.method === 'POST' && path === '/inbox/api/hold') {
    const body = await request.json().catch(() => ({}));
    const userId = String(body.u || '');
    if (!userId.startsWith('U')) return json({ ok: false }, 400);
    const until = await setHuman(env, userId, staff, body.on ? HUMAN_HOLD_MS : 0);
    await logAccess(env, staff, body.on ? 'hold' : 'release', userId);
    return json({ ok: true, humanUntil: until });
  }
  return json({ ok: false, error: 'not_found' }, 404);
}

export function isInboxPath(pathname) {
  return pathname === '/inbox' || pathname.startsWith('/inbox/');
}

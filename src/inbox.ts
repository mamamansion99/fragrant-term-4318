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

function kindOf(eventType, messageType) {
  if (eventType === 'message') return messageType || 'message';
  return eventType || 'event';
}

async function touchContact(db, userId, ts, text, author) {
  const isCustomer = author === 'customer';
  await db.prepare(
    `INSERT INTO contacts (user_id, last_message_at, last_text, last_author, last_customer_at, last_reply_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)
     ON CONFLICT(user_id) DO UPDATE SET
       last_message_at = MAX(contacts.last_message_at, ?2),
       last_text = CASE WHEN ?2 >= contacts.last_message_at THEN ?3 ELSE contacts.last_text END,
       last_author = CASE WHEN ?2 >= contacts.last_message_at THEN ?4 ELSE contacts.last_author END,
       last_customer_at = MAX(contacts.last_customer_at, ?5),
       last_reply_at = MAX(contacts.last_reply_at, ?6)`
  ).bind(userId, ts, String(text || '').slice(0, 200), author, isCustomer ? ts : 0, isCustomer ? 0 : ts).run();
}

async function insertMessage(db, m) {
  const res = await db.prepare(
    `INSERT OR IGNORE INTO messages (user_id, ts, direction, author, kind, text, line_message_id, log_id, handler, in_reply_to)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`
  ).bind(m.userId, m.ts, m.direction, m.author, m.kind || '', String(m.text || '').slice(0, 4000),
    m.lineMessageId || '', m.logId || null, m.handler || '', m.inReplyTo || '').run();
  if (res?.meta?.changes) await touchContact(db, m.userId, m.ts, m.text, m.author);
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
  if (filter === 'lead') where.push("COALESCE(contact_type, 'NON_TENANT') = 'NON_TENANT'");
  if (filter === 'tenant') where.push("contact_type = 'TENANT'");
  if (filter === 'waiting') where.push("last_author = 'customer'");
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
    waiting: r.last_author === 'customer',
    human: (r.human_until || 0) > Date.now() ? r.human_by || 'staff' : ''
  }));
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
      humanUntil: contact.human_until || 0
    } : null,
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
    const m = holdMs > 0 ? 'pause' : 'resume';
    await fetch(`${pauseUrl}&u=${encodeURIComponent(userId)}&m=${m}`).catch((err) => console.error('inbox_ai_pause_failed', err));
  }
  return until;
}

async function sendReply(env, request, staff, deps) {
  const body = await request.json().catch(() => ({}));
  const userId = String(body.u || '');
  const text = String(body.text || '').trim();
  if (!userId.startsWith('U') || !text) return json({ ok: false, error: 'missing' }, 400);
  if (text.length > 4900) return json({ ok: false, error: 'too_long' }, 400);
  const store = deps.chatLogContext.getStore();
  if (store) {
    store.author = `staff:${staff.name}`;
    store.handler = 'inbox';
  }
  try {
    await deps.linePush(env.LINE_ACCESS_TOKEN, userId, [{ type: 'text', text }]);
  } catch (err) {
    return json({ ok: false, error: String(err?.message || err).slice(0, 200) }, 502);
  }
  const until = await setHuman(env, userId, staff, HUMAN_HOLD_MS);
  if (body.draftId) {
    await env.INBOX_DB.prepare(
      'UPDATE drafts SET final_text = ?2, final_author = ?3, sent_at = ?4, edited = CASE WHEN draft = ?2 THEN 0 ELSE 1 END WHERE id = ?1'
    ).bind(Number(body.draftId), text, staff.name, Date.now()).run();
  }
  await logAccess(env, staff, 'send', userId);
  return json({ ok: true, humanUntil: until });
}

async function logAccess(env, staff, action, userId) {
  await env.INBOX_DB.prepare('INSERT INTO access_log (ts, staff, action, user_id) VALUES (?1, ?2, ?3, ?4)')
    .bind(Date.now(), staff.name, action, userId || '').run().catch(() => {});
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

export async function handleInboxRequest(request, env, url, deps) {
  const path = url.pathname;
  if (request.method === 'GET' && (path === '/inbox' || path === '/inbox/')) {
    return new Response(INBOX_PAGE_HTML, {
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }
    });
  }
  if (!env.INBOX_DB) return json({ ok: false, error: 'no_db' }, 500);
  if (request.method === 'POST' && path === '/inbox/api/ingest') return ingest(env, request);

  const staff = await staffFromRequest(env, request);
  if (!staff) return json({ ok: false, error: 'auth' }, 401);

  if (request.method === 'GET' && path === '/inbox/api/me') return json({ ok: true, name: staff.name });
  if (request.method === 'GET' && path === '/inbox/api/chats') return json({ ok: true, chats: await listChats(env, url) });
  if (request.method === 'GET' && path === '/inbox/api/messages') {
    const data = await listMessages(env, url, deps);
    if (!url.searchParams.get('before')) await logAccess(env, staff, 'open', url.searchParams.get('u'));
    return json({ ok: true, ...data });
  }
  if (request.method === 'POST' && path === '/inbox/api/send') return sendReply(env, request, staff, deps);
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

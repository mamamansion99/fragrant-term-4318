// @ts-nocheck

/* =========================
 * 0) Small utilities
 * ========================= */
function isIsoDate(str) { return /^\d{4}-\d{2}-\d{2}$/.test(str); } // YYYY-MM-DD
function getChatId(ev)  { return ev?.source?.groupId || ev?.source?.roomId || ev?.source?.userId || ''; }
function getStateKey(ev) {
  const chat = getChatId(ev) || 'unknown';
  const uid  = ev?.source?.userId || 'anon';
  return `${chat}:${uid}`;
}

function formatDateBangkok(date = new Date()) {
  const inBkk = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
  const y = inBkk.getFullYear();
  const m = String(inBkk.getMonth() + 1).padStart(2, '0');
  const d = String(inBkk.getDate()).padStart(2, '0');
  return `${d}/${m}/${y}`;
}

function formatTimeBangkok(date = new Date()) {
  const inBkk = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
  const h = String(inBkk.getHours()).padStart(2, '0');
  const m = String(inBkk.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

const PHONE_RE = /^0\d{9}$/; // 10 digits, starts with 0
const maskPhone = (p)=> (p||'').replace(/^(\d{3})\d{4}(\d{3})$/, '$1••••$2');
const QUESTION_WORD_RE = /(ไหม|มั้ย|มั๊ย|หรือไม่|หรือเปล่า|รึเปล่า|ปะ|ป่ะ|\?)/i;
const PARKING_KEYWORD_RE = /(ที่จอด|ลานจอด|จอดรถ|ค่าจอด|โรงจอด|ซองจอด)/i;
const PARKING_INTENT_RE = /(บริการ|อยาก|ต้องการ|สนใจ|รายละเอียด|เช่า|ขอ|หา|สอบถาม|ข้อมูล|ราคา|กี่บาท|เท่าไหร่|ว่าง|เต็ม|เอารถมา|นำรถมา)/i;
const PARKING_AVAILABILITY_RE = /(มี|พอมี|เหลือ|ว่าง|เต็ม|มั้ย|ไหม)/i;
const URGENT_CONTACT_RE = /(ด่วน|ฉุกเฉิน|ช่วยด้วย|ไฟไหม้|ตำรวจ|ขโมย|urgent|emergency|help|sos|call|phone|เบอร์|แอดมิน|admin|manager|ผู้จัดการ|นิติ|เจ้าหน้าที่|staff|human)/i;
const WAIT_ROOM_STATE = 'WAIT_ROOM';
const TENANT_CHANGE_KEY_PREFIX = 'changeLine:';
// คำหลักเกี่ยวกับ "ตู้เย็น"
const FRIDGE_KEYWORD_RE = /(ตู้เย็น|ตู้แช่เย็น|ตู้แช่|fridge|refrigerator)/i;

// กลุ่มคำว่า "เพิ่ม/ขอเช่า/อยากใช้" → เจตนาขอใช้/เพิ่มตู้เย็น
const FRIDGE_ADD_VERB_RE =
  /(เพิ่ม|ขอเพิ่ม|อยาก(?:ได้|ใช้)?|เอาด้วย|เอาเพิ่ม|ขอใช้|ขอเช่า|เช่า|เปิดใช้|ใช้(?:ตู้เย็น)?)/i;

// กลุ่มคำว่า "ยกเลิก/ไม่เอาแล้ว/คืน" → เจตนายกเลิกตู้เย็น
const FRIDGE_CANCEL_VERB_RE =
  /(ไม่เอา(?:แล้ว)?|ไม่เอาตู้เย็น|ยกเลิก|เลิก(?:ใช้|เช่า)?|เอาออก|คืน(?:ตู้เย็น)?|หยุดใช้)/i;

// ถามข้อมูล/ราคา
const FRIDGE_QUESTION_RE =
  /(ราคา|เท่าไหร่|คิดยังไง|คิดเงินยังไง|คิดตังยังไง|มี(?:ไหม|มั้ย|มั๊ย)|มีหรือเปล่า|พร้อมไหม|ว่างไหม|ว่างมั้ย)/i;

const DEFAULT_FRIDGE_CANCEL_NOTIFY_ID = 'Ue90558b73d62863e2287ac32e69541a3';

function getFridgeCancelNotifyId(env) {
  return env.FRIDGE_CANCEL_NOTIFY_ID || DEFAULT_FRIDGE_CANCEL_NOTIFY_ID;
}
const UTILITY_THAI_KEYWORDS = [
  'ค่าน้ำ',
  'ค่าไฟ',
  'ค่าน้ำ-ไฟ',
  'ค่าน้ำค่าไฟ',
  'ค่าน้ำไฟ',
  'น้ำไฟ',
  'ค่าไฟฟ้า',
  'ค่าน้ำประปา'
];
const UTILITY_EN_KEYWORDS = [
  'utility bill',
  'utility fee',
  'utilities',
  'utility',
  'water bill',
  'electric bill',
  'electricity bill',
  'water & electric',
  'water/electric'
];
const CHECKIN_CHANGE_KEYWORDS = [
  'เปลี่ยนวันเช็คอิน',
  'เปลี่ยนวันที่เช็คอิน',
  'เปลี่ยนวันทีเช็คอิน',
  'เปลี่ยนวันเชคอิน',
  'เปลี่ยนเวลาเช็คอิน',
  'เปลี่ยนเวลาเชคอิน',
  'changecheckindate',
  'changecheckintime'
];
const CHECKIN_COMMAND_RE = /^\s*เช็คอินห้อง\s+([^\s]+)\s*$/i;
const CHECKIN_FLOW_TTL_SECONDS = 30 * 60;
const CHECKIN_FLOW_TTL_MS = CHECKIN_FLOW_TTL_SECONDS * 1000;

const BOOKING_SLIP_TTL_SECONDS = 60 * 60;       // 60 minutes to send slip
const BOOKING_SLIP_TTL_MS = BOOKING_SLIP_TTL_SECONDS * 1000;
const BOOKING_ID_TTL_SECONDS = 6 * 60 * 60;     // 6 hours to send ID after slip
const BOOKING_ID_TTL_MS = BOOKING_ID_TTL_SECONDS * 1000;
const PENALTY_FLOW_TTL_SECONDS = 15 * 60;
const PENALTY_FLOW_TTL_MS = PENALTY_FLOW_TTL_SECONDS * 1000;
const CHECKOUT_FLOW_TTL_SECONDS = 10 * 60;

function buildCheckinFlowKey(userId, chatId) {
  if (userId) {
    return `checkin_flow:${userId}`;
  }
  if (chatId) {
    return `checkin_flow:${chatId}`;
  }
  return 'checkin_flow:unknown';
}
function parseCheckinCommand(text) {
  if (!text) return null;
  const match = CHECKIN_COMMAND_RE.exec(text);
  if (!match) return null;
  return match[1].toUpperCase();
}

const CHECKOUT_TRIGGER_RE = /(เช็ค\s*เอ[้๊]?[า]?ท์?|checkout)/i;
function parseCheckoutTrigger(text) {
  if (!text) return null;
  const raw = text || '';
  const collapsed = raw.replace(/\s+/g, '').toLowerCase();
  const roomMatchCollapsed = collapsed.match(/(เช็คเอ้าท์|เช็คเอาต์|เช็คเอาท์|checkout)ห้อง?([ab]\d{3,4})/);
  const roomMatchSpaced = raw.match(/(เช็คเอ้าท์|เช็คเอาต์|เช็คเอาท์|checkout)\s*ห้อง?\s*([ab]\d{3,4})/i);
  const roomToken = (roomMatchSpaced?.[2] || roomMatchCollapsed?.[2] || '').toUpperCase();
  if (!roomToken) return null;
  if (!/^[AB]\d{3,4}$/.test(roomToken)) return null;
  return roomToken;
}

function buildBookingFlowKey(userId, chatId) {
  if (userId) return `booking_flow:${userId}`;
  if (chatId) return `booking_flow:${chatId}`;
  return 'booking_flow:unknown';
}

function extractBookingCode(text) {
  const match = /MM\d{3,}/i.exec(text || '');
  if (!match) return null;
  const code = match[0].toUpperCase();
  return code.startsWith('#') ? code : `#${code}`;
}

const OWNER_APPROVAL_KEYWORD_RE = /^(?:อนุมัติ|ไม่อนุมัติ)\s*(?:เปลี่ยนไลน์|เปลี่ยนไอดีผู้เช่า|line\s*id\s*change)/i;

const AVAILABILITY_REGEXES = [
  /(ห้อง|ตึก)[\s\S]{0,10}(ยัง)?ว่าง/i,
  /(ยัง)?มีห้อง/i,
  /เหลือห้อง/i,
  /ห้องเต็มไหม/i,
  /เช็ค.*ห้อง/i,
  /ว่างวันไหน/i,
  /ห้อง(วันนี้|พรุ่งนี้)/i
];

const AVAILABILITY_EXCLUDE_KEYWORDS = [
  'ห้องกี่คืน',
  'ราคา',
  'เรท',
  'ห้องเดี่ยว',
  'เตียงคู่',
  'สูท',
  'เช็คอิน',
  'เช็คเอาท์',
  'จองเลย',
  'ขอเบอร์จอง'
];

const AVAILABILITY_EXCLUDE_REGEXES = [
  /room\s*available/i,
  /\bavailability\b/i,
  /book\s*room/i,
  /room\s*(tonight|tomorrow)/i
];

// Detects general parking interest by requiring the parking keyword plus a basic intent verb.
function isParkingIntent(text){
  const normalized = (text || '').trim();
  if (!normalized) return false;
  if (/^\s*บริการ\s*ที่จอดรถ\s*$/i.test(normalized)) return true;
  if (/^ขอเช่าที่จอด/i.test(normalized)) return true;
  if (!PARKING_KEYWORD_RE.test(normalized)) return false;
  if (PARKING_INTENT_RE.test(normalized)) return true;
  const hasQuestionWord = QUESTION_WORD_RE.test(normalized);
  const hasAvailabilityWord = PARKING_AVAILABILITY_RE.test(normalized);
  if (hasQuestionWord || hasAvailabilityWord) return true;
  return false;
}

function detectFridgeIntent(text) {
  const raw = (text || '').trim();
  if (!raw) {
    return { matches: false, isAdd: false, isCancel: false, isQuestion: false, isShort: false, hasFridgeWord: false };
  }

  if (/^\s*บริการ\s*ตู้เย็น\s*$/i.test(raw)) {
    return { matches: true, isAdd: false, isCancel: false, isQuestion: true, isShort: false, hasFridgeWord: true };
  }

  const lower = raw.toLowerCase();
  const collapsed = lower.replace(/\s+/g, '');
  const hasFridgeWord =
    FRIDGE_KEYWORD_RE.test(raw) ||
    FRIDGE_KEYWORD_RE.test(lower) ||
    FRIDGE_KEYWORD_RE.test(collapsed);
  if (!hasFridgeWord) {
    return { matches: false, isAdd: false, isCancel: false, isQuestion: false, isShort: false, hasFridgeWord: false };
  }

  const addNearFridge =
    /(เพิ่ม|ขอเพิ่ม|อยากได้|อยากใช้|เอาด้วย|เอาเพิ่ม).{0,12}(ตู้เย็น|ตู้แช่เย็น|ตู้แช่)/i.test(raw) ||
    /(ตู้เย็น|ตู้แช่เย็น|ตู้แช่).{0,12}(เพิ่ม|เอาเพิ่ม|เอาด้วย)/i.test(raw);

  const hasAddVerb = FRIDGE_ADD_VERB_RE.test(raw) || addNearFridge;
  const hasCancelVerb = FRIDGE_CANCEL_VERB_RE.test(raw);
  const hasQuestionVerb = QUESTION_WORD_RE.test(raw) || FRIDGE_QUESTION_RE.test(raw);
  const isShort = raw.length <= 25;

  const matches = hasAddVerb || hasCancelVerb || hasQuestionVerb || isShort;

  return {
    matches,
    isAdd: hasAddVerb,
    isCancel: hasCancelVerb,
    isQuestion: hasQuestionVerb,
    isShort,
    hasFridgeWord
  };
}

function isFridgeIntent(text) {
  return detectFridgeIntent(text).matches;
}

async function pushFridgeCancelNotification(env, ev, text) {
  const to = getFridgeCancelNotifyId(env);
  if (!to) {
    console.warn('pushFridgeCancelNotification: missing target id');
    return false;
  }

  const userId = ev?.source?.userId || 'unknown';
  const chatId = getChatId(ev) || 'unknown';
  const chatType = ev?.source?.type || 'unknown';
  const messageLines = [
    'ผู้เช่าขอยกเลิกตู้เย็น',
    text || '[ไม่ระบุข้อความ]',
    `ผู้ส่ง: ${userId}`,
    `แชท: ${chatId} (${chatType})`
  ].filter(Boolean);

  try {
    await linePushText(env.LINE_ACCESS_TOKEN, to, messageLines.join('\n'));
    return true;
  } catch (err) {
    console.error('pushFridgeCancelNotification error', err);
    return false;
  }
}

function isUtilityInquiry(text) {
  const normalized = (text || '').trim();
  if (!normalized) return false;
  const lower = normalized.toLowerCase();
  const collapsed = lower.replace(/\s+/g, '');

  if (UTILITY_THAI_KEYWORDS.some((kw) => lower.includes(kw))) return true;
  const joinedThaiHints = ['ค่าน้ำค่าไฟ', 'ค่าน้ำไฟ', 'น้ำค่าไฟ', 'น้ำไฟ'];
  if (joinedThaiHints.some((kw) => collapsed.includes(kw))) return true;

  if (UTILITY_EN_KEYWORDS.some((kw) => lower.includes(kw))) return true;
  const englishPair = lower.includes('water') && (lower.includes('electric') || lower.includes('electricity'));
  return englishPair;
}

function isCheckinChangeIntent(text) {
  const normalized = (text || '').toLowerCase().replace(/\s+/g, '');
  if (!normalized) return false;
  return CHECKIN_CHANGE_KEYWORDS.some(keyword => normalized.includes(keyword));
}

// Rent key/keycard/set commands
function parseKeyRent(textRaw) {
  const raw = String(textRaw || '').trim();
  if (!raw) return null;
  const compact = raw.replace(/\s+/g, '');

  let mode = null;
  if (compact.startsWith('เช่าชุดกุญแจ')) mode = 'SET';
  else if (compact.startsWith('เช่าคีย์การ์ด')) mode = 'KEYCARD';
  else if (compact.startsWith('เช่ากุญแจ')) mode = 'KEY';
  else return null; // not a rent-key trigger

  const m = compact.match(/([AB])(\d{2,4})/i);
  if (!m) return { error: 'MISSING_ROOM' };
  const room = `${m[1].toUpperCase()}${m[2]}`;

  const items = [];
  if (mode === 'SET' || mode === 'KEYCARD') {
    items.push({ assetType: 'KEYCARD', qty: 1, unitPrice: 100, amount: 100 });
  }
  if (mode === 'SET' || mode === 'KEY') {
    items.push({ assetType: 'KEY', qty: 1, unitPrice: 500, amount: 500 });
  }
  const amount = items.reduce((s, it) => s + it.amount, 0);

  return { mode, room, items, amount, rawText: raw };
}

// Legacy "key A101 20" parser for forgot-key flow
function parseKeyKeyword(text) {
  const raw = (text || '').trim();
  if (!raw) return null;
  if (!/^(คีย์|key)/i.test(raw)) return null;

  const remainder = raw.replace(/^(คีย์|key)/i, '').trim();
  if (!remainder) return null;

  const tokens = remainder.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return null;

  const amountToken = tokens[tokens.length - 1];
  if (!/^\d+$/.test(amountToken)) return null;
  const amount = parseInt(amountToken, 10);
  if (!Number.isFinite(amount)) return null;

  const buildingRoomRaw = tokens.slice(0, -1).join('');
  const match = buildingRoomRaw.match(/^((?:a|b)|(?:เอ)|(?:บี))(\d{1,4})$/i);
  if (!match) return null;

  const buildingToken = match[1] || '';
  let building = null;
  if (/^a$/i.test(buildingToken) || /^เอ$/i.test(buildingToken)) {
    building = 'A';
  } else if (/^b$/i.test(buildingToken) || /^บี$/i.test(buildingToken)) {
    building = 'B';
  }
  if (!building) return null;

  const room = match[2];
  if (!room) return null;

  return { building, room, amount };
}

/* =========================
 * 1) KV + Loading helpers
 * ========================= */
function hasKV(env){ return !!(env && env.KV && typeof env.KV.get === 'function'); }
async function kvGet(env, k){ try{ if(!hasKV(env)) return null; return await env.KV.get(k, 'json'); }catch(_){ return null; } }
async function kvPut(env, k, v, ttlSeconds){ try{ if(!hasKV(env)) return; await env.KV.put(k, JSON.stringify(v), { expirationTtl: ttlSeconds || 7200 }); }catch(_){ /* no-op */ } }
async function kvDel(env, k){ try{ if(!hasKV(env)) return; await env.KV.delete(k); }catch(_){ /* no-op */ } }

async function lineStartLoading(token, chatId, seconds = 7) {
  if (!chatId) return;
  const secs = Math.max(5, Math.min(seconds, 60));
  await fetch('https://api.line.me/v2/bot/chat/loading/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({ chatId, loadingSeconds: secs })
  }).catch(console.error);
}

// ---- LINE helpers ----
async function linePushText(channelToken, to, text) {
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${channelToken}`,
    },
    body: JSON.stringify({
      to,                     // userId, groupId, or roomId
      messages: [{ type: 'text', text }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LINE push failed ${res.status} ${res.statusText}: ${body}`);
  }
}

async function linePush(channelToken, to, messages) {
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${channelToken}`,
    },
    body: JSON.stringify({ to, messages })
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LINE push failed ${res.status} ${res.statusText}: ${body}`);
  }
}

async function fetchWithRedirect(url, init, bodyString, maxRedirects = 3) {
  let currentUrl = url;
  let options = { ...init };
  if (bodyString !== undefined) {
    options.body = bodyString;
  }

  for (let i = 0; i <= maxRedirects; i += 1) {
    const res = await fetch(currentUrl, options);
    if (![301, 302, 303, 307, 308].includes(res.status)) {
      return res;
    }
    const location = res.headers.get('location');
    if (!location) {
      return res;
    }

    currentUrl = new URL(location, currentUrl).toString();
    options = { ...options };
    if (bodyString !== undefined) {
      options.body = bodyString;
    }
  }

  return fetch(currentUrl, options);
}


// GAS #1: your existing “MM_LineWebhook” (used for LINE webhook traffic)
function getWebhookGas(env){
  return env.MM_WEBHOOK_URL || '';
}

function getReservationGas(env){
  // Booking flow → only MM_V2_URL (no fallback)
  return env.MM_V2_URL || '';
}

function getReservationAdminKey(env){
  return env.MM_WORKER_SECRET || env.WORKER_SECRET || '';
}

// GAS #2: new Move-out API (resolve_token / status / moveout_upsert)
function getMoveoutGas(env){
  return env.MOVEOUT_GAS_URL || '';
}

function getAutoImgGas(env){
  return env.AUTO_IMG_URL || '';
}


function corsHeaders(origin){
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin'
  };
}

function getPayRentGas(env){
  return env.PAYRENT_GAS_URL || '';
}

function getN8nPayRentUrl(env){
  return env.N8N_PAYRENT_URL || '';
}

async function fetchLineImageAsDataUrl(channelToken, messageId) {
  if (!channelToken || !messageId) throw new Error('missing token or messageId');
  const res = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${channelToken}` }
  });
  if (!res.ok) throw new Error(`line media fetch failed ${res.status}`);
  const ct = res.headers.get('content-type') || 'image/jpeg';
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);
  return `data:${ct};base64,${base64}`;
}

async function reservationAdminCall(env, action, payload) {
  const urlBase = getReservationGas(env);
  const key = getReservationAdminKey(env);
  if (!urlBase) throw new Error('missing reservation admin config');
  const url = `${urlBase}?action=${encodeURIComponent(action)}`;
  const bodyPayload: Record<string, any> = { ...(payload || {}) };
  if (key) bodyPayload.worker_secret = key;
  const body = JSON.stringify(bodyPayload);
  // Lightweight call log for booking API (no secrets logged)
  const reservationId = (payload && (payload.reservation_id || payload.code)) || '';
  const dataUrlLen = payload && typeof payload.dataUrl === 'string' ? payload.dataUrl.length : 0;
  console.log('booking_call', {
    action,
    url,
    reservationId,
    hasDataUrl: dataUrlLen > 0,
    dataUrlLength: dataUrlLen
  });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body
  });
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  const data = ct.includes('application/json') ? await res.json().catch(() => ({})) : { text: await res.text() };
  const preview = typeof data === 'string'
    ? data.slice(0, 200)
    : JSON.stringify(data).slice(0, 200);
  console.log('booking_call_res', {
    action,
    url,
    reservationId,
    status: res.status,
    ok: res.ok,
    bodyPreview: preview
  });
  return { ok: res.ok && (data.ok !== false), data };
}

async function reservationAdminCallWithAuthGuard(env, action, payload) {
  const urlBase = getReservationGas(env);
  const key = getReservationAdminKey(env);
  if (!urlBase) {
    throw new Error('missing_reservation_config');
  }
  const res = await reservationAdminCall(env, action, payload);
  if (!res.ok) {
    const err = (res.data && res.data.error) || '';
    if (err === 'unauthorized') throw new Error('reservation_admin_unauthorized');
    if (err && typeof err === 'string' && err.includes('missing_MM_V2_SPREADSHEET_ID')) {
      throw new Error('reservation_missing_sheet');
    }
  }
  return res;
}

async function forwardToSpecificGas(env, gasUrl, body) {
  const secret = env.WORKER_SECRET || env.MM_WORKER_SECRET || '';
  const payload = { ...body, workerSecret: secret };

  if (!gasUrl || !secret) {
    console.error('forwardToSpecificGas: missing config', { hasUrl: !!gasUrl, hasSecret: !!secret });
    return false;
  }

  let ok = false, status = 0, text = '';
  try {
    const bodyString = JSON.stringify(payload);
    const res = await fetchWithRedirect(gasUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Worker-Secret': secret
      },
      body: bodyString
    }, bodyString);
    status = res.status;
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (ct.includes('application/json')) {
      const j = await res.json().catch(()=>({}));
      ok = !!j.ok || res.ok;
      text = JSON.stringify(j);
    } else {
      text = await res.text();
      ok = res.ok && text.trim() === 'OK';
    }
  } catch (e) {
    console.error('forwardToSpecificGas error', String(e));
  }
  console.log('forwardToSpecificGas result', { url: (new URL(gasUrl)).host, status, ok, text: (''+text).slice(0,200) });
  return ok;
}

/** Forward any payload to GAS with header+body secret. Returns boolean ok. */
async function forwardToGas(env, body) {
  const gasUrl = getWebhookGas(env);
  const secret = env.WORKER_SECRET || env.MM_WORKER_SECRET || '';
  const payload = { ...body, workerSecret: secret }; // body secret for edge calls

  if (!gasUrl || !secret) {
    console.error('forwardToGas: missing config', { hasUrl: !!gasUrl, hasSecret: !!secret });
    return false;
  }

  let ok = false, status = 0, text = '';
  try {
    const bodyString = JSON.stringify(payload);
    const res = await fetchWithRedirect(gasUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Worker-Secret': secret // header secret for forwarded LINE events
      },
      body: bodyString
    }, bodyString);
    status = res.status;
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (ct.includes('application/json')) {
      const j = await res.json().catch(()=>({}));
      ok = !!j.ok;
      text = JSON.stringify(j);
    } else {
      text = await res.text();
      ok = res.ok && text.trim() === 'OK';
    }
  } catch (e) {
    console.error('forwardToGas fetch error', String(e));
  }
  console.log('forwardToGas result', { status, ok, text: ('' + text).slice(0, 200) });
  return ok;
}

/* =========================
 * 3) Move-out postback @ Edge
 * ========================= */
async function handleMoveoutPostback(env, event, data) {
  const chatId = getChatId(event);
  const replyToken = event?.replyToken || '';
  const stateKey = getStateKey(event);

  const send = async (messages) => {
    if (!replyToken) { console.error('NO_REPLYTOKEN moveout; skip push'); return; }
    try { await lineReply(env.LINE_ACCESS_TOKEN, replyToken, messages); }
    catch (e) { console.error('LINE_REPLY_FAIL', String(e)); }
  };

  if (data.act === 'moveout_cancel') {
    try { await kvDel(env, stateKey + ':moveout_flow'); } catch {}
    await send([{ type:'text', text:'ยกเลิกขั้นตอนแจ้งออกแล้วค่ะ' }]);
    return true;
  }

  if (data.act === 'moveout_yes') {
    // ❗ Don’t trust postback params. Read from KV.
    const flow = await kvGet(env, stateKey + ':moveout_flow');
    const room = String(flow?.room || '').toUpperCase().trim();
    const iso  = String(flow?.dateISO || '').trim();
    const phone= String(flow?.phone || '').trim();

    if (!room || !isIsoDate(iso) || !PHONE_RE.test(phone)) {
      console.error('moveout_yes: invalid or missing KV state', { hasRoom:!!room, hasDate:isIsoDate(iso), hasPhone:PHONE_RE.test(phone) });
      await send([{ type:'text', text:'ไม่สามารถยืนยันข้อมูลได้ กรุณาเริ่มขั้นตอนใหม่อีกครั้งค่ะ' }]);
      try { await kvDel(env, stateKey + ':moveout_flow'); } catch {}
      return true;
    }

    // 1) show loading immediately (no text yet)
    await lineStartLoading(env.LINE_ACCESS_TOKEN, chatId, 15);

    // 2) fire GAS synchronously (NO push used)
    const ok = await forwardToGas(env, { act:'moveout', roomId:room, dateISO:iso, phone, lineUserId:(event?.source?.userId||'') });

    // 3) clear flow state
    try { await kvDel(env, stateKey + ':moveout_flow'); } catch {}

    // 4) single reply with final result (within 1 minute)
    const finalMsg = ok
      ? `✅ รับแจ้งออกแล้ว\nห้อง ${room} จะว่างตั้งแต่ ${iso.split('-').reverse().join('/')}\nเบอร์ติดต่อ: ${maskPhone(phone)}`
      : '❗บันทึกไม่สำเร็จ โปรดลองใหม่หรือติดต่อผู้ดูแลค่ะ';

    await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [{ type:'text', text: finalMsg }]);
    return true;
  }

  return false;
}

/* =========================
 * 4) Main Worker Entrypoint
 * ========================= */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS preflight for browser
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env.ALLOWED_ORIGIN) });
    }

    // Temporary env diagnostic (remove after use)
    if (url.pathname === '/debug-env') {
      const redacted: Record<string, any> = {};
      for (const [k, v] of Object.entries(env || {})) {
        const isSecret = /token|secret|key|password/i.test(k);
        if (isSecret) {
          const str = String(v || '');
          redacted[k] = str ? `${str.slice(0, 4)}...(${str.length} chars)` : '';
        } else {
          redacted[k] = v;
        }
      }
      return new Response(JSON.stringify(redacted, null, 2), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Raw LINE passthrough → forward body/headers to GAS
    const passthroughUrl = env.LINE_PASSTHROUGH_URL || env.RAW_LINE_GAS_URL || '';
    if (passthroughUrl && request.method === 'POST' && (url.pathname === '/line-raw' || url.pathname === '/line-passthrough')) {
      const buf = await request.arrayBuffer();
      const headers = new Headers();
      request.headers.forEach((v, k) => {
        if (k.toLowerCase() === 'content-length') return;
        headers.set(k, v);
      });
      if (!headers.has('content-type')) headers.set('content-type', 'application/json');

      const res = await fetch(passthroughUrl, {
        method: 'POST',
        headers,
        body: buf
      });
      const resBody = await res.text();
      const resCt = res.headers.get('content-type') || 'text/plain';
      return new Response(resBody, { status: res.status, headers: { 'content-type': resCt } });
    }

// Frontend API → proxy to GAS #2
if (url.pathname.startsWith('/api/moveout')) {
  // base GAS #2 URL (must be your Web App /exec)
  const base = new URL(getMoveoutGas(env));

  // Start with the browser’s query string, then add ws (if any)
  const t = new URL(base);
  t.search = url.search; // keep ?action=...&lineId=...
  const ws = env.WORKER_SECRET || '';
  if (ws) t.searchParams.set('ws', ws); // optional GET auth

  // Build fetch init
  const init = { method: request.method, headers: {} };

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const raw = await request.text();
    let body = {};
    try { body = JSON.parse(raw || '{}'); } catch (_) {}
    if (ws) body.workerSecret = ws; // optional body auth
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  // Call GAS and pass through content-type as-is
  const res = await fetch(t.toString(), init);
  const bodyText = await res.text();
  const ct = res.headers.get('content-type') || 'application/json';

  return new Response(bodyText, {
    status: res.status,
    headers: { ...corsHeaders(env.ALLOWED_ORIGIN), 'Content-Type': ct }
  });
}

    if (request.method === 'GET' && url.pathname === '/debug/postback') {
      const sample = url.searchParams.get('data') || 'action=CONTINUE&room=A106&end=2026-02-27&inq=INQ_A106_2026-02-27_xxxxxx';
      const parsed = parsePostbackData(sample);
      const body = JSON.stringify({ raw: sample, parsed }, null, 2);
      return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
    }


    // Custom callback for tenant ID change completion
    if (request.method === 'POST' && url.pathname === '/tenant-change-complete') {
      const secret = env.WORKER_SECRET || '';
      if (!secret || request.headers.get('x-worker-secret') !== secret) {
        return new Response('Unauthorized', { status: 401 });
      }
      let body = {};
      try { body = await request.json(); } catch (_) { body = {}; }
      const userId = String(body?.userId || '').trim();
      if (userId) {
        await kvDel(env, TENANT_CHANGE_KEY_PREFIX + userId);
      }
      return new Response(JSON.stringify({ cleared: !!userId }), { status: 200 });
    }

    // Everything else is the LINE webhook:
    if (request.method !== 'POST') return new Response('OK', { status: 200 });

    const bodyText = await request.text();
    // Verify LINE signature ...

    const sig = request.headers.get('x-line-signature') || '';
    if (!(await verifySig(bodyText, sig, env.LINE_CHANNEL_SECRET))) {
      return new Response('Unauthorized', { status: 401 });
    }

    const payload = JSON.parse(bodyText || '{}');
    const events = Array.isArray(payload.events) ? payload.events : [];
    const firstEvent = events[0];
    const replyToLine = createReplyToLine(env);

    if (firstEvent?.source?.type === 'group') {
      console.log('GROUP ID:', firstEvent.source.groupId);
    }

    if (events.length > 0 && env.N8N_POSTBACK_URL) {
      if (firstEvent?.type === 'postback' && firstEvent?.postback?.data) {
        let fridgePostback = null;
        try {
          fridgePostback = JSON.parse(firstEvent.postback.data);
        } catch (_) {
          fridgePostback = null;
        }

        if (fridgePostback?.type === 'fridge' && fridgePostback?.action === 'not_ready') {
          ctx.waitUntil(
            fetch(env.N8N_POSTBACK_URL, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(payload)
            }).catch((err) => console.error('forward fridge not_ready failed', err))
          );
        }
      }
    }

    for (const ev of events) {
      const replyToken = ev?.replyToken;

      /* -----------------------
       * POSTBACK HANDLER
       * --------------------- */
      if (ev.type === 'postback') {
        const data = parsePostbackData(ev.postback?.data || '');
        const pickFirst = (v) => Array.isArray(v) ? v[0] : v;
        const normalize = (v) => {
          if (v === undefined || v === null) return '';
          return String(pickFirst(v) || '').trim();
        };
        const actionRaw = normalize(data.action || data.act);
        const action = actionRaw.toUpperCase();
        const room = normalize(data.room || data.roomId || data.r);
        const end = normalize(data.end || data.endDate || data.checkout);
        const inq = normalize(data.inq || data.inquiry || data.inquiryId);
        const postbackLog = {
          action,
          room,
          end,
          inq,
          userId: ev?.source?.userId || '',
          timestamp: new Date(ev?.timestamp || Date.now()).toISOString()
        };
        console.log('line_postback', postbackLog);

        // Forward booking confirmations to reservation Apps Script for button-driven flow/logging
        if (action === 'CONFIRM' && getReservationGas(env)) {
          ctx.waitUntil(forwardToSpecificGas(env, getReservationGas(env), { events: [ev] }));
          const code = normalize(data.code || data.reservation_id || data.reservationId);
          if (!code) {
            await errorReplyOrPush(env, replyToken, getChatId(ev), 'ไม่พบรหัสจองในปุ่ม กรุณาพิมพ์รหัสอีกครั้ง');
            continue;
          }

          // Quick acknowledge so user sees progress
          const debounce = '⏳ กำลังตรวจสอบรหัสจอง…';
          if (replyToken) {
            await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [{ type: 'text', text: debounce }]).catch(console.error);
          } else {
            const chatId = getChatId(ev);
            if (chatId) ctx.waitUntil(linePushText(env.LINE_ACCESS_TOKEN, chatId, debounce).catch(console.error));
          }

          let payMsgs: any[] = [];
          try {
            const resp = await reservationAdminCallWithAuthGuard(env, 'reservation_ack', {
              reservation_id: code.replace(/^#/, ''),
              line_user_id: ev?.source?.userId || ''
            });
            if (resp?.ok && resp.data) {
              const payText = resp.data.payText || '✅ ยืนยันการจองเรียบร้อย\nกรุณาชำระค่าจอง 2000 บาท และส่งสลิปกลับมาที่แชทนี้\nทีมงานจะตรวจสอบและยืนยันให้ภายใน 24 ชม.';
              payMsgs.push({ type: 'text', text: payText });
              if (resp.data.qrImageUrl) {
                payMsgs.push({
                  type: 'image',
                  originalContentUrl: resp.data.qrImageUrl,
                  previewImageUrl: resp.data.qrImageUrl
                });
              }
            }
          } catch (err) {
            console.error('reservation_ack on CONFIRM failed', err);
          }

          if (payMsgs.length) {
            const chatId = getChatId(ev);
            if (chatId) {
              ctx.waitUntil(linePush(env.LINE_ACCESS_TOKEN, chatId, payMsgs).catch(console.error));
            } else if (replyToken) {
              await lineReply(env.LINE_ACCESS_TOKEN, replyToken, payMsgs).catch(console.error);
            }
          }
          continue;
        }

        const isContractRenewalAction = action === 'CONTINUE' || action === 'LEAVE' || action === 'UNDECIDED';
        const looksLikeContractRenewal =
          isContractRenewalAction ||
          Object.prototype.hasOwnProperty.call(data, 'inq') ||
          Object.prototype.hasOwnProperty.call(data, 'inquiry') ||
          Object.prototype.hasOwnProperty.call(data, 'inquiryId');

        if (looksLikeContractRenewal && (!action || !inq)) {
          console.warn('contract_renewal_postback_missing_fields', postbackLog);
          try {
            await replyToLine(replyToken, [{ type: 'text', text: 'ข้อมูลไม่ครบ กรุณาลองใหม่อีกครั้ง' }]);
          } catch (err) {
            console.error('contract_renewal_reply_fail', err);
          }
          continue;
        }

        if (isContractRenewalAction) {

          const renewalPayload = {
            source: 'line_postback',
            eventId: ev?.webhookEventId || ev?.replyToken || '',
            timestamp: ev?.timestamp || Date.now(),
            userId: ev?.source?.userId || '',
            replyToken: replyToken || '',
            action,
            inquiryId: inq,
            roomId: room || '',
            contractEnd: end || ''
          };
          ctx.waitUntil(
            notifyN8nRenewalPostback(env, renewalPayload)
              .catch((err) => console.error('contract_renewal_notify_fail', err))
          );

          const roomLabel = room || 'ไม่ระบุ';
          const replyMap = {
            CONTINUE: `รับทราบค่ะ ✅ ห้อง ${roomLabel} แจ้งว่า “อยู่ต่อ” แล้ว`,
            LEAVE: `รับทราบค่ะ 🚚 ห้อง ${roomLabel} แจ้งว่า “ย้ายออก” แล้ว แอดมินจะติดต่อกลับเพื่อขั้นตอนถัดไป`,
            UNDECIDED: `รับทราบค่ะ 🤔 ห้อง ${roomLabel} แจ้งว่า “ยังไม่แน่ใจ” แล้ว หากพร้อมเมื่อไหร่กดเลือกได้อีกครั้ง`
          };

          try {
            await replyToLine(replyToken, [{ type: 'text', text: replyMap[action] || 'รับทราบค่ะ' }]);
          } catch (err) {
            console.error('contract_renewal_reply_fail', err);
          }

          if (action === 'LEAVE') {
            const ownerGroupId = env.OWNER_GROUP_ID || '';
            const leavePushEnabled = String(env.ENABLE_LEAVE_PUSH || '').toLowerCase() === 'true';
            if (ownerGroupId && leavePushEnabled) {
              const now = `${formatDateBangkok()} ${formatTimeBangkok()}`;
              const summary = [
                '🚚 Tenant plans to leave',
                `Room: ${roomLabel}`,
                `EndDate: ${end || '-'}`,
                `InquiryId: ${inq}`,
                `Time: ${now}`
              ].join('\n');

              ctx.waitUntil(
                linePushText(env.LINE_ACCESS_TOKEN, ownerGroupId, summary)
                  .catch((err) => console.error('contract_renewal_leave_push_fail', err))
              );
            }
          }

          continue;
        }

        // Move-out postbacks handled at Edge
        if (data.act === 'moveout_yes' || data.act === 'moveout_cancel') {
          const handled = await handleMoveoutPostback(env, ev, data);
          if (handled) continue;
        }

        // Group approve/reject → instant ack, then forward to GAS
        if (data.act === 'mgr_approve' || data.act === 'mgr_reject') {
          const txt = data.act === 'mgr_approve'
            ? 'รับทราบ ✓ กำลังบันทึกและแจ้งผู้จัดการ…'
            : 'รับทราบ ✓ ส่งเข้า Review Queue แล้ว…';
          ctx.waitUntil(lineReply(env.LINE_ACCESS_TOKEN, replyToken, [{ type:'text', text: txt }]).catch(console.error));
          ctx.waitUntil(forwardToGas(env, { events: [ev] }));
          continue;
        }

        // Pay rent postback → forward to GAS
        if (data.act === 'pay_rent') {
          ctx.waitUntil(forwardToGas(env, { events: [ev] }));
          continue;
        }

        // Cancel rent quick action
        if (data.act === 'rent_cancel') {
          ctx.waitUntil(lineReply(env.LINE_ACCESS_TOKEN, replyToken, [
            { type: 'text', text: '❌ ยกเลิกขั้นตอนชำระค่าเช่าแล้วครับ/ค่ะ' }
          ]).catch(console.error));
          ctx.waitUntil(forwardToGas(env, { events: [ev] }));
          continue;
        }

        if (data.act === 'fridge_rent_request') {
          const sanitizedData = {
            ...data,
            lineUserId: ev?.source?.userId || data.lineUserId || null,
            chatId: getChatId(ev) || data.chatId || null
          };

          const fridgePayload = {
            source: 'line_postback',
            channel: 'fridge',
            event: ev,
            data: sanitizedData,
            receivedAt: new Date().toISOString()
          };

          ctx.waitUntil(
            notifyN8nFridge(env, fridgePayload)
              .catch((err) => console.error('fridge notify failed', err))
          );

          if (replyToken) {
            await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [
              { type: 'text', text: 'รับคำขอเช่าตู้เย็นแล้วค่ะ กำลังแจ้งเจ้าหน้าที่ต่อให้ทันที' }
            ]).catch(console.error);
          }
          continue;
        }

        if (data.act === 'parking_rent_request') {
          const sanitizedParking = {
            ...data,
            type: 'parking',
            plan: 'parking',
            lineUserId: ev?.source?.userId || data.lineUserId || null,
            chatId: getChatId(ev) || data.chatId || null
          };
          const parkingPayload = {
            source: 'line_postback',
            channel: 'parking',
            event: ev,
            data: sanitizedParking,
            receivedAt: new Date().toISOString()
          };

          if (replyToken) {
            await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [
              { type: 'text', text: 'รับคำขอที่จอดรถแล้วครับ กำลังตรวจสอบความว่างให้ทันที' }
            ]).catch(console.error);
          }

          ctx.waitUntil(
            notifyN8nParking(env, parkingPayload).catch((err) => console.error('parking notify failed', err))
          );

          ctx.waitUntil(
            forwardToGas(env, { events: [ev], parking: parkingPayload })
          );
          continue;
        }

        // Ultra-fast postbacks handled here (no GAS)
// Ultra-fast postbacks handled here (no GAS)
        if (isRoomAct(data.act)) {
          const text = roomDetailByKey(data.act);

          // Special branch: ROOM_RENT_IMG → send 3 images
          if (data.act === 'ROOM_RENT_IMG') {
            const out = [
              { type:'text', text: text || '[ราคา + ภาพ]' },

              {
                type: 'image',
                originalContentUrl: 'https://drive.google.com/uc?export=view&id=1JhPEZkaGXMrpW3csld5UfzTkKpRXBiht',
                previewImageUrl:   'https://drive.google.com/uc?export=view&id=1JhPEZkaGXMrpW3csld5UfzTkKpRXBiht'
              },
              {
                type: 'image',
                originalContentUrl: 'https://drive.google.com/uc?export=view&id=1tc4ru8gKYB22W3nmw72lgKi1u17V6S5r',
                previewImageUrl:   'https://drive.google.com/uc?export=view&id=1tc4ru8gKYB22W3nmw72lgKi1u17V6S5r'
              },
              {
                type: 'image',
                originalContentUrl: 'https://drive.google.com/uc?export=view&id=1_Ic_e61aOaOdrcTtl9pJQoJSF1C8ch5o',
                previewImageUrl:   'https://drive.google.com/uc?export=view&id=1_Ic_e61aOaOdrcTtl9pJQoJSF1C8ch5o'
              },
            ];

            ctx.waitUntil(
              lineReply(env.LINE_ACCESS_TOKEN, replyToken, out)
                .catch(console.error)
            );
            continue;
          }

          // Default branch → other ROOM_* keys
          ctx.waitUntil(
            lineReply(env.LINE_ACCESS_TOKEN, replyToken, [{ type: 'text', text }])
              .catch(console.error)
            );
          continue;
        }
        if (isFixAct(data.act)) {
          const text = fixDetailByKey(data.act);
          ctx.waitUntil(lineReply(env.LINE_ACCESS_TOKEN, replyToken, [{ type: 'text', text }]).catch(console.error));
          continue;
        }

        if (isResAct(data.act)) {
          const messages = resDetailByKey(data.act);
          if (messages && messages.length) {
            ctx.waitUntil(lineReply(env.LINE_ACCESS_TOKEN, replyToken, messages).catch(console.error));
          }
          continue;
        }

const stateKey = getStateKey(ev);
// Pay Rent postbacks → forward to PAYRENT GAS (no quick ack)
// Pay Rent postbacks → instant push from Worker, then forward to PAYRENT GAS
if (
  data.scope === 'payrent' ||
  ['pick_month', 'quick_month', 'upload', 'status', 'faq', 'howto'].includes(data.act)
) {
  const chatId = getChatId(ev);
  const rentUrl = getPayRentGas(env);

  // 1) show a quick "please wait" (PUSH so we don't consume replyToken)
  try {
    await linePushText(env.LINE_ACCESS_TOKEN, chatId, 'โปรดรอสักครู่…');
  } catch (e) {
    console.error('push wait msg failed', e);
  }

  // 2) optional: start LINE loading right away
  try {
    await lineStartLoading(env.LINE_ACCESS_TOKEN, chatId, 6);
  } catch (e) {
    console.warn('lineStartLoading failed', e);
  }

  // 3) forward the original postback to PAYRENT GAS (await for snappiest UX)
  await forwardToSpecificGas(env, rentUrl, { events: [ev] });

  continue;
}



        // Heavy postbacks → quick ack then forward
        ctx.waitUntil(lineReply(env.LINE_ACCESS_TOKEN, replyToken, [
          { type: 'text', text: 'กำลังตรวจสอบ…' }
        ]).catch(console.error));
        ctx.waitUntil(forwardToGas(env, { events: [ev] }));
        continue;
      }

      
      
      /* -----------------------
       * MESSAGE HANDLER
       * --------------------- */
      if (ev.type === 'message') {
        const m = ev.message || {};
        const chatId = getChatId(ev);

        // Dedicated expense group catch-all
        if (env.EXPENSE_GROUP_ID && chatId === env.EXPENSE_GROUP_ID) {
          const expensePayload = {
            source: 'expense_group',
            intent: 'record_expense',
            type: m.type,
            text: m.type === 'text' ? (m.text || '') : '',
            imageMessageId: m.type === 'image' ? m.id : null,
            userId: ev?.source?.userId || null,
            groupId: chatId,
            timestamp: new Date().toISOString()
          };

          if (env.N8N_EXPENSE_WEBHOOK_URL) {
            ctx.waitUntil(
              notifyN8nExpense(env, expensePayload).catch(console.error)
            );
          } else {
            console.warn('EXPENSE_GROUP_ID set but N8N_EXPENSE_WEBHOOK_URL is missing');
          }

          if (replyToken) {
            const icon = m.type === 'image' ? '📸' : '📝';
            await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [
              { type: 'text', text: `${icon} บันทึกแล้ว` }
            ]).catch(console.error);
          }

          continue;
        }

        // === TEXT ===
        if (m.type === 'text') {
        const textIn  = (m.text || '').trim();
        const chatId  = getChatId(ev);
        const stateKey= getStateKey(ev);
        const userId  = ev?.source?.userId || '';
        const changeLineKey = userId ? TENANT_CHANGE_KEY_PREFIX + userId : '';
        const changeLineState = userId ? await kvGet(env, changeLineKey) : null;
        const fridgeIntent = detectFridgeIntent(textIn);
        const parkingServiceKeyword = isParkingIntent(textIn);
        const checkinRoomCode = parseCheckinCommand(textIn);
        const isPaymentMenuBypass = /^\s*จ่ายเงินมามาแมนชั่น\s*$/i.test(textIn);
        const isPaymentMenu = isPaymentMenuBypass || /^\s*จ่ายเงินมามาแมนชั่น\s*$/i.test(textIn);
        const penaltyMatch = /^\s*(ชำระค่าปรับ|ชำระค่าอื่นๆ)\s*$/i.exec(textIn);
        const isPenaltyPayment = !!penaltyMatch;
        const penaltyType = penaltyMatch
          ? (penaltyMatch[1].includes('อื่น') ? 'Others_payment' : 'penalty')
          : null;
        const penaltyKey = stateKey + ':penalty_flow';
        const penaltyFlow = await kvGet(env, penaltyKey);
        const penaltyActive = !!(
          penaltyFlow &&
          penaltyFlow.ts &&
          (Date.now() - penaltyFlow.ts < PENALTY_FLOW_TTL_MS)
        );
        const penaltyReasonNeeded = penaltyActive && !penaltyFlow?.reason;
        const payRentKey = stateKey + ':payrent_flow';
        const payRentFlow = await kvGet(env, payRentKey);
        const payRentActive = !!(payRentFlow && payRentFlow.ts && (Date.now() - payRentFlow.ts < 15 * 60 * 1000));
        const keyRent = parseKeyRent(textIn);
        const keyForgot = parseKeyKeyword(textIn); // simple “key A101 20” legacy path
        const reservationWebhookUrl = getReservationGas(env);
        const isBookingCodeText = /^#?\s*MM\d{3,}$/i.test(textIn);

        const forwardPayRent = () => {
          const rentUrl = getPayRentGas(env);
          if (rentUrl) return forwardToSpecificGas(env, rentUrl, { events: [ev] });
          console.warn('pay rent text trigger: missing PAYRENT_GAS_URL, skipping forward');
          return;
        };

        const notifyTenantChange = (intent) => {
          const payload = {
            source: 'line_message',
            intent,
            text: textIn,
            userId: userId || null,
            chatId: chatId || null,
            state: changeLineState?.state || null,
            receivedAt: new Date().toISOString()
          };
          ctx.waitUntil(
            notifyN8nTenantIdChange(env, payload).catch((err) => console.error('tenant change notify failed', err))
          );
        };

        // Proxy booking code to reservation Apps Script for interactive button/logs (in addition to Worker flow)
        if (reservationWebhookUrl && isBookingCodeText) {
          ctx.waitUntil(forwardToSpecificGas(env, reservationWebhookUrl, { events: [ev] }));
        }

        if (keyRent) {
          if (keyRent.error === 'MISSING_ROOM') {
            const askRoomText = 'พิมพ์เช่น “เช่าชุดกุญแจ A101” หรือ “เช่าคีย์การ์ด A101”';
            if (replyToken) {
              await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [{ type: 'text', text: askRoomText }]).catch(console.error);
            } else if (chatId) {
              ctx.waitUntil(linePushText(env.LINE_ACCESS_TOKEN, chatId, askRoomText).catch(console.error));
            }
            continue;
          }

          const timestamp = new Date().toISOString();
          const keyPayload = {
            type: 'KEY_RENT',
            room: keyRent.room,
            items: keyRent.items,
            amount: keyRent.amount,
            rawText: keyRent.rawText,
            userId: userId || null,
            chatId: chatId || null,
            sourceType: ev?.source?.type || null,
            messageId: m?.id || null,
            receivedAt: timestamp
          };
          ctx.waitUntil(
            notifyN8nKeyWebhook(env, keyPayload).catch((err) => console.error('key webhook failed', err))
          );

          const itemSummary = keyRent.items
            .map((it) => `${it.assetType === 'KEYCARD' ? 'คีย์การ์ด' : 'กุญแจ'} x${it.qty}`)
            .join(', ');
          const ackText = `รับคำเช่า${keyRent.mode === 'SET' ? 'ชุดกุญแจ' : (keyRent.mode === 'KEYCARD' ? 'คีย์การ์ด' : 'กุญแจ')} ห้อง ${keyRent.room} แล้ว (${itemSummary})`;
          if (replyToken) {
            await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [{ type: 'text', text: ackText }]).catch(console.error);
          } else if (chatId) {
            ctx.waitUntil(linePushText(env.LINE_ACCESS_TOKEN, chatId, ackText).catch(console.error));
          }
          continue;
        }

        if (keyForgot) {
          const timestamp = new Date().toISOString();
          const payload = {
            ...keyForgot,
            text: textIn,
            userId: userId || null,
            chatId: chatId || null,
            sourceType: ev?.source?.type || null,
            messageId: m?.id || null,
            receivedAt: timestamp
          };
          ctx.waitUntil(
            notifyN8nKeyForgotWebhook(env, payload).catch((err) => console.error('key forgot webhook failed', err))
          );

          const ackText = `ส่งข้อมูลคีย์ตึก ${keyForgot.building} ห้อง ${keyForgot.room} จำนวน ${keyForgot.amount} ให้เจ้าหน้าที่แล้วค่ะ`;
          if (replyToken) {
            await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [{ type: 'text', text: ackText }]).catch(console.error);
          } else if (chatId) {
            ctx.waitUntil(linePushText(env.LINE_ACCESS_TOKEN, chatId, ackText).catch(console.error));
          }
          continue;
        }

        if (/^\s*เปลี่ยนไอดีผู้เช่า\s*$/i.test(textIn)) {
          if (userId) {
            await kvPut(env, changeLineKey, { state: WAIT_ROOM_STATE, ts: Date.now(), chatId, userId });
          }
          notifyTenantChange('tenant_id_change_request');
          await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [
            { type:'text', text:'ได้รับคำขอเปลี่ยนไอดีผู้เช่าแล้ว กำลังส่งเรื่องให้เจ้าหน้าที่ค่ะ' }
          ]).catch(console.error);
          continue;
        }


        // (A) Magic link (แจ้งออก) → forward to GAS to issue token + send link
        if (/^\s*(แจ้งออก)\s*$/i.test(textIn)) {
          // quick acknowledge so user sees immediate response
          await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [
            { type:'text', text:'กำลังสร้างลิงก์แจ้งออกให้คุณ… กรุณารอสักครู่' }
          ]).catch(console.error);

          // forward the original LINE event to GAS
          // (your GAS doPost will detect text === แจ้งออก and call _issueAndSendMoveOutMagicLink_)
          await forwardToGas(env, { events: [ev] });

          continue;
        }

          // (B) While inside move-out flow (รวม confirm)
          const handled = await moveoutTextGate(env, stateKey, textIn, replyToken);
          if (handled) continue;

          // Payment menu entry point (rich menu: จ่ายเงินมามาแมนชั่น) + override keyword จ่ายค่าเช่ามามาแมนชั่น
          if (isPaymentMenu || isPaymentMenuBypass) {
            const flex = buildPaymentOptionsFlex();
            if (replyToken) {
              await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [flex]).catch(console.error);
            } else if (chatId) {
              ctx.waitUntil(linePush(env.LINE_ACCESS_TOKEN, chatId, [flex]).catch(console.error));
            }
            continue;
          }

          // (C) Rent payment trigger
          if (/^\s*(ส่งสลิปค่าเช่า|ชำระค่าเช่า|จ่ายค่าเช่า|send\s*rent\s*slip|pay\s*rent)\s*$/i.test(textIn)) {
            if (chatId) {
              ctx.waitUntil(lineStartLoading(env.LINE_ACCESS_TOKEN, chatId, 7));
            }

            const notifyMsg = { type: 'text', text: 'กำลังเปิดขั้นตอนชำระค่าเช่าให้ค่ะ รอสักครู่…' };
            if (replyToken) {
              await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [notifyMsg]).catch(console.error);
            } else if (chatId) {
              ctx.waitUntil(linePushText(env.LINE_ACCESS_TOKEN, chatId, notifyMsg.text).catch(console.error));
            }

            ctx.waitUntil(kvDel(env, penaltyKey)); // switch to rent flow, clear penalty flag
            ctx.waitUntil(kvPut(env, payRentKey, { ts: Date.now(), chatId, userId }));
            ctx.waitUntil(forwardPayRent());
            continue;
          }

          // (C.2) Penalty payment trigger
          if (isPenaltyPayment) {
            if (chatId) {
              ctx.waitUntil(lineStartLoading(env.LINE_ACCESS_TOKEN, chatId, 7));
            }

            const typeLabel = penaltyType === 'Others_payment' ? 'ค่าอื่นๆ' : 'ค่าปรับ';
            const askReason = penaltyType === 'Others_payment'
              ? 'เป็นค่าอะไรคะ เช่น ค่าคีย์การ์ด, ค่าน้ำดื่ม, ค่าผ้า ฯลฯ'
              : 'ค่าปรับเรื่องอะไรคะ เช่น เสียงดัง, จอดรถ, สูบบุหรี่ ฯลฯ';
            if (replyToken) {
              await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [
                { type: 'text', text: askReason }
              ]).catch(console.error);
            } else if (chatId) {
              ctx.waitUntil(linePushText(env.LINE_ACCESS_TOKEN, chatId, askReason).catch(console.error));
            }

            ctx.waitUntil(kvDel(env, payRentKey)); // switch to penalty flow, clear rent flag
            ctx.waitUntil(
              kvPut(
                env,
                penaltyKey,
                {
                  ts: Date.now(),
                  chatId,
                  userId,
                  type: penaltyType || 'penalty',
                  reason: null
                },
                PENALTY_FLOW_TTL_SECONDS
              )
            );
            continue;
          }

          if (payRentActive && !isPaymentMenuBypass) {
            const reminder = 'โปรดส่งสลิปได้เลยค่ะ';
            if (replyToken) {
              await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [
                { type: 'text', text: reminder }
              ]).catch(console.error);
            } else if (chatId) {
              ctx.waitUntil(linePushText(env.LINE_ACCESS_TOKEN, chatId, reminder).catch(console.error));
            }
            ctx.waitUntil(kvPut(env, payRentKey, { ...payRentFlow, ts: Date.now(), chatId, userId }));
            continue;
          }

          if (penaltyActive && !penaltyMatch && !isPaymentMenuBypass && !penaltyReasonNeeded) {
            const reminder = 'โปรดส่งสลิปได้เลยค่ะ';
            if (replyToken) {
              await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [
                { type: 'text', text: reminder }
              ]).catch(console.error);
            } else if (chatId) {
              ctx.waitUntil(linePushText(env.LINE_ACCESS_TOKEN, chatId, reminder).catch(console.error));
            }
            ctx.waitUntil(kvPut(env, penaltyKey, { ...penaltyFlow, ts: Date.now(), chatId, userId }, PENALTY_FLOW_TTL_SECONDS));
            continue;
          }

          if (penaltyReasonNeeded) {
            const reason = (textIn || '').trim();
            if (!reason) {
              const askAgain = (penaltyFlow?.type || '') === 'Others_payment'
                ? 'โปรดระบุว่าเป็นค่าอะไร เช่น ค่าคีย์การ์ด, ค่าน้ำดื่ม ฯลฯ'
                : 'โปรดระบุว่าค่าปรับเรื่องอะไร เช่น เสียงดัง, จอดรถ, สูบบุหรี่ ฯลฯ';
              if (replyToken) {
                await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [
                  { type: 'text', text: askAgain }
                ]).catch(console.error);
              } else if (chatId) {
                ctx.waitUntil(linePushText(env.LINE_ACCESS_TOKEN, chatId, askAgain).catch(console.error));
              }
              ctx.waitUntil(kvPut(env, penaltyKey, { ...penaltyFlow, ts: Date.now() }, PENALTY_FLOW_TTL_SECONDS));
              continue;
            }

            const updated = {
              ...penaltyFlow,
              reason,
              ts: Date.now(),
              chatId,
              userId
            };
            ctx.waitUntil(kvPut(env, penaltyKey, updated, PENALTY_FLOW_TTL_SECONDS));

            const typeLabel = (penaltyFlow?.type || '') === 'Others_payment' ? 'ค่าอื่นๆ' : 'ค่าปรับ';
            const askSlip = `บันทึก${typeLabel}แล้ว โปรดส่งสลิปได้เลยค่ะ`;
            if (replyToken) {
              await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [
                { type: 'text', text: askSlip }
              ]).catch(console.error);
            } else if (chatId) {
              ctx.waitUntil(linePushText(env.LINE_ACCESS_TOKEN, chatId, askSlip).catch(console.error));
            }
            continue;
          }

          // (C.1) Fridge service button → link to n8n automation
          if (fridgeIntent.matches) {
            if (fridgeIntent.isCancel && !fridgeIntent.isAdd) {
              const cancelAck = 'ได้รับคำขอยกเลิกตู้เย็นแล้ว เจ้าหน้าที่จะแจ้งกลับโดยเร็วที่สุดนะคะ';
              if (replyToken) {
                await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [
                  { type: 'text', text: cancelAck }
                ]).catch(console.error);
              } else if (chatId) {
                ctx.waitUntil(linePushText(env.LINE_ACCESS_TOKEN, chatId, cancelAck).catch(console.error));
              }

              ctx.waitUntil(
                pushFridgeCancelNotification(env, ev, textIn)
                  .catch((err) => console.error('fridge cancel notify failed', err))
              );
              continue;
            }
            const replies = [
              fridgeInfoReply(env, {
                includeN8nButton: true,
                lineUserId: ev?.source?.userId || null,
                chatId: getChatId(ev) || null
              })
            ];
            await lineReply(env.LINE_ACCESS_TOKEN, replyToken, replies).catch(console.error);
            continue;
          }

          if (parkingServiceKeyword) {
            const commonOptions = {
              lineUserId: ev?.source?.userId || null,
              chatId: getChatId(ev) || null
            };
            const replies = [
              parkingButtonsMessage(buildParkingPostbackPayload(commonOptions))
            ];
            await lineReply(env.LINE_ACCESS_TOKEN, replyToken, replies).catch(console.error);
            continue;
          }

          if (checkinRoomCode) {
            const payload = {
              source: 'line_message',
              intent: 'checkin_start',
              channel: 'checkin',
              event: ev,
              text: textIn,
              roomId: checkinRoomCode,
              lineUserId: userId || null,
              chatId,
              receivedAt: new Date().toISOString()
            };

            ctx.waitUntil(
              notifyN8nCheckinFlow(env, payload).catch((err) => console.error('checkin notify failed', err))
            );

            if (hasKV(env)) {
              const checkinFlowKey = buildCheckinFlowKey(userId, chatId);
              const checkinFlowState = {
                roomId: checkinRoomCode,
                chatId,
                lineUserId: userId || null,
                ts: Date.now()
              };
              const ttl = CHECKIN_FLOW_TTL_SECONDS;
              try {
                await env.KV.put(checkinFlowKey, JSON.stringify(checkinFlowState), { expirationTtl: ttl });
              } catch (err) {
                console.error('checkin flow kv put failed', err);
              }
            }

            const ackMsg = `รับทราบแล้วค่ะ กำลังแจ้งเจ้าหน้าที่ให้ดำเนินงานเช็คอินห้อง ${checkinRoomCode} ต่อทันที กรุณาส่งสลิป/หลักฐานภายใน 30 นาที`;
            if (replyToken) {
              await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [
                { type: 'text', text: ackMsg }
              ]).catch(console.error);
            } else if (chatId) {
              ctx.waitUntil(linePushText(env.LINE_ACCESS_TOKEN, chatId, ackMsg).catch(console.error));
            }
            continue;
          }

          const checkoutRoomId = parseCheckoutTrigger(textIn);
          if (checkoutRoomId) {
            const handled = await handleCheckoutStart(env, {
              roomId: checkoutRoomId,
              text: textIn,
              event: ev,
              replyToken
            });
            if (handled) continue;
          }

          if (changeLineState?.state === WAIT_ROOM_STATE) {
            notifyTenantChange('tenant_id_change_room');
            await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [
              { type:'text', text:'รับรหัสห้องแล้วค่ะ เจ้าหน้าที่แจ้งกลับให้เร็วที่สุด' }
            ]).catch(console.error);
            continue;
          }

          if (OWNER_APPROVAL_KEYWORD_RE.test(textIn)) {
            const intent = textIn.trim().startsWith('ไม่') ? 'tenant_id_change_reject' : 'tenant_id_change_approve';
            notifyTenantChange(intent);
            await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [
              { type:'text', text:'ส่งสถานะไปยังเจ้าหน้าที่เรียบร้อยแล้วค่ะ' }
            ]).catch(console.error);
            continue;
          }

          if (/เปลี่ยนไอดีผู้เช่า/i.test(textIn)) {
            const payload = {
              source: 'line_message',
              intent: 'tenant_id_change',
              text: textIn,
              userId: ev?.source?.userId || null,
              chatId: getChatId(ev) || null,
              receivedAt: new Date().toISOString()
            };
            ctx.waitUntil(
              notifyN8nTenantIdChange(env, payload).catch((err) => console.error('tenant id change notify failed', err))
            );
            await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [
              { type: 'text', text: 'ได้รับคำขอเปลี่ยนไอดีผู้เช่าแล้วค่ะ เจ้าหน้าที่จะติดต่อกลับโดยเร็วที่สุด' }
            ]).catch(console.error);
            continue;
          }

          // (D) Quick keyword replies
          const fast = quickKeywordReply(textIn, env);
          if (fast) {
            ctx.waitUntil(lineReply(env.LINE_ACCESS_TOKEN, replyToken, fast).catch(console.error));
            continue;
          }

          if (isCheckinChangeIntent(textIn)) {
            const notifyMsg = 'กำลังส่งปุ่มเลือกวัน–เวลาเช็คอินให้ค่ะ รอสักครู่…';
            if (replyToken) {
              await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [
                { type: 'text', text: notifyMsg }
              ]).catch(console.error);
            } else if (chatId) {
              ctx.waitUntil(linePushText(env.LINE_ACCESS_TOKEN, chatId, notifyMsg).catch(console.error));
            }
            // Forward the original event so GAS can run the regular check-in picker flow
            const reservationUrl = getReservationGas(env);
            if (reservationUrl) {
              ctx.waitUntil(forwardToSpecificGas(env, reservationUrl, { events: [ev] }));
            } else {
              ctx.waitUntil(forwardToGas(env, { events: [ev] }));
            }
            continue;
          }

          // (E) Label → act mapping
          const mappedAct =
            ROOM_LABEL_MAP[textIn] ? ROOM_LABEL_MAP[textIn] :
            FIX_LABEL_MAP[textIn]  ? FIX_LABEL_MAP[textIn]  :
            null;


          const bookingFlowKey = buildBookingFlowKey(ev?.source?.userId, chatId);
          const bookingFlow = await kvGet(env, bookingFlowKey);

          // (E1) Booking flow confirmations (yes/no)
          const yesNoQuickReply = {
            quickReply: {
              items: [
                { type: 'action', action: { type: 'message', label: 'ใช่', text: 'ใช่' } },
                { type: 'action', action: { type: 'message', label: 'ไม่ใช่', text: 'ไม่ใช่' } }
              ]
            }
          };

          if (bookingFlow && bookingFlow.phase === 'confirm_slip') {
            const normalized = textIn.trim().toLowerCase();
            const isYes = /^y(es)?$/.test(normalized) || /^ใช่/.test(normalized);
            const isNo = /^no?$/.test(normalized) || /^ไม่/.test(normalized) || /^ไม่ใช่/.test(normalized);
            const codeHint = bookingFlow.code || '#MMxxx';

            if (!isYes && !isNo) {
              const prompt = `ยืนยันสลิปสำหรับ ${codeHint} ใช่ไหมคะ? ตอบ "ใช่" หรือ "ไม่ใช่"`;
              if (replyToken) {
                await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [{ type: 'text', text: prompt, ...yesNoQuickReply }]).catch(console.error);
              } else if (chatId) {
                ctx.waitUntil(linePush(env.LINE_ACCESS_TOKEN, chatId, [{ type: 'text', text: prompt, ...yesNoQuickReply }]).catch(console.error));
              }
              continue;
            }

            if (isYes) {
              let ok = false;
              let uploadError = '';
              try {
                const resp = await reservationAdminCallWithAuthGuard(env, 'reservation_slip_yes', {
                  reservation_id: String(codeHint).replace(/^#/, '')
                });
                ok = !!resp?.ok;
                if (!ok) uploadError = JSON.stringify(resp?.data || resp || {});
              } catch (err) {
                uploadError = String(err);
              }

              if (!ok) {
                console.log('reservation slip confirm failed', { code: codeHint, error: uploadError || '(empty)' });
                const msg = 'ยืนยันสลิปไม่สำเร็จ โปรดลองอีกครั้งหรือแจ้งเจ้าหน้าที่ค่ะ';
                await errorReplyOrPush(env, replyToken, chatId, msg);
                continue;
              }

              const expiresAt = Date.now() + BOOKING_ID_TTL_MS;
              const nextFlow = { phase: 'await_id', code: codeHint, ts: Date.now(), expiresAt };
              ctx.waitUntil(kvPut(env, bookingFlowKey, nextFlow, BOOKING_ID_TTL_SECONDS));

              const expireText = formatTimeBangkok(new Date(expiresAt));
              const msg = [
                `ยืนยันสลิป ${codeHint} แล้ว`,
                `โปรดส่งรูปบัตรภายใน 6 ชม. (หมดอายุ ${expireText})`
              ].join('\n');
              if (replyToken) {
                await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [{ type: 'text', text: msg }]).catch(console.error);
              } else if (chatId) {
                ctx.waitUntil(linePushText(env.LINE_ACCESS_TOKEN, chatId, msg).catch(console.error));
              }
              continue;
            }

            // isNo
            try {
              await reservationAdminCallWithAuthGuard(env, 'reservation_slip_no', {
                reservation_id: String(codeHint).replace(/^#/, '')
              });
            } catch (err) {
              console.log('reservation slip deny failed', { code: codeHint, error: String(err) });
            }

            const expiresAt = Date.now() + BOOKING_SLIP_TTL_MS;
            const nextFlow = { phase: 'await_slip', code: codeHint, ts: Date.now(), expiresAt };
            ctx.waitUntil(kvPut(env, bookingFlowKey, nextFlow, BOOKING_SLIP_TTL_SECONDS));

            const expireText = formatTimeBangkok(new Date(expiresAt));
            const msg = [
              `ยกเลิกสลิปเดิมสำหรับ ${codeHint} แล้ว`,
              `โปรดส่งสลิปใหม่ภายใน 60 นาที (หมดอายุ ${expireText})`
            ].join('\n');
            if (replyToken) {
              await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [{ type: 'text', text: msg }]).catch(console.error);
            } else if (chatId) {
              ctx.waitUntil(linePushText(env.LINE_ACCESS_TOKEN, chatId, msg).catch(console.error));
            }
            continue;
          }

          if (bookingFlow && bookingFlow.phase === 'confirm_id') {
            const normalized = textIn.trim().toLowerCase();
            const isYes = /^y(es)?$/.test(normalized) || /^ใช่/.test(normalized);
            const isNo = /^no?$/.test(normalized) || /^ไม่/.test(normalized) || /^ไม่ใช่/.test(normalized);
            const codeHint = bookingFlow.code || '#MMxxx';

            if (!isYes && !isNo) {
              const prompt = `ยืนยันไฟล์บัตรสำหรับ ${codeHint} ใช่ไหมคะ? ตอบ "ใช่" หรือ "ไม่ใช่"`;
              if (replyToken) {
                await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [{ type: 'text', text: prompt, ...yesNoQuickReply }]).catch(console.error);
              } else if (chatId) {
                ctx.waitUntil(linePush(env.LINE_ACCESS_TOKEN, chatId, [{ type: 'text', text: prompt, ...yesNoQuickReply }]).catch(console.error));
              }
              continue;
            }

            if (isYes) {
              let ok = false;
              let uploadError = '';
              try {
                const resp = await reservationAdminCallWithAuthGuard(env, 'reservation_id_yes', {
                  reservation_id: String(codeHint).replace(/^#/, '')
                });
                ok = !!resp?.ok;
                if (!ok) uploadError = JSON.stringify(resp?.data || resp || {});
              } catch (err) {
                uploadError = String(err);
              }

              if (!ok) {
                console.log('reservation id confirm failed', { code: codeHint, error: uploadError || '(empty)' });
                const msg = 'ยืนยันไฟล์บัตรไม่สำเร็จ โปรดลองอีกครั้งหรือแจ้งเจ้าหน้าที่ค่ะ';
                await errorReplyOrPush(env, replyToken, chatId, msg);
                continue;
              }

              ctx.waitUntil(kvDel(env, bookingFlowKey));
              const msg = `ยืนยันไฟล์บัตรสำหรับ ${codeHint} แล้ว กำลังตรวจสอบค่ะ`;
              if (replyToken) {
                await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [{ type: 'text', text: msg }]).catch(console.error);
              } else if (chatId) {
                ctx.waitUntil(linePushText(env.LINE_ACCESS_TOKEN, chatId, msg).catch(console.error));
              }
              continue;
            }

            // isNo
            try {
              await reservationAdminCallWithAuthGuard(env, 'reservation_id_no', {
                reservation_id: String(codeHint).replace(/^#/, '')
              });
            } catch (err) {
              console.log('reservation id deny failed', { code: codeHint, error: String(err) });
            }

            const expiresAt = Date.now() + BOOKING_ID_TTL_MS;
            const nextFlow = { phase: 'await_id', code: codeHint, ts: Date.now(), expiresAt };
            ctx.waitUntil(kvPut(env, bookingFlowKey, nextFlow, BOOKING_ID_TTL_SECONDS));

            const expireText = formatTimeBangkok(new Date(expiresAt));
            const msg = [
              `ยกเลิกไฟล์บัตรเดิมสำหรับ ${codeHint} แล้ว`,
              `โปรดส่งรูปบัตรใหม่ภายใน 6 ชม. (หมดอายุ ${expireText})`
            ].join('\n');
            if (replyToken) {
              await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [{ type: 'text', text: msg }]).catch(console.error);
            } else if (chatId) {
              ctx.waitUntil(linePushText(env.LINE_ACCESS_TOKEN, chatId, msg).catch(console.error));
            }
            continue;
          }

          // (F) Booking code → ack + forward
          if (/^#?\s*MM\d{3,}$/i.test(textIn)) {
            const bookingCode = extractBookingCode(textIn);
            const expiresAt = Date.now() + BOOKING_SLIP_TTL_MS;
            const flow = {
              phase: 'await_slip',
              code: bookingCode,
              ts: Date.now(),
              expiresAt
            };
            ctx.waitUntil(kvPut(env, bookingFlowKey, flow, BOOKING_SLIP_TTL_SECONDS));

            const debounceText = '⏳ กำลังตรวจสอบรหัสจอง…';
            if (replyToken) {
              await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [{ type: 'text', text: debounceText }]).catch(console.error);
            } else if (chatId) {
              ctx.waitUntil(linePushText(env.LINE_ACCESS_TOKEN, chatId, debounceText).catch(console.error));
            }

            // Try to fetch reservation details and send a confirm button with name + room
            ctx.waitUntil((async () => {
              try {
                const codeRaw = bookingCode.replace(/^#/, '');
                const resv = await reservationAdminCallWithAuthGuard(env, 'reservation_get_admin', {
                  reservation_id: codeRaw
                });
                if (resv?.ok && resv.data) {
                  const roomId = resv.data.roomId || '-';
                  const name = resv.data.customerName || resv.data.customer_name || '-';
                  const button = {
                    type: 'template',
                    altText: 'ยืนยันข้อมูลการจอง',
                    template: {
                      type: 'buttons',
                      text: [
                        `รหัส: #${codeRaw}`,
                        `ห้อง: ${roomId}`,
                        `ชื่อ: ${name}`
                      ].join('\n'),
                      actions: [
                        { type: 'postback', label: 'ยืนยัน', data: `act=confirm&code=${codeRaw}` }
                      ]
                    }
                  };
                  if (chatId) {
                    await linePush(env.LINE_ACCESS_TOKEN, chatId, [button]).catch(console.error);
                  } else if (replyToken) {
                    await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [button]).catch(console.error);
                  }
                }
              } catch (err) {
                console.warn('reservation_get_admin for button failed', err);
              }
            })());

            let ackSent = false;
            let ackError = '';
            try {
              const resp = await reservationAdminCallWithAuthGuard(env, 'reservation_ack', {
                reservation_id: bookingCode.replace(/^#/, ''),
                line_user_id: userId || undefined
              });
              if (resp?.ok && resp?.data) {
                const payText = resp.data.payText || [
                  `รับรหัสจอง ${bookingCode} แล้ว`,
                  `โปรดส่งสลิปภายใน 60 นาที (หมดอายุ ${expireText})`
                ].join('\n');
                const msgs: any[] = [{ type: 'text', text: payText }];
                if (resp.data.qrImageUrl) {
                  msgs.push({
                    type: 'image',
                    originalContentUrl: resp.data.qrImageUrl,
                    previewImageUrl: resp.data.qrImageUrl
                  });
                }
                // Send follow-up with QR/pay text (we already sent instant ack)
                if (chatId) {
                  ctx.waitUntil(linePush(env.LINE_ACCESS_TOKEN, chatId, msgs).catch(console.error));
                } else if (replyToken) {
                  await lineReply(env.LINE_ACCESS_TOKEN, replyToken, msgs).catch(console.error);
                }
                ackSent = true;
              } else {
                ackError = JSON.stringify(resp?.data || resp || {});
              }
            } catch (err) {
              ackError = String(err);
            }

            if (!ackSent) {
              if (ackError) {
                console.warn('reservation_ack failed', {
                  code: bookingCode,
                  error: ackError,
                  userId,
                  chatId,
                  resvUrl: getReservationGas(env),
                  hasAdminKey: !!getReservationAdminKey(env)
                });
              }
            }

            // Bind Line ID to reservation (new backend) and set to pending payment window
            const adminKey = getReservationAdminKey(env);
            const resvUrl = getReservationGas(env);
            if (adminKey && resvUrl && userId) {
              ctx.waitUntil(
                reservationAdminCallWithAuthGuard(env, 'reservation_bind_line', {
                  reservation_id: bookingCode.replace(/^#/, ''),
                  line_user_id: userId
                }).catch((err) => console.error('reservation_bind_line failed', err))
              );
            }
            continue;
          }

          // (G) Looks like room → only if flow exists
          const looksLikeRoom = /^[A-Z]?\d{3,4}$/i.test(textIn);
          if (looksLikeRoom) {
            const key  = stateKey + ':moveout_flow';
            const flow = await kvGet(env, key);
            if (flow && flow.step) {
              const h = await moveoutTextGate(env, stateKey, textIn, replyToken);
              if (h) continue;
            }
          }

          // (H) Forward everything else to GAS
          ctx.waitUntil(forwardToGas(env, { events: [ev] }));
          continue;
        }

        // === IMAGE ===
        if (m.type === 'image') {
          const chatId = getChatId(ev);
          // Optional quick ack
          ctx.waitUntil(lineReply(env.LINE_ACCESS_TOKEN, replyToken, [
            { type: 'text', text: 'รับไฟล์แล้ว กำลังตรวจสอบ…' }
          ]).catch(console.error));

          const autoImgUrl = getAutoImgGas(env);
          if (autoImgUrl) {
            ctx.waitUntil(forwardToSpecificGas(env, autoImgUrl, { events: [ev] }));
          }

          const stateKey = getStateKey(ev);
          const penaltyKey = stateKey + ':penalty_flow';
          const penaltyFlow = await kvGet(env, penaltyKey);
          const penaltyActive = !!(
            penaltyFlow &&
            penaltyFlow.ts &&
            (Date.now() - penaltyFlow.ts < PENALTY_FLOW_TTL_MS)
          );
          const penaltyReasonNeeded = penaltyActive && !penaltyFlow?.reason;
          const checkinFlowKey = buildCheckinFlowKey(ev?.source?.userId, chatId);
          const checkinFlowState = await kvGet(env, checkinFlowKey);
          console.log('checkinFlowState', { key: checkinFlowKey, state: checkinFlowState });
          const checkinActive = !!(
            checkinFlowState &&
            checkinFlowState.ts &&
            (Date.now() - checkinFlowState.ts < CHECKIN_FLOW_TTL_MS)
          );

          if (checkinActive) {
            const slipPayload = {
              source: 'line_message',
              intent: 'checkin_slip',
              channel: 'checkin',
              event: ev,
              roomId: checkinFlowState.roomId,
              lineUserId: ev?.source?.userId || null,
              chatId,
              imageMessageId: ev?.message?.id || null,
              receivedAt: new Date().toISOString()
            };

            ctx.waitUntil(
              notifyN8nCheckinFlow(env, slipPayload).catch((err) => console.error('checkin slip notify failed', err))
            );

            ctx.waitUntil(kvDel(env, checkinFlowKey));

            const slipAck = `ได้รับสลิปเช็คอินห้อง ${checkinFlowState.roomId} แล้ว กำลังส่งทีมงานตรวจสอบสรุปผลให้เร็วที่สุด`;
            if (replyToken) {
              await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [
                { type: 'text', text: slipAck }
              ]).catch(console.error);
            } else if (chatId) {
              ctx.waitUntil(linePushText(env.LINE_ACCESS_TOKEN, chatId, slipAck).catch(console.error));
            }

            continue;
          }

          if (penaltyActive) {
            if (penaltyReasonNeeded) {
              const askReason = (penaltyFlow?.type || '') === 'Others_payment'
                ? 'โปรดระบุว่าเป็นค่าอะไร เช่น ค่าคีย์การ์ด, ค่าน้ำดื่ม ฯลฯ'
                : 'โปรดระบุว่าค่าปรับเรื่องอะไร เช่น เสียงดัง, จอดรถ, สูบบุหรี่ ฯลฯ';
              if (replyToken) {
                await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [
                  { type: 'text', text: askReason }
                ]).catch(console.error);
              } else if (chatId) {
                ctx.waitUntil(linePushText(env.LINE_ACCESS_TOKEN, chatId, askReason).catch(console.error));
              }
              ctx.waitUntil(kvPut(env, penaltyKey, { ...penaltyFlow, ts: Date.now() }, PENALTY_FLOW_TTL_SECONDS));
              continue;
            }

            const typeLabel = (penaltyFlow?.type || '') === 'Others_payment' ? 'ค่าอื่นๆ' : 'ค่าปรับ';
            const slipPayload = {
              source: 'line_message',
              intent: 'penalty_payment_slip',
              channel: 'penalty',
              event: ev,
              lineUserId: ev?.source?.userId || null,
              chatId,
              imageMessageId: ev?.message?.id || null,
              type: penaltyFlow?.type || 'penalty',
              reason: penaltyFlow?.reason || '',
              receivedAt: new Date().toISOString()
            };

            let ok = false;
            try {
              ok = await Penalty_webhook(env, slipPayload);
            } catch (err) {
              console.error('Penalty_webhook failed', err);
            }

            if (ok) {
              ctx.waitUntil(kvDel(env, penaltyKey));
            }

            const slipAck = ok
              ? `รับสลิปชำระ${typeLabel}แล้ว กำลังส่งต่อให้เจ้าหน้าที่ตรวจสอบค่ะ`
              : `ส่งสลิปชำระ${typeLabel}ไม่สำเร็จ กรุณาลองส่งอีกครั้งค่ะ`;

            if (replyToken) {
              await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [
                { type: 'text', text: slipAck }
              ]).catch(console.error);
            } else if (chatId) {
              ctx.waitUntil(linePushText(env.LINE_ACCESS_TOKEN, chatId, slipAck).catch(console.error));
            }

            if (!ok) {
              ctx.waitUntil(kvPut(env, penaltyKey, { ...penaltyFlow, ts: Date.now() }, PENALTY_FLOW_TTL_SECONDS));
            }
            continue;
          }

          const payRentFlow = await kvGet(env, stateKey + ':payrent_flow');
          const payRentActive = !!(
            payRentFlow &&
            payRentFlow.ts &&
            (Date.now() - payRentFlow.ts < 15 * 60 * 1000)
          ); // 15 min window

          if (payRentActive) {
            if (m.type === 'image') {
              // When slip arrives, forward to n8n payrent with context
              const rentUrl = getN8nPayRentUrl(env) || getPayRentGas(env);
              if (rentUrl) {
                const payload = {
                  events: [ev],
                  roomId: payRentFlow?.roomId || payRentFlow?.room || payRentFlow?.roomHint || 'UNKNOWN',
                  userId: ev?.source?.userId || '',
                  chatId
                };
                ctx.waitUntil(forwardToSpecificGas(env, rentUrl, payload));
              } else {
                console.warn('payrent image: missing both N8N_PAYRENT_URL and PAYRENT_GAS_URL');
              }
              ctx.waitUntil(kvDel(env, stateKey + ':payrent_flow'));
            } else {
              const reminder = 'โปรดส่งสลิปได้เลยค่ะ';
              if (replyToken) {
                await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [{ type: 'text', text: reminder }]).catch(console.error);
              } else if (chatId) {
                ctx.waitUntil(linePushText(env.LINE_ACCESS_TOKEN, chatId, reminder).catch(console.error));
              }
              ctx.waitUntil(kvPut(env, payRentKey, { ...payRentFlow, ts: Date.now(), chatId, userId }));
            }
            continue;
          }

          // Booking flow gates (slip -> ID)
          const bookingFlowKey = buildBookingFlowKey(ev?.source?.userId, chatId);
          const bookingFlow = await kvGet(env, bookingFlowKey);
          const reservationWebhookUrl = getReservationGas(env);

          if (bookingFlow && bookingFlow.phase) {
            const phase = bookingFlow.phase || 'await_slip';
            const age = Date.now() - (bookingFlow.ts || 0);
            const ttlMs = (phase === 'await_id' || phase === 'confirm_id') ? BOOKING_ID_TTL_MS : BOOKING_SLIP_TTL_MS;
            const expired = age > ttlMs;

            // Mirror slip/ID events to reservation GAS for logging/legacy flows
            if (reservationWebhookUrl) {
              ctx.waitUntil(forwardToSpecificGas(env, reservationWebhookUrl, { events: [ev] }));
            }

            const bookingCode = bookingFlow.code || '#MMxxx';
            const codeHint = bookingCode.toUpperCase();
            const retryText = 'หมดเวลาส่งไฟล์แล้ว โปรดติดต่อเจ้าหน้าที่เพื่อดำเนินการต่อ';

            if (expired) {
              ctx.waitUntil(kvDel(env, bookingFlowKey));
              const message = phase === 'await_id'
                ? 'หมดเวลาส่งบัตรแล้ว โปรดติดต่อเจ้าหน้าที่เพื่อดำเนินการต่อ'
                : retryText;
              if (replyToken) {
                await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [{ type: 'text', text: message }]).catch(console.error);
              } else if (chatId) {
                ctx.waitUntil(linePushText(env.LINE_ACCESS_TOKEN, chatId, message).catch(console.error));
              }
              continue;
            }

            if (phase === 'await_slip' || phase === 'confirm_slip') {
              let handled = false;
              let uploadError = '';
              try {
                const dataUrl = await fetchLineImageAsDataUrl(env.LINE_ACCESS_TOKEN, m.id);
                const resId = bookingCode.replace(/^#/, '');
                const upload = await reservationAdminCallWithAuthGuard(env, 'reservation_upload_slip', {
                  reservation_id: resId,
                  dataUrl
                });
                if (upload?.ok) {
                  handled = true;
                  const expiresAt = Date.now() + BOOKING_SLIP_TTL_MS;
                  const nextFlow = { phase: 'confirm_slip', code: bookingCode, ts: Date.now(), expiresAt };
                  ctx.waitUntil(kvPut(env, bookingFlowKey, nextFlow, BOOKING_SLIP_TTL_SECONDS));

                  const expireText = formatTimeBangkok(new Date(expiresAt));
                  const previewLine = upload?.data?.previewUrl ? `ตัวอย่าง: ${upload.data.previewUrl}` : null;
                  const msg = [
                    `รับไฟล์สลิปสำหรับ ${bookingCode} แล้ว`,
                    `ยืนยันว่าเป็นสลิปนี้หรือไม่? (หมดอายุ ${expireText})`,
                    previewLine,
                    `ตอบ "ใช่" หรือ "ไม่ใช่" หากต้องการเปลี่ยนไฟล์ ส่งสลิปใหม่แล้วตอบอีกครั้ง`
                  ].filter(Boolean).join('\n');

                  const confirmMsg = {
                    type: 'text',
                    text: msg,
                    quickReply: {
                      items: [
                        { type: 'action', action: { type: 'message', label: 'ใช่', text: 'ใช่' } },
                        { type: 'action', action: { type: 'message', label: 'ไม่ใช่', text: 'ไม่ใช่' } }
                      ]
                    }
                  };

                  if (chatId) {
                    ctx.waitUntil(linePush(env.LINE_ACCESS_TOKEN, chatId, [confirmMsg]).catch(console.error));
                  } else if (replyToken) {
                    await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [confirmMsg]).catch(console.error);
                  }
                } else {
                  uploadError = JSON.stringify(upload?.data || {});
                }
              } catch (err) {
                uploadError = String(err);
                console.error('reservation slip upload failed', err);
              }

              if (!handled) {
                const isAuth = uploadError.includes('unauthorized') || uploadError.includes('reservation_admin_unauthorized');
                const isNotFound = uploadError.includes('not_found');
                const msg = isAuth
                  ? 'ไม่สามารถบันทึกสลิปได้ (สิทธิ์ไม่ผ่าน) แจ้งเจ้าหน้าที่ตั้งค่า WORKER_SECRET ให้ตรงกันแล้วลองอีกครั้งค่ะ'
                  : isNotFound
                  ? `ไม่พบรหัสนี้ในระบบ (#${bookingCode.replace(/^#/, '')}) โปรดตรวจสอบรหัสหรือแจ้งเจ้าหน้าที่`
                  : 'รับไฟล์ไม่สำเร็จ โปรดลองส่งสลิปอีกครั้ง หรือแจ้งเจ้าหน้าที่ช่วยตรวจสอบค่ะ';
                console.log('reservation slip failed', { code: bookingCode, error: uploadError || '(empty)' });
                await errorReplyOrPush(env, replyToken, chatId, msg);
                continue;
              }

              const expiresAt = Date.now() + BOOKING_ID_TTL_MS;
              const nextFlow = { phase: 'await_id', code: bookingCode, ts: Date.now(), expiresAt };
              ctx.waitUntil(kvPut(env, bookingFlowKey, nextFlow, BOOKING_ID_TTL_SECONDS));

              const expireText = formatTimeBangkok(new Date(expiresAt));
              const msg = [
                `รับสลิปจอง ${bookingCode} แล้ว`,
                `โปรดส่งรูปบัตรภายใน 6 ชม. (หมดอายุ ${expireText})`,
                `หากสลิปไม่ถูกต้อง ส่งสลิปใหม่ได้ทันทีแล้วพิมพ์รหัสอีกครั้ง`
              ].join('\n');
              if (chatId) {
                ctx.waitUntil(linePushText(env.LINE_ACCESS_TOKEN, chatId, msg).catch(console.error));
              } else if (replyToken) {
                await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [{ type: 'text', text: msg }]).catch(console.error);
              }
              continue;
            }

            if (phase === 'await_id' || phase === 'confirm_id') {
              let handled = false;
              let uploadError = '';
              try {
                const dataUrl = await fetchLineImageAsDataUrl(env.LINE_ACCESS_TOKEN, m.id);
                const resId = bookingCode.replace(/^#/, '');
                const upload = await reservationAdminCallWithAuthGuard(env, 'reservation_upload_id', {
                  reservation_id: resId,
                  dataUrl
                });
                if (upload?.ok) {
                  handled = true;
                  const expiresAt = Date.now() + BOOKING_ID_TTL_MS;
                  const nextFlow = { phase: 'confirm_id', code: bookingCode, ts: Date.now(), expiresAt };
                  ctx.waitUntil(kvPut(env, bookingFlowKey, nextFlow, BOOKING_ID_TTL_SECONDS));

                  const expireText = formatTimeBangkok(new Date(expiresAt));
                  const previewLine = upload?.data?.previewUrl ? `ตัวอย่าง: ${upload.data.previewUrl}` : null;
                  const msg = [
                    `รับไฟล์บัตรสำหรับ ${codeHint} แล้ว`,
                    `ยืนยันว่าเป็นไฟล์นี้หรือไม่? (หมดอายุ ${expireText})`,
                    previewLine,
                    `ตอบ "ใช่" หรือ "ไม่ใช่" หากต้องการเปลี่ยนไฟล์ ส่งบัตรใหม่แล้วตอบอีกครั้ง`
                  ].filter(Boolean).join('\n');

                  const confirmMsg = {
                    type: 'text',
                    text: msg,
                    quickReply: {
                      items: [
                        { type: 'action', action: { type: 'message', label: 'ใช่', text: 'ใช่' } },
                        { type: 'action', action: { type: 'message', label: 'ไม่ใช่', text: 'ไม่ใช่' } }
                      ]
                    }
                  };

                  if (chatId) {
                    ctx.waitUntil(linePush(env.LINE_ACCESS_TOKEN, chatId, [confirmMsg]).catch(console.error));
                  } else if (replyToken) {
                    await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [confirmMsg]).catch(console.error);
                  }
                } else {
                  uploadError = JSON.stringify(upload?.data || {});
                }
              } catch (err) {
                uploadError = String(err);
                console.error('reservation id upload failed', err);
              }

              if (!handled) {
                const isAuth = uploadError.includes('unauthorized') || uploadError.includes('reservation_admin_unauthorized');
                const isNotFound = uploadError.includes('not_found');
                const msg = isAuth
                  ? 'ไม่สามารถบันทึกไฟล์บัตรได้ (สิทธิ์ไม่ผ่าน) แจ้งเจ้าหน้าที่ตั้งค่า WORKER_SECRET ให้ตรงกันแล้วลองอีกครั้งค่ะ'
                  : isNotFound
                  ? `ไม่พบรหัสนี้ในระบบ (#${bookingCode.replace(/^#/, '')}) โปรดตรวจสอบรหัสหรือแจ้งเจ้าหน้าที่`
                  : 'รับไฟล์บัตรไม่สำเร็จ โปรดลองส่งอีกครั้ง หรือแจ้งเจ้าหน้าที่ช่วยตรวจสอบค่ะ';
                console.log('reservation id failed', { code: bookingCode, error: uploadError || '(empty)' });
                await errorReplyOrPush(env, replyToken, chatId, msg);
                continue;
              }

              ctx.waitUntil(kvDel(env, bookingFlowKey));
              const msg = [
                `รับรูปบัตรสำหรับ ${codeHint} แล้ว กำลังตรวจสอบค่ะ`,
                `หากต้องการเปลี่ยนไฟล์ ส่งบัตรใหม่ได้ทันทีแล้วพิมพ์รหัสอีกครั้ง`
              ].join('\n');
              if (chatId) {
                ctx.waitUntil(linePushText(env.LINE_ACCESS_TOKEN, chatId, msg).catch(console.error));
              } else if (replyToken) {
                await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [{ type: 'text', text: msg }]).catch(console.error);
              }
              continue;
            }
          }

          // No booking flow active -> prompt user to resend code
          const noBookingMsg = 'ยังไม่พบรหัสจองสำหรับไฟล์นี้ โปรดพิมพ์รหัส เช่น #MM123 แล้วส่งสลิปอีกครั้ง';
          if (chatId) {
            ctx.waitUntil(linePushText(env.LINE_ACCESS_TOKEN, chatId, noBookingMsg).catch(console.error));
          } else if (replyToken) {
            await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [{ type: 'text', text: noBookingMsg }]).catch(console.error);
          }
          continue;

          // Not in any known flow
          const noFlowMsg = 'ตอนนี้ยังไม่ได้อยู่ในสเต็ปใดเลย ต้องการทำขั้นตอนใดครับ? หากเป็นการจองให้พิมพ์รหัส เช่น #MM123';
          if (replyToken) {
            await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [{ type: 'text', text: noFlowMsg }]).catch(console.error);
          } else if (chatId) {
            ctx.waitUntil(linePushText(env.LINE_ACCESS_TOKEN, chatId, noFlowMsg).catch(console.error));
          }
          continue;
        }

      }
    }

    return new Response('OK', { status: 200 });
  }
};

/* =======================================================
 * 5) Maps & Predicates
 * ===================================================== */
const ROOM_LABEL_MAP = {
  'ขนาด/เลย์เอาต์':'ROOM_SIZE','เฟอร์นิเจอร์':'ROOM_FURNITURE','เครื่องใช้ไฟฟ้า':'ROOM_APPLIANCE',
  'ค่าเช่า':'ROOM_RENT','ค่าน้ำ-ไฟ/เน็ต':'ROOM_UTIL','เงินประกัน/สัญญา':'ROOM_DEPOSIT',
  'ที่จอดรถ':'ROOM_PARKING','เข้าอยู่เร็วสุด':'ROOM_EARLIEST'
};
const FIX_LABEL_MAP = {
  'น้ำ/ท่อรั่ว':'FIX_WATER','ไฟ/ปลั๊ก/เบรกเกอร์':'FIX_ELECTRIC','แอร์ไม่เย็น/น้ำหยด':'FIX_AC',
  'ห้องน้ำ/สุขภัณฑ์':'FIX_BATH','ประตู/กุญแจ':'FIX_DOOR','เฟอร์นิเจอร์/อุปกรณ์':'FIX_FURN',
  'กลิ่น/เสียงรบกวน':'FIX_SMELL','อื่น ๆ':'FIX_OTHER'
};
function isRoomAct(a){ return typeof a==='string' && a.startsWith('ROOM_'); }
function isFixAct(a){ return typeof a==='string' && a.startsWith('FIX_'); }
function isResAct(a){ return typeof a==='string' && a.startsWith('RES_'); }

/* =========================================
 * 6) Message builders
 * ========================================= */
function roomDetailByKey(key){
  const map = {
    ROOM_SIZE:`[ขนาด/เลย์เอาต์]
• Standard: ~22 ตร.ม. ระเบียง
• Corner Plus: ~23 ตร.ม. หน้าต่างมุม + ระเบียง
• Starter: ~22 ตร.ม. ระเบียง`,
    ROOM_FURNITURE:`[เฟอร์นิเจอร์]
🛏️เตียง 5 ฟุต + ที่นอน
🚪ตู้เสื้อผ้า
🪑โต๊ะทำงาน + เก้าอี้
🪟ผ้าม่าน`,
    ROOM_APPLIANCE:`[เครื่องใช้ไฟฟ้า]
❄️แอร์, เครื่องทำน้ำอุ่น
ตู้เย็น 200 บาท/เดือน`,
    ROOM_RENT:`[ค่าเช่า]
• Standard (เฟอร์ครบ): 3,800–4,000 บ./ด.
• Corner Plus (เฟอร์ครบ): 4,100–4,300 บ./ด.
• Starter (ไม่มีเฟอร์): 3,500 บ./ด.`,
    ROOM_UTIL:`[ค่าน้ำ-ไฟ/เน็ต]
น้ำ 18 | ไฟ 8 
🛜เน็ต: ฟรี`,
    ROOM_RENT_IMG:`[เรทราคา + ภาพ]`,   // 👈 new entry
    ROOM_DEPOSIT:`[เงินประกัน/สัญญา]
สัญญาขั้นต่ำ 1 ปี
หากต้องการเช่า 6 เดือน เพิ่มค่าเช่า 200 บ./เดือน
(รายละเอียดเงินประกัน/ล่วงหน้า ระบุในวันทำสัญญา)`,
    ROOM_PARKING:`[ที่จอดรถ]
🚗มีหลังคา 800/เดือน
🚗ไม่มีหลังคา 500/เดือน
🏍️มอเตอร์ไซต์ฟรี (มีหลังคา)`,
    ROOM_EARLIEST:`[เข้าอยู่เร็วสุด]
    ตึก A พร้อมเข้าอยู่ 1 พ.ย. 
    ตึก B พร้อมเข้าอยู่ 1 ธ.ค. 

(เช็กห้องว่างได้ที่ “วิธีจอง”)`
  };
  return map[key] || 'เลือกรายละเอียดหัวข้อจาก Quick Reply ได้ค่ะ';
}
function fixDetailByKey(key){
  const map = {
    FIX_WATER:'[น้ำ/ท่อรั่ว]\nปิดวาล์วน้ำชั่วคราว (ถ้าเข้าถึงได้) และถ่ายรูปจุดรั่ว แจ้งเลขห้อง+เวลาสะดวก ทีมช่างจะนัดเข้าซ่อมครับ/ค่ะ',
    FIX_ELECTRIC:'[ไฟฟ้า/ระบบไฟ]\nปลั๊กหรือไฟดับ? แจ้งเลขห้องพร้อมอธิบายอาการครับ/ค่ะ',
    FIX_OTHER:'[อื่น ๆ]\nเพิ่มเติมรายละเอียดให้เรา เพื่อจัดการได้เร็วขึ้น'
  };
  return map[key] || 'เลือกหัวข้อจาก Quick Reply ได้เลยครับ/ค่ะ';
}

function resDetailByKey(key){
  if (key === 'RES_COMMUTE_AIRPORT') {
    const airportText = [
      '✈️ วิธีเดินทางไปสนามบินสุวรรณภูมิ (ไม่มีรถส่วนตัว)',
      '',
      'ขั้นตอนที่ 1: หอพัก ➜ แยกสุขสมาน',
      '• เดินออกไปที่ป้ายรถเมล์ ถนนฉลองกรุง',
      '• ขึ้นรถสองแถวสีแดง (ตลาดหัวตะเข้/ลาดกระบัง) หรือรถเมล์เล็กสาย 1013',
      '• บอกลงที่ “แยกสุขสมาน”',
      '• เวลาให้บริการ ~06:00–21:40 น. ความถี่ 10–25 นาที',
      '',
      'ขั้นตอนที่ 2: แยกสุขสมาน ➜ สนามบิน',
      'ตัวเลือก A (แนะนำ): รถตู้/มินิบัส 549 — เข้าถึงอาคารผู้โดยสารโดยตรง (~12–15 บาท)',
      'ตัวเลือก B: รถเมล์ S4 (549) — ลงศูนย์ขนส่งสาธารณะ ต่อ Shuttle Bus ฟรี',
      'ตัวเลือก C: รถเวียนสาย C (ฟรี) — ลงศูนย์ขนส่งสาธารณะ ต่อ Shuttle Bus ฟรี',
      '',
      '✨ สรุป: สองแถวแดง ➜ รถตู้/มินิบัส 549 คือวิธีที่รวดเร็วและสะดวกที่สุด'
    ].join('\n');
    return [{ type: 'text', text: airportText }];
  }

  if (key === 'RES_COMMUTE_KMITL') {
    const kmitlText = [
      '🏫 วิธีเดินทางไป KMITL (≈5.6 กม.)',
      '',
      '• มอเตอร์ไซค์รับจ้าง ~15 นาที (ขึ้นคิวหน้าหอหรือปากซอย)',
      '• รถสองแถวสีแดงเส้นลาดกระบัง — ลงหน้ามหาวิทยาลัย',
      '• รถเมล์สาย 552 (ปรับอากาศ) ขึ้นริมถนนฉลองกรุง',
      '',
      'Tip: ช่วงเร่งด่วนควรเผื่อเวลาเล็กน้อยก่อนเข้าเรียน'
    ].join('\n');
    return [{ type: 'text', text: kmitlText }];
  }

  if (key === 'RES_CONTACT_BIKE') {
    const motoText = [
      '🛵 เบอร์พี่วินมอเตอร์ไซค์ (หน้าปากซอย) สะดวก รวดเร็ว โทรเรียกเข้ามารับที่ตึกได้เลยครับ',
      '',
      '📞 รายชื่อพี่วินประจำจุด',
      'เบอร์ 18 : 086-113-2734',
      'เบอร์ 1 : 061-608-2523',
      'เบอร์ 24 : 094-419-8652',
      'เบอร์ 38 : 098-636-7991',
      'เบอร์ 3 : 063-520-6658',
      'เบอร์ 10 : 083-908-1127',
      'เบอร์ 34 : 080-063-9128',
      '',
      '💡 ข้อแนะนำ:',
      'แจ้งว่า "มารับที่ Mama Mansion"',
      'สอบถามราคาก่อนใช้บริการนะครับ',
      'กลางคืนดึก ๆ อาจจะมีรถน้อยกว่าปกตินะครับ',
      '🏠 ด้วยความห่วงใยจาก Mama Mansion'
    ].join('\n');
    return [{ type: 'text', text: motoText }];
  }

  return null;
}

/* =========================================
 * 7) LINE helpers (missing utilities)
 * ========================================= */
async function lineReply(channelToken, replyToken, messages) {
  if (!channelToken || !replyToken) {
    throw new Error('lineReply: missing token or replyToken');
  }

  const res = await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${channelToken}`,
    },
    body: JSON.stringify({ replyToken, messages })
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LINE reply failed ${res.status} ${res.statusText}: ${body}`);
  }
}

function createReplyToLine(env) {
  return async function replyToLine(replyToken, messages) {
    if (!replyToken) return;
    if (!env.LINE_ACCESS_TOKEN) {
      throw new Error('replyToLine: missing LINE_ACCESS_TOKEN');
    }
    return lineReply(env.LINE_ACCESS_TOKEN, replyToken, messages);
  };
}

function errorReplyOrPush(env, replyToken, chatId, text) {
  if (chatId) {
    return linePushText(env.LINE_ACCESS_TOKEN, chatId, text).catch(console.error);
  }
  if (replyToken) {
    return lineReply(env.LINE_ACCESS_TOKEN, replyToken, [{ type: 'text', text }]).catch(console.error);
  }
  return Promise.resolve();
}

async function notifyN8nRenewalPostback(env, payload) {
  const url = env.N8N_RENEWAL_POSTBACK_URL || '';
  if (!url) {
    console.warn('notifyN8nRenewalPostback: missing webhook URL');
    return false;
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      console.error('notifyN8nRenewalPostback non-200', res.status, text.slice(0, 200));
    }
    return res.ok;
  } catch (err) {
    console.error('notifyN8nRenewalPostback error', err);
    return false;
  }
}

async function verifySig(bodyText, signature, channelSecret) {
  if (!channelSecret || !signature) return false;

  const encoder = new TextEncoder();
  const keyData = encoder.encode(channelSecret);
  const bodyData = encoder.encode(bodyText || '');

  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );

  let sigBytes;
  try {
    const binary = atob(signature);
    sigBytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  } catch (_) {
    return false;
  }

  const signatureBuffer = await crypto.subtle.sign('HMAC', key, bodyData);
  const expected = new Uint8Array(signatureBuffer);

  if (expected.length !== sigBytes.length) return false;

  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= expected[i] ^ sigBytes[i];
  }

  return diff === 0;
}

function parseKv(data) {
  const out = {};
  if (!data) return out;

  const parts = String(data).split('&');
  for (const part of parts) {
    if (!part) continue;
    const [rawKey, rawVal = ''] = part.split('=');
    const key = decodeURIComponent(rawKey || '').trim();
    const val = decodeURIComponent(rawVal || '').trim();
    if (!key) continue;
    if (Object.prototype.hasOwnProperty.call(out, key)) {
      const prev = out[key];
      out[key] = Array.isArray(prev) ? prev.concat(val) : [prev, val];
    } else {
      out[key] = val;
    }
  }
  return out;
}

function parsePostbackData(raw) {
  const input = (raw || '').trim();
  if (!input) return {};

  if (input.startsWith('{')) {
    try {
      const parsed = JSON.parse(input);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch (err) {
      console.warn('parsePostbackData JSON parse failed', err);
    }
  }

  try {
    const params = new URLSearchParams(input);
    const out = {};
    for (const [key, value] of params.entries()) {
      if (!key) continue;
      if (Object.prototype.hasOwnProperty.call(out, key)) {
        const prev = out[key];
        out[key] = Array.isArray(prev) ? prev.concat(value) : [prev, value];
      } else {
        out[key] = value;
      }
    }
    if (Object.keys(out).length > 0) {
      return out;
    }
  } catch (err) {
    console.warn('parsePostbackData URLSearchParams failed', err);
  }

  return parseKv(input);
}

async function moveoutTextGate(env, stateKey, textIn, replyToken) {
  // Fallback implementation: forward all handling to GAS by returning false.
  // Existing MOVEOUT flows handled in GAS will continue to work.
  return false;
}

function quickKeywordReply(text, env) {
  const normalized = (text || '').trim();
  if (!normalized) return null;

  const lower = normalized.toLowerCase();
  const includesAny = (haystack, keywords) => keywords.some((kw) => haystack.includes(kw));

  const wantsParkingInfo = normalized.includes('ที่จอดรถ');
  const isUrgent =
    URGENT_CONTACT_RE.test(normalized) ||
    (normalized.includes('ติดต่อ') && !normalized.includes('สอบถาม'));

  const mentionsWifi = /(wifi|wi[-\s]?fi|ไว[-\s]?ไฟ|ไวฟาย|วายฟาย|วายไฟ)/i.test(normalized);
  const wifiPassHint = /(password|pass|รหัส|รหัสผ่าน|พาสเวิร์ด|พาส)/i.test(normalized);
  const shortWifiAsk = mentionsWifi && normalized.length <= 20;

  if (mentionsWifi && (wifiPassHint || shortWifiAsk)) {
    const wifiText = [
      '🛜 WiFi หอพัก',
      'รหัส: 5021150660',
      'เชื่อมไม่ได้ให้ปิด/เปิด WiFi แล้วลองใหม่'
    ].join('\n');

    return [{ type: 'text', text: wifiText }];
  }
  if (wantsParkingInfo && !isUrgent) {
    return [
      { type: 'text', text: 'ที่จอดรถยนต์มีให้เช่าทั้งแบบไม่มีหลังคา 500 บ./เดือน และแบบมีหลังคา 800 บ./เดือน' },
      { type: 'text', text: 'พิมพ์ "ขอเช่าที่จอด" หรือกดปุ่มในเมนูเพื่อเลือกแบบที่ต้องการได้เลยครับ/ค่ะ' }
    ];
  }

  if (isUrgent) {
    return [
      {
        type: 'template',
        altText: 'เบอร์ที่ต้องการติดต่อ',
        template: {
          type: 'buttons',
          text: 'เลือกเจ้าหน้าที่ที่ต้องการติดต่อ',
          actions: [
            { type: 'uri', label: '📞 ผู้จัดการ (มา)', uri: 'tel:0827981676' },
            { type: 'uri', label: '📞 แม่บ้าน ตึก A (ก้อย)', uri: 'tel:0806490441' },
            { type: 'uri', label: '📞 แม่บ้าน ตึก B (พี่ยุ)', uri: 'tel:0837420760' },
            { type: 'postback', label: '📞 วินมอเตอร์ไซค์', data: 'act=RES_CONTACT_BIKE', displayText: 'เบอร์วินมอเตอร์ไซค์' }
          ]
        }
      },
      {
        type: 'text',
        text: 'อยากดูเบอร์วินมอเตอร์ไซค์ทั้งหมด กดปุ่มลัดด้านล่างได้เลยค่ะ',
        quickReply: {
          items: [
            {
              type: 'action',
              action: {
                type: 'postback',
                label: 'เบอร์วินมอเตอร์ไซค์',
                data: 'act=RES_CONTACT_BIKE',
                displayText: 'เบอร์วินมอเตอร์ไซค์'
              }
            }
          ]
        }
      }
    ];
  }

  const isAvailabilityExcluded =
    AVAILABILITY_EXCLUDE_KEYWORDS.some((kw) => normalized.includes(kw)) ||
    AVAILABILITY_EXCLUDE_REGEXES.some((re) => re.test(normalized) || re.test(lower));
  const isAvailabilityAsk = AVAILABILITY_REGEXES.some((re) => re.test(normalized));
  if (isAvailabilityAsk && !isAvailabilityExcluded) {
    const today = formatDateBangkok();
    const bookingUrl = String((env?.BOOKING_URL || '').trim() || 'https://mamamansion-ar2.pages.dev/');
    return [
      { type: 'text', text: `อัปเดตวันที่ ${today}` },
      { type: 'text', text: `สถานะ ณ ตอนนี้เหลือห้องตึกละไม่เกิน 2-3 ห้อง โปรดลองหาห้องตามชั้นในเว็บไซต์ได้เลยครับ\n${bookingUrl}` }
    ];
  }

  const utilityReplyQuickActions = {
    items: [
      {
        type: 'action',
        action: {
          type: 'postback',
          label: 'ค่าเช่า',
          data: 'act=ROOM_RENT',
          displayText: 'ค่าเช่า'
        }
      },
      {
        type: 'action',
        action: {
          type: 'postback',
          label: 'ภาพ + เรทราคา',
          data: 'act=ROOM_RENT_IMG',
          displayText: 'ภาพ + เรทราคา'
        }
      }
    ]
  };

  const contactQuickReply = {
    items: [
      {
        type: 'action',
        action: {
          type: 'postback',
          label: 'เบอร์พี่วินหน้าปากซอย',
          data: 'act=RES_CONTACT_BIKE',
          displayText: 'เบอร์พี่วิน'
        }
      }
    ]
  };

  const contactMenu = [
    {
      type: 'text',
      text: [
        '📞 ช่องทางติดต่อหลัก',
        '• แม่บ้าน (พี่ก้อย) 080-649-0441 ตึก A',
        '• แม่บ้าน (พี่ยุ) 083-742-0760 ตึก B',
        '• ผู้จัดการ (มา) 082-798-1676'
      ].join('\n'),
      quickReply: contactQuickReply
    }
  ];

  const maidContact = [
    {
      type: 'text',
      text: 'แม่บ้าน (พี่ก้อย) 080-649-0441 ตึก A\nแม่บ้าน (พี่ยุ) 083-742-0760 ตึก B\nผู้จัดการ (มา) 082-798-1676\nโทรได้ทุกวัน 08:00-20:00 น.',
    }
  ];

  if (isUtilityInquiry(normalized)) {
    const utilityText = roomDetailByKey('ROOM_UTIL');
    const textMessage = {
      type: 'text',
      text: utilityText || '[ค่าน้ำ-ไฟ/เน็ต]\nน้ำ 18 | ไฟ 8\n🛜เน็ต: ฟรี',
      quickReply: utilityReplyQuickActions
    };
    return [textMessage];
  }

  if (normalized.includes('โปรโมชั่น') || includesAny(lower, ['promotion', 'promo', 'promotions', 'discount', 'special offer'])) {
    return [
      {
        type: 'text',
        text: 'ขอบคุณสำหรับความสนใจนะครับ'
      }
    ];
  }

  const contactTriggers = ['เบอร์ติดต่อ', 'เบอร์โทร', 'ช่องทางติดต่อ', 'ติดต่อ', 'contact', 'phone'];
  if (includesAny(lower, contactTriggers) || (normalized.includes('เบอร์') && normalized.includes('ติดต่อ'))) {
    return contactMenu;
  }

  const addressRegex = /(ขอ)?ที่อยู่|ส่ง(ของ|พัสดุ)|จัดส่ง|ส่งมาที่|ส่งหา|shipping|address|deliver|delivery|ส่งไปรษณีย์/i;
  if (addressRegex.test(normalized) || addressRegex.test(lower)) {
    const templateAddress = [
      'มามา แมนชั่น ตึก A/B ห้อง A000',
      '45 ซอยฉลองกรุง 37 แขวงลำปลาทิว เขตลาดกระบัง กรุงเทพฯ 10520'
    ].join('\n');

    return [
      { type: 'text', text: templateAddress },
      { type: 'text', text: 'โปรดระบุเลขตึกและเลขห้องจริงของคุณทุกครั้ง เพื่อให้พัสดุส่งถึงอย่างถูกต้องนะคะ' }
    ];
  }

  if (normalized.includes('รายละเอียด') || includesAny(lower, ['room detail', 'room details', 'details', 'detail'])) {
    const quickItems = [
      { label: 'ขนาด/เลย์เอาต์', act: 'ROOM_SIZE' },
      { label: 'เฟอร์นิเจอร์', act: 'ROOM_FURNITURE' },
      { label: 'เครื่องใช้ไฟฟ้า', act: 'ROOM_APPLIANCE' },
      { label: 'ค่าเช่า', act: 'ROOM_RENT' },
      { label: 'ค่าน้ำ-ไฟ/เน็ต', act: 'ROOM_UTIL' },
      { label: 'เงินประกัน/สัญญา', act: 'ROOM_DEPOSIT' },
      { label: 'ที่จอดรถ', act: 'ROOM_PARKING' },
      { label: 'เข้าอยู่เร็วสุด', act: 'ROOM_EARLIEST' },
      { label: 'ภาพ + เรทราคา', act: 'ROOM_RENT_IMG' }
    ]
      .filter(Boolean)
      .map(({ label, act }) => ({
        type: 'action',
        action: {
          type: 'postback',
          label,
          data: `act=${act}`,
          displayText: label
        }
      }));

    return [
      {
        type: 'text',
        text: 'เลือกหัวข้อรายละเอียดห้องที่อยากดูได้เลยค่ะ 👇',
        quickReply: { items: quickItems }
      }
    ];
  }

  const locationThaiTriggers = ['ที่ตั้ง', 'แผนที่', 'อยู่แถว', 'อยู่ตรงไหน', 'อยู่ไหน', 'แถวไหน', 'ซอยไหน', 'พิกัด', 'ไปยังไง', 'ไปยังไหน', 'เดินทางยังไง', 'เดินทางไป', 'ทางไป'];
  const locationEnglishTriggers = ['location', 'map', 'where is', 'how to get', 'how do i get', 'how to go'];
  const locationRegex = /(ไป|เดินทาง).*(ยังไง|อย่างไร|ทางไหน)/i;
  if (includesAny(normalized, locationThaiTriggers) || includesAny(lower, locationEnglishTriggers) || locationRegex.test(normalized)) {
    const mapUrl = String((env?.MAPS_URL || '').trim() || 'https://maps.app.goo.gl/Qktm2mDGPappQ8EZA');
    const mapMessage = [
      '📍 ตำแหน่ง Mama Mansion',
      mapUrl
    ].join('\n');

    return [
      { type: 'text', text: mapMessage },
      {
        type: 'text',
        text: 'เลือกดูวิธีเดินทางได้เลยค่ะ',
        quickReply: {
          items: [
            {
              type: 'action',
              action: {
                type: 'postback',
                label: 'ไป KMITL',
                data: 'act=RES_COMMUTE_KMITL',
                displayText: 'วิธีเดินทางไป KMITL'
              }
            },
            {
              type: 'action',
              action: {
                type: 'postback',
                label: 'ไปสนามบินสุวรรณภูมิ',
                data: 'act=RES_COMMUTE_AIRPORT',
                displayText: 'วิธีเดินทางไปสนามบินสุวรรณภูมิ'
              }
            }
          ]
        }
      }
    ];
  }

  const bookingRegex = /จอง.*(ยังไง|อย่างไร|ทำไง|ทำอย่างไร)/i;
  const bookingInterest = normalized.includes('สนใจจอง') || (normalized.includes('สนใจ') && normalized.includes('จอง'));
  if (normalized.includes('วิธีจอง') || normalized.includes('อยากจอง') || bookingInterest || includesAny(lower, ['book', 'booking']) || bookingRegex.test(normalized)) {
    const bookingStepsText = [
      '[📅 วิธีจองห้องพัก]',
      '',
      '1) เข้า “ระบบจอง” ที่ลิงก์นี้: https://mamamansion-ar2.pages.dev/',
      '2) กรอกข้อมูล เลือกห้องและวันที่เข้าอยู่ แล้วส่งฟอร์ม',
      '3) ระบบออกเลขรหัส #MMxxx',
      '4) พิมพ์รหัส #MMxxx ในแชทนี้',
      '5) ชำระค่าจองและรอยืนยันจากเจ้าหน้าที่',
      '6) ⚠️ หลังจองในเว็บไซต์ ต้องยืนยันและชำระค่าจองทาง LINE นี้ภายใน 2 ชั่วโมง มิฉะนั้นระบบจะยกเลิกอัตโนมัติ'
    ].join('\n');

    const defaultBookingImageUrls = [
      'https://drive.google.com/uc?export=view&id=146RJw9oS4fr1gEMiqrePMTwS-bXZYcZJ',
      'https://drive.google.com/uc?export=view&id=1Y6KUvNmw0wkBoSCldHNA38sBvrDniuR3'
    ];

    const bookingImages = defaultBookingImageUrls
      .map((fallbackUrl, idx) => {
        const override = idx === 0 ? env?.HOWTO_IMAGE_URL_1 : env?.HOWTO_IMAGE_URL_2;
        const url = String((override || '').trim() || fallbackUrl);
        if (!url) return null;
        return {
          type: 'image',
          originalContentUrl: url,
          previewImageUrl: url
        };
      })
      .filter(Boolean);

    return [
      { type: 'text', text: bookingStepsText },
      ...bookingImages
    ];
  }

  if (normalized.includes('แม่บ้าน') || lower.includes('maid')) {
    return maidContact;
  }

  return null;
}

function fridgeInfoReply(env, options = {}) {
  const fridgeWebhook = getN8nFridgeWebhook(env);
  if (options.includeN8nButton && fridgeWebhook) {
    return fridgeButtonMessage(buildFridgePostbackPayload(options));
  }

  console.warn('fridgeInfoReply: missing fridge webhook or button disabled');
  return { type: 'text', text: 'มีข้อผิดพลาด กรุณาติดต่อเจ้าหน้าที่' };
}

function buildFridgePostbackPayload(options = {}) {
  return {
    act: 'fridge_rent_request',
    lineUserId: options.lineUserId || null,
    roomHint: options.roomHint || null,
    chatId: options.chatId || null
  };
}

function fridgeButtonMessage(postbackData) {
  let dataString = '{}';
  try {
    dataString = JSON.stringify(postbackData);
  } catch (err) {
    console.error('fridgeButtonMessage stringify error', err);
  }

  return {
    type: 'template',
    altText: 'เช่าตู้เย็น',
    template: {
      type: 'buttons',
      text: 'มีให้เช่าเดือนละ 200 บาท',
      actions: [
        {
          type: 'postback',
          label: 'เช่าตู้เย็น',
          data: dataString,
          displayText: 'ขอเช่าตู้เย็น'
        }
      ]
    }
  };
}

function buildPaymentOptionsFlex() {
  const primaryColor = '#0F62FE';
  return {
    type: 'flex',
    altText: 'เลือกการชำระเงิน',
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'lg',
        contents: [
          { type: 'text', text: 'เลือกสิ่งที่ต้องการชำระ', weight: 'bold', size: 'lg' },
          {
            type: 'box',
            layout: 'vertical',
            spacing: 'md',
            contents: [
              {
                type: 'button',
                style: 'primary',
                color: primaryColor,
                action: { type: 'message', label: 'ชำระค่าเช่า', text: 'ชำระค่าเช่า' }
              },
              {
                type: 'button',
                style: 'primary',
                color: primaryColor,
                action: { type: 'message', label: 'ชำระค่าปรับ', text: 'ชำระค่าปรับ' }
              },
              {
                type: 'button',
                style: 'primary',
                color: primaryColor,
                action: { type: 'message', label: 'อื่นๆ', text: 'ชำระค่าอื่นๆ' }
              }
            ]
          }
        ]
      }
    },
    quickReply: {
      items: [
        {
          type: 'action',
          action: {
            type: 'message',
            label: 'วิธีการชำระเงิน',
            text: 'วิธีการชำระเงิน'
          }
        }
      ]
    }
  };
}

function buildParkingPostbackPayload(options = {}) {
  return {
    act: 'parking_rent_request',
    type: 'parking',
    plan: 'parking',
    lineUserId: options.lineUserId || null,
    chatId: options.chatId || null
  };
}

function parkingButtonsMessage(payloadRoofed) {
  let dataRoofed = '{}';

  try {
    dataRoofed = JSON.stringify(payloadRoofed);
  } catch (err) {
    console.error('parkingButtonsMessage stringify error', err);
  }

  return {
    type: 'template',
    altText: 'เช่าที่จอดรถ',
    template: {
      type: 'buttons',
      title: 'ที่จอดรถ',
      text: '800 บาท/เดือน ',
      actions: [
        {
          type: 'postback',
          label: 'เช่าเลย',
          data: dataRoofed,
          displayText: 'เช่าที่จอดรถ'
        }
      ]
    }
  };
}

function getN8nFridgeWebhook(env) {
  return env.N8N_FRIDGE_WEBHOOK_URL || '';
}

function getN8nParkingWebhook(env) {
  return env.N8N_PARKING_WEBHOOK_URL || '';
}

async function notifyN8nFridge(env, payload) {
  const url = getN8nFridgeWebhook(env);
  if (!url) {
    console.warn('notifyN8nFridge: missing webhook URL');
    return false;
  }

  const headers = { 'Content-Type': 'application/json' };
  const secret = env.WORKER_SECRET || '';
  if (secret) {
    headers['x-worker-secret'] = secret;
  } else {
    console.warn('notifyN8nFridge: missing WORKER_SECRET');
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      console.error('notifyN8nFridge: non-200 response', res.status);
    }
    return res.ok;
  } catch (err) {
    console.error('notifyN8nFridge error', err);
    return false;
  }
}

async function notifyN8nParking(env, payload) {
  const url = getN8nParkingWebhook(env);
  if (!url) {
    console.warn('notifyN8nParking: missing webhook URL');
    return false;
  }

  const headers = { 'Content-Type': 'application/json' };
  const secret = env.WORKER_SECRET || '';
  if (secret) {
    headers['x-worker-secret'] = secret;
  } else {
    console.warn('notifyN8nParking: missing WORKER_SECRET');
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      console.error('notifyN8nParking: non-200 response', res.status);
    }
    return res.ok;
  } catch (err) {
    console.error('notifyN8nParking error', err);
    return false;
  }
}

function getN8nTenantIdChangeWebhook(env) {
  return env.N8N_TENANT_ID_CHANGE_URL || env.N8N_POSTBACK_URL || '';
}

async function notifyN8nTenantIdChange(env, payload) {
  const url = getN8nTenantIdChangeWebhook(env);
  if (!url) {
    console.warn('notifyN8nTenantIdChange: missing webhook URL');
    return false;
  }

  const headers = { 'Content-Type': 'application/json' };
  const secret = env.WORKER_SECRET || '';
  if (secret) {
    headers['x-worker-secret'] = secret;
  } else {
    console.warn('notifyN8nTenantIdChange: missing WORKER_SECRET');
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      console.error('notifyN8nTenantIdChange: non-200 response', res.status);
    }
    return res.ok;
  } catch (err) {
    console.error('notifyN8nTenantIdChange error', err);
    return false;
  }
}

function getN8nCheckinFlowWebhook(env) {
  return env.N8N_CHECKIN_FLOW_URL || env.N8N_CHECKINFLOW_URL || '';
}

async function notifyN8nCheckinFlow(env, payload) {
  const url = getN8nCheckinFlowWebhook(env);
  if (!url) {
    console.warn('notifyN8nCheckinFlow: missing webhook URL');
    return false;
  }

  const headers = { 'Content-Type': 'application/json' };
  const secret = env.WORKER_SECRET || '';
  if (secret) {
    headers['x-worker-secret'] = secret;
  } else {
    console.warn('notifyN8nCheckinFlow: missing WORKER_SECRET');
  }

  try {
    const body = JSON.stringify(payload);
    console.log('notifyN8nCheckinFlow send', {
      url,
      intent: payload?.intent || '',
      roomId: payload?.roomId || '',
      hasEvent: !!payload?.event,
      hasImage: !!payload?.imageMessageId
    });
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      console.error('notifyN8nCheckinFlow: non-200 response', res.status, text.slice(0, 200));
    } else {
      console.log('notifyN8nCheckinFlow ok', { status: res.status, text: text.slice(0, 200) });
    }
    return res.ok;
  } catch (err) {
    console.error('notifyN8nCheckinFlow error', err);
    return false;
  }
}

function getCheckoutWebhook(env) {
  return env.N8N_CHECKOUT_START_WEBHOOK || env.N8N_CHECKOUT_FLOW_URL || '';
}

async function notifyN8nCheckoutStart(env, payload) {
  const url = getCheckoutWebhook(env);
  if (!url) throw new Error('missing checkout webhook URL');

  const headers = { 'Content-Type': 'application/json', 'accept': 'application/json' };
  const secret = env.WORKER_SECRET || env.MM_WORKER_SECRET || '';
  if (secret) headers['x-mm-secret'] = secret;

  console.log('checkout_webhook_req', { url, roomId: payload?.roomId || '', hasSecret: !!secret });

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      redirect: 'manual',
      signal: AbortSignal.timeout(15000)
    });
  } catch (e) {
    console.log('checkout_webhook_error', {
      message: e?.message,
      name: e?.name,
      stack: e?.stack ? String(e.stack).slice(0, 300) : ''
    });
    throw e;
  }

  const text = await res.text().catch(() => '');
  console.log('checkout_webhook_res', {
    status: res.status,
    ok: res.ok,
    location: res.headers.get('location'),
    bodyPreview: text.slice(0, 300)
  });

  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) {
    // If n8n returns plain text (e.g., "Workflow was started"), wrap it
    data = text ? { message: text } : null;
  }

  // Accept 200 even if n8n returns only { message: "Workflow was started" }
  const success = res.ok && (
    (data && data.ok === true) ||
    (data && typeof data.message === 'string' && /workflow was started/i.test(data.message)) ||
    (data && (data.flowId || data.mainUrl))
  );

  if (!success) {
    throw new Error(`checkout webhook error ${res.status} ${text.slice(0, 200)}`);
  }

  return {
    flowId: data?.flowId || data?.id || '',
    mainUrl: data?.mainUrl || data?.url || '',
    dueAt: data?.dueAt || data?.due || '',
    raw: data
  };
}

async function handleCheckoutStart(env, opts) {
  const roomId = (opts?.roomId || '').toUpperCase();
  const text = opts?.text || '';
  const ev = opts?.event || {};
  const replyToken = opts?.replyToken || '';
  const userId = ev?.source?.userId || '';
  const ts = ev?.timestamp || Date.now();
  const chatId = getChatId(ev);
  const targetChatId = chatId || getChatId(ev) || '';

  console.log('checkout_trigger', { roomId, text: text.slice(0, 80), userId });

  // Immediate ack to user to avoid silence while waiting for n8n
  if (replyToken) {
    const ack = `กำลังเริ่มขั้นตอนเช็คเอ้าท์ ห้อง ${roomId} โปรดรอสักครู่…`;
    try {
      await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [{ type:'text', text: ack }]);
    } catch (e) {
      console.error('checkout_ack_fail', e);
      if (targetChatId) {
        try { await linePushText(env.LINE_ACCESS_TOKEN, targetChatId, ack); } catch (e2) { console.error('checkout_ack_push_fail', e2); }
      }
    }
  } else if (chatId) {
    try { await linePushText(env.LINE_ACCESS_TOKEN, chatId, `กำลังเริ่มขั้นตอนเช็คเอ้าท์ ห้อง ${roomId} โปรดรอสักครู่…`); }
    catch (e3) { console.error('checkout_ack_push_fail', e3); }
  }

  try {
    const payload = {
      source: 'LINE_TEXT',
      roomId,
      lineUserId: userId,
      text,
      timestamp: ts
    };
    const res = await notifyN8nCheckoutStart(env, payload);
    console.log('checkout_n8n_ok', { roomId, flowId: res?.flowId || '', mainUrl: res?.mainUrl ? 'yes' : 'no' });

    const lines = [
      `✅ เริ่มทำรายการเช็คเอ้าท์ ห้อง ${roomId} แล้ว`,
      res?.dueAt ? `กำหนดตรวจ/ปิดงานภายใน: ${res.dueAt}` : '',
      res?.mainUrl ? `ลิงก์ติดตาม: ${res.mainUrl}` : ''
    ].filter(Boolean);

    const finalText = lines.join('\n');
    if (targetChatId) {
      await linePushText(env.LINE_ACCESS_TOKEN, targetChatId, finalText).catch(err => console.error('checkout_final_push_fail', err));
    } else if (replyToken) {
      await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [{ type:'text', text: finalText }]).catch(err => console.error('checkout_final_reply_fail', err));
    }
  } catch (err) {
    const errMsg = String(err && err.message ? err.message : err);
    console.error('checkout_start_failed', { roomId, err: errMsg });
    const failText = `ระบบมีปัญหา กรุณาลองใหม่ (checkout: ${errMsg.slice(0,80)})`;
    if (targetChatId) {
      await linePushText(env.LINE_ACCESS_TOKEN, targetChatId, failText).catch(console.error);
    } else if (replyToken) {
      await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [{ type:'text', text: failText }]).catch(console.error);
    }
  }

  return true;
}

async function notifyN8nKeyWebhook(env, payload) {
  const url = env.N8N_RENT_KEY_URL || '';
  if (!url) {
    console.warn('notifyN8nKeyWebhook: missing webhook URL');
    return false;
  }

  const headers = { 'Content-Type': 'application/json' };
  const secret = env.WORKER_SECRET || '';
  if (secret) {
    headers['x-worker-secret'] = secret;
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      console.error('notifyN8nKeyWebhook: non-200 response', res.status, text.slice(0, 200));
    }
    return res.ok;
  } catch (err) {
    console.error('notifyN8nKeyWebhook error', err);
    return false;
  }
}

async function notifyN8nKeyForgotWebhook(env, payload) {
  const url = env.N8N_KEY_FORGOT_WEBHOOK_URL || '';
  if (!url) {
    console.warn('notifyN8nKeyForgotWebhook: missing webhook URL');
    return false;
  }

  const headers = { 'Content-Type': 'application/json' };
  const secret = env.WORKER_SECRET || '';
  if (secret) {
    headers['x-worker-secret'] = secret;
  } else {
    console.warn('notifyN8nKeyForgotWebhook: missing WORKER_SECRET');
  }

  try {
    const body = JSON.stringify(payload);
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      console.error('notifyN8nKeyForgotWebhook: non-200 response', res.status, text.slice(0, 200));
    }
    return res.ok;
  } catch (err) {
    console.error('notifyN8nKeyForgotWebhook error', err);
    return false;
  }
}

function getPenaltyWebhook(env) {
  return env.PENALTY_WEBHOOK_URL || '';
}

async function Penalty_webhook(env, payload) {
  const url = getPenaltyWebhook(env);
  if (!url) {
    console.warn('Penalty_webhook: missing webhook URL');
    return false;
  }

  const headers = { 'Content-Type': 'application/json' };
  const secret = env.WORKER_SECRET || '';
  if (secret) {
    headers['x-worker-secret'] = secret;
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      console.error('Penalty_webhook: non-200 response', res.status, text.slice(0, 200));
    }
    return res.ok;
  } catch (err) {
    console.error('Penalty_webhook error', err);
    return false;
  }
}

async function notifyN8nExpense(env, payload) {
  const url = env.N8N_EXPENSE_WEBHOOK_URL || '';
  if (!url) {
    console.warn('notifyN8nExpense: missing webhook URL');
    return false;
  }

  const headers = { 'Content-Type': 'application/json' };
  const secret = env.WORKER_SECRET || '';
  if (secret) {
    headers['x-worker-secret'] = secret;
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      console.error('notifyN8nExpense: non-200 response', res.status, text.slice(0, 200));
    }
    return res.ok;
  } catch (err) {
    console.error('notifyN8nExpense error', err);
    return false;
  }
}

// @ts-nocheck

/* =========================
 * 0) Small utilities
 * ========================= */
function isIsoDate(str) { return /^\d{4}-\d{2}-\d{2}$/.test(str); } // YYYY-MM-DD
function getChatId(ev) { return ev?.source?.groupId || ev?.source?.roomId || ev?.source?.userId || ''; }
function getStateKey(ev) {
  const chat = getChatId(ev) || 'unknown';
  const uid = ev?.source?.userId || 'anon';
  return `${chat}:${uid}`;
}
const DEFAULT_OWNER_GROUP_IDS = [];
const DEFAULT_RENEWAL_ADMIN_GROUP_IDS = [
  'C07e625728aee936d59df1bca18bed149'
];

function getConfiguredGroupIds(rawValue, defaultIds = []) {
  const raw = String(rawValue || '').trim();
  const envIds = raw
    ? raw.split(',').map((id) => String(id || '').trim()).filter(Boolean)
    : [];
  return Array.from(new Set([...envIds, ...defaultIds]));
}

function getOwnerGroupIds(env) {
  return getConfiguredGroupIds(env?.OWNER_GROUP_ID, DEFAULT_OWNER_GROUP_IDS);
}

function isOwnerGroupChat(env, chatId) {
  if (!chatId) return false;
  return getOwnerGroupIds(env).includes(chatId);
}

function getRenewalAdminGroupIds(env) {
  return getConfiguredGroupIds(env?.RENEWAL_ADMIN_GROUP_ID, DEFAULT_RENEWAL_ADMIN_GROUP_IDS);
}

function isRenewalAdminGroupChat(env, chatId) {
  if (!chatId) return false;
  return getRenewalAdminGroupIds(env).includes(chatId);
}

function pushToOwnerGroups(env, messages) {
  const ownerGroupIds = getOwnerGroupIds(env);
  if (!ownerGroupIds.length) return Promise.resolve([]);
  return Promise.allSettled(ownerGroupIds.map((groupId) => linePush(env.LINE_ACCESS_TOKEN, groupId, messages)));
}

function pushTextToOwnerGroups(env, text) {
  const ownerGroupIds = getOwnerGroupIds(env);
  if (!ownerGroupIds.length) return Promise.resolve([]);
  return Promise.allSettled(ownerGroupIds.map((groupId) => linePushText(env.LINE_ACCESS_TOKEN, groupId, text)));
}

const ROOM_RENT_DRIVE_IMAGE_IDS = [
  '1j7ss_o3t4RpNLd12mV31T167WjC3m9Ca',
  '1Os-hVZgZ47l7AJwEpY8UKw7Jd9t624Cz',
  '1WLAPvEo9ZXnELZjQ8smVcOTNbTaw-WtN'
];

const ROOM_RENT_IMG_WIDTH_ORIGINAL = 1600;
const ROOM_RENT_IMG_WIDTH_PREVIEW = 640;
const LINE_IMAGE_MAX_ORIGINAL_BYTES = 10 * 1024 * 1024;
const LINE_IMAGE_MAX_PREVIEW_BYTES = 1 * 1024 * 1024;

function buildRoomRentImageMessages(origin) {
  return ROOM_RENT_DRIVE_IMAGE_IDS.map((_, idx) => {
    const originalUrl = `${origin}/media/room-rent/${idx + 1}?v=orig`;
    const previewUrl = `${origin}/media/room-rent/${idx + 1}?v=preview`;
    return {
      type: 'image',
      originalContentUrl: originalUrl,
      previewImageUrl: previewUrl
    };
  });
}

function resolveRoomRentVariant(url) {
  return String(url.searchParams.get('v') || '').toLowerCase() === 'preview' ? 'preview' : 'orig';
}

async function fetchGoogleDriveImage(fileId, variant = 'orig') {
  const width = variant === 'preview' ? ROOM_RENT_IMG_WIDTH_PREVIEW : ROOM_RENT_IMG_WIDTH_ORIGINAL;
  const maxBytes = variant === 'preview' ? LINE_IMAGE_MAX_PREVIEW_BYTES : LINE_IMAGE_MAX_ORIGINAL_BYTES;
  const candidates = [
    `https://lh3.googleusercontent.com/d/${encodeURIComponent(fileId)}=w${width}`,
    `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`,
    `https://drive.google.com/uc?export=view&id=${encodeURIComponent(fileId)}`
  ];

  for (const sourceUrl of candidates) {
    let res;
    try {
      res = await fetch(sourceUrl, {
        method: 'GET',
        redirect: 'follow',
        headers: {
          'Accept': 'image/*,*/*;q=0.8',
          'User-Agent': 'Mozilla/5.0 (compatible; MamaMansionImageProxy/1.0)'
        }
      });
    } catch (err) {
      console.warn('drive_image_fetch_network_error', { fileId, sourceUrl, err: String(err) });
      continue;
    }

    if (!res.ok) {
      console.warn('drive_image_fetch_bad_status', { fileId, sourceUrl, status: res.status });
      continue;
    }

    const ctRaw = String(res.headers.get('content-type') || '').toLowerCase();
    const contentLength = Number(res.headers.get('content-length') || '0');
    if (contentLength && contentLength > maxBytes) {
      console.warn('drive_image_fetch_too_large', { fileId, variant, sourceUrl, contentLength, maxBytes });
      continue;
    }

    if (ctRaw.startsWith('image/')) {
      const contentType = ctRaw.split(';')[0] || 'image/jpeg';
      return { res, contentType };
    }
  }

  throw new Error(`drive image unavailable for fileId=${fileId}, variant=${variant}`);
}

async function serveRoomRentImage(request, url) {
  const seg = url.pathname.split('/').filter(Boolean).pop() || '';
  const index = Number(seg);
  if (!Number.isInteger(index) || index < 1 || index > ROOM_RENT_DRIVE_IMAGE_IDS.length) {
    return new Response('Not found', { status: 404 });
  }

  const fileId = ROOM_RENT_DRIVE_IMAGE_IDS[index - 1];
  const variant = resolveRoomRentVariant(url);
  try {
    const { res, contentType } = await fetchGoogleDriveImage(fileId, variant);
    const headers = new Headers();
    headers.set('Content-Type', contentType || 'image/jpeg');
    headers.set('Cache-Control', variant === 'preview' ? 'public, max-age=604800' : 'public, max-age=86400');
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Access-Control-Allow-Origin', '*');

    if (request.method === 'HEAD') {
      return new Response(null, { status: 200, headers });
    }

    return new Response(res.body, { status: 200, headers });
  } catch (err) {
    console.error('serve_room_rent_image_failed', { fileId, variant, err: String(err) });
    return new Response('Image unavailable', { status: 502, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
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
const maskPhone = (p) => (p || '').replace(/^(\d{3})\d{4}(\d{3})$/, '$1••••$2');
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
const KEY_RENT_FLOW_TTL_SECONDS = 15 * 60;
const KEY_RENT_START_TAP_GUARD_TTL_SECONDS = 45;
const KEY_RENT_START_EVENT_TTL_SECONDS = 24 * 60 * 60;

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
  const raw = String(text || '').trim();
  if (!CHECKOUT_TRIGGER_RE.test(raw)) return null;

  const compact = raw.replace(/\s+/g, '');
  const roomMatchSpaced = raw.match(/(?:เช็ค\s*เอ[้๊]?[า]?ท์?|checkout)\s*(?:ห้อง|room)?\s*([ab]\d{3,4})\b/i);
  const roomMatchCompact = compact.match(/(?:เช็คเอ[้๊]?[า]?ท์?|checkout)(?:ห้อง|room)?([ab]\d{3,4})\b/i);
  const roomToken = (roomMatchSpaced?.[1] || roomMatchCompact?.[1] || '').toUpperCase();
  if (!roomToken) return null;
  if (!/^[AB]\d{3,4}$/.test(roomToken)) return null;
  return roomToken;
}

const CO_ADMIN_ALLOWED_LINE_USER_ID = 'Ue90558b73d62863e2287ac32e69541a3';
const CO_ADMIN_WEBHOOK_URL = 'https://n8n.srv1112305.hstgr.cloud/webhook/co-admin';
const CO_ADMIN_OUTCOME_SET = new Set(['no', 'forfeit', 'waive']);

function parseRoomToken(token) {
  const room = String(token || '').trim().toUpperCase();
  if (!/^[AB]\d{3,4}$/.test(room)) return null;
  return room;
}

function parseCoAdminShortcut(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const tokens = raw.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return null;

  if (tokens[0] === 'co') {
    if (tokens[1] === 'done') {
      if (tokens.length < 3 || tokens.length > 4) return null;
      const roomId = parseRoomToken(tokens[2]);
      if (!roomId) return null;
      const outcome = tokens.length === 4 ? tokens[3] : '';
      if (outcome && !CO_ADMIN_OUTCOME_SET.has(outcome)) return null;
      return {
        type: 'co_done',
        roomId,
        outcome: outcome || null,
        normalizedCommand: outcome ? `co done ${roomId.toLowerCase()} ${outcome}` : `co done ${roomId.toLowerCase()}`
      };
    }

    if (tokens[1] === 'status') {
      if (tokens.length !== 3) return null;
      const roomId = parseRoomToken(tokens[2]);
      if (!roomId) return null;
      return {
        type: 'co_status',
        roomId,
        outcome: null,
        normalizedCommand: `co status ${roomId.toLowerCase()}`
      };
    }

    if (tokens.length < 2 || tokens.length > 3) return null;
    const roomId = parseRoomToken(tokens[1]);
    if (!roomId) return null;
    const outcome = tokens.length === 3 ? tokens[2] : '';
    if (outcome && !CO_ADMIN_OUTCOME_SET.has(outcome)) return null;
    return {
      type: 'co',
      roomId,
      outcome: outcome || null,
      normalizedCommand: outcome ? `co ${roomId.toLowerCase()} ${outcome}` : `co ${roomId.toLowerCase()}`
    };
  }

  if (tokens[0] === 'ready') {
    if (tokens.length !== 2) return null;
    const roomId = parseRoomToken(tokens[1]);
    if (!roomId) return null;
    return {
      type: 'ready',
      roomId,
      outcome: null,
      normalizedCommand: `ready ${roomId.toLowerCase()}`
    };
  }

  return null;
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

const ROOM_VISIT_REPLY_TEXT = 'สามารถมาเยี่ยมชมมามา แมนชั่นได้ทุกวัน 08:00 น. ถึง 17:00 น. ครับผม';
const ROOM_VISIT_KEYWORDS = new Set([
  'ดูห้อง',
  'ชมห้อง',
  'เข้าไปดู',
  'เข้ามาดู',
  'ชมหอ',
  'ดูหอ'
]);
const ROOM_VISIT_INTENT_RE = /(ดูห้อง|ชมห้อง|เข้าไปดู(?:ห้อง|หอ)?|เข้ามาดู(?:ห้อง|หอ)?|ชมหอ|ดูหอ|ดูห้องตัวอย่าง|ชมห้องตัวอย่าง|นัดดูห้อง|นัดชมห้อง)/i;
const ROOM_VISIT_VERB_RE = /(ดู|ชม|เยี่ยมชม|นัดดู|นัดชม|ขอดู|ขอชม|อยากดู|อยากชม|visit|view|see|tour|walk-?in)/i;
const ROOM_VISIT_TARGET_RE = /(ห้องตัวอย่าง|ห้องพัก|ห้อง|หอ|แมนชั่น|sample\s*room|show\s*room|showroom|room|dorm|mansion)/i;
const ROOM_VISIT_EXCLUDE_RE = /(ห้องน้ำ|ห้องครัว|ห้องเก็บของ|ห้องเครื่อง|ห้องซักผ้า|ห้องแม่บ้าน)/i;

function isRoomVisitIntent(text) {
  const raw = String(text || '').trim();
  if (!raw) return false;
  const compact = raw.replace(/\s+/g, '');
  const lower = raw.toLowerCase();

  if (ROOM_VISIT_KEYWORDS.has(compact)) return true;
  if (ROOM_VISIT_INTENT_RE.test(compact) || ROOM_VISIT_INTENT_RE.test(lower)) return true;
  if (ROOM_VISIT_EXCLUDE_RE.test(compact) || ROOM_VISIT_EXCLUDE_RE.test(lower)) return false;

  const hasVerb =
    ROOM_VISIT_VERB_RE.test(raw) ||
    ROOM_VISIT_VERB_RE.test(compact) ||
    ROOM_VISIT_VERB_RE.test(lower);
  if (!hasVerb) return false;

  const hasTarget =
    ROOM_VISIT_TARGET_RE.test(raw) ||
    ROOM_VISIT_TARGET_RE.test(compact) ||
    ROOM_VISIT_TARGET_RE.test(lower);
  return hasTarget;
}

// Detects general parking interest by requiring the parking keyword plus a basic intent verb.
function isParkingIntent(text) {
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

const KEY_RENT_MOBILE_BANKING_TEXT = [
  '📌 กรุณาโอนเงินเข้าบัญชีนี้เท่านั้น',
  '',
  '🏦 ธนาคารทีทีบี (TTB)',
  'เลขที่บัญชี: 760-7258-188',
  'ชื่อบัญชี: ธิมา สุภานุรัตน์',
  ''
].join('\n');

const KEY_RENT_MODE_LABELS = {
  KEY: 'กุญแจ',
  KEYCARD: 'คีย์การ์ด',
  SET: 'ชุดกุญแจ'
};

function normalizeKeyRentMode(modeRaw) {
  const mode = String(modeRaw || '').trim().toUpperCase();
  if (mode === 'KEY' || mode === 'KEYCARD' || mode === 'SET') return mode;
  return '';
}

function keyRentModeLabel(modeRaw) {
  const mode = normalizeKeyRentMode(modeRaw);
  return KEY_RENT_MODE_LABELS[mode] || 'กุญแจ';
}

function buildKeyRentStartInstructionText(env) {
  const override = String(env?.KEY_RENT_START_INSTRUCTION_TEXT || '').trim();
  if (override) return override;
  return [
    'ขั้นตอนขอเช่ากุญแจเพิ่ม',
    '1) เลือกประเภทกุญแจที่ต้องการเช่าจากปุ่มด้านล่าง',
    '2) ระบบจะส่งคำขอไปยังเจ้าหน้าที่อัตโนมัติ',
    '3) เจ้าหน้าที่จะส่งขั้นตอนถัดไปให้ในแชตนี้'
  ].join('\n');
}

function buildKeyRentStartOptionsMessage() {
  return {
    type: 'flex',
    altText: 'เลือกประเภทการเช่ากุญแจ',
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '14px',
        backgroundColor: '#0F4C81',
        contents: [
          {
            type: 'text',
            text: 'เช่ากุญแจเพิ่ม',
            color: '#FFFFFF',
            size: 'lg',
            weight: 'bold'
          },
          {
            type: 'text',
            text: 'เลือกแบบที่ต้องการ แล้วระบบจะพาไปขั้นตอนชำระเงินทันที',
            color: '#D6E7F6',
            size: 'xs',
            wrap: true,
            margin: 'sm'
          }
        ]
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          {
            type: 'box',
            layout: 'vertical',
            cornerRadius: '12px',
            paddingAll: '10px',
            backgroundColor: '#F8FAFC',
            borderColor: '#D9E2EC',
            borderWidth: '1px',
            contents: [
              {
                type: 'box',
                layout: 'baseline',
                contents: [
                  { type: 'text', text: '🔑 กุญแจ', size: 'sm', weight: 'bold', color: '#0F172A', flex: 4 },
                  { type: 'text', text: '500 บาท', size: 'sm', align: 'end', color: '#0F172A', weight: 'bold', flex: 2 }
                ]
              },
              {
                type: 'text',
                text: 'เหมาะกับผู้ที่ต้องการกุญแจเพิ่มอย่างเดียว',
                size: 'xs',
                color: '#475569',
                wrap: true,
                margin: 'sm'
              }
            ]
          },
          {
            type: 'box',
            layout: 'vertical',
            cornerRadius: '12px',
            paddingAll: '10px',
            backgroundColor: '#F8FAFC',
            borderColor: '#D9E2EC',
            borderWidth: '1px',
            contents: [
              {
                type: 'box',
                layout: 'baseline',
                contents: [
                  { type: 'text', text: '💳 คีย์การ์ด', size: 'sm', weight: 'bold', color: '#0F172A', flex: 4 },
                  { type: 'text', text: '100 บาท', size: 'sm', align: 'end', color: '#0F172A', weight: 'bold', flex: 2 }
                ]
              },
              {
                type: 'text',
                text: 'สำหรับขอคีย์การ์ดเพิ่ม',
                size: 'xs',
                color: '#475569',
                wrap: true,
                margin: 'sm'
              }
            ]
          },
          {
            type: 'box',
            layout: 'vertical',
            cornerRadius: '12px',
            paddingAll: '10px',
            backgroundColor: '#FFF7ED',
            borderColor: '#FDBA74',
            borderWidth: '1px',
            contents: [
              {
                type: 'box',
                layout: 'baseline',
                contents: [
                  { type: 'text', text: '🧩 ชุดกุญแจ', size: 'sm', weight: 'bold', color: '#7C2D12', flex: 4 },
                  { type: 'text', text: '600 บาท', size: 'sm', align: 'end', color: '#7C2D12', weight: 'bold', flex: 2 }
                ]
              },
              {
                type: 'text',
                text: 'รวมกุญแจ + คีย์การ์ด ในครั้งเดียว',
                size: 'xs',
                color: '#9A3412',
                wrap: true,
                margin: 'sm'
              }
            ]
          }
        ]
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          {
            type: 'button',
            style: 'secondary',
            action: { type: 'postback', label: 'เช่ากุญแจ', data: 'act=KEY_RENT_START&mode=KEY', displayText: 'เช่ากุญแจ' }
          },
          {
            type: 'button',
            style: 'secondary',
            action: { type: 'postback', label: 'เช่าคีย์การ์ด', data: 'act=KEY_RENT_START&mode=KEYCARD', displayText: 'เช่าคีย์การ์ด' }
          },
          {
            type: 'button',
            style: 'primary',
            color: '#C2410C',
            action: { type: 'postback', label: 'เช่าชุดกุญแจ', data: 'act=KEY_RENT_START&mode=SET', displayText: 'เช่าชุดกุญแจ' }
          }
        ]
      }
    }
  };
}

function buildKeyRentAckText(keyRent) {
  const modeLabel = keyRent?.mode === 'SET'
    ? 'ชุดกุญแจ'
    : (keyRent?.mode === 'KEYCARD' ? 'คีย์การ์ด' : 'กุญแจ');
  const roomLabel = keyRent?.room ? ` ห้อง ${keyRent.room}` : '';
  return `รับคำขอเช่า${modeLabel}${roomLabel} เรียบร้อยแล้ว โปรดรอการตรวจสอบและสร้างบิลสักครู่ค่ะ`;
}

function buildKeyRentSlipPrompt(keyRent) {
  const modeLabel = keyRent?.mode === 'SET'
    ? 'ชุดกุญแจ'
    : (keyRent?.mode === 'KEYCARD' ? 'คีย์การ์ด' : 'กุญแจ');
  const roomLabel = keyRent?.room ? ` ห้อง ${keyRent.room}` : '';
  return `หากชำระค่า${modeLabel}${roomLabel}แล้ว กรุณาส่งสลิปในแชตนี้ได้เลยค่ะ`;
}

function buildKeyRentPaymentMessage(keyRent) {
  const amount = Number(keyRent?.amount || 0);
  const room = keyRent?.room ? `ห้อง ${keyRent.room}` : '';
  const amountLabel = amount > 0 ? `${amount} บาท` : 'ตรวจสอบยอดกับเจ้าหน้าที่';
  const modeLabel = keyRentModeLabel(keyRent?.mode);

  return {
    type: 'flex',
    altText: 'เลือกวิธีชำระค่าเช่ากุญแจ',
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '14px',
        backgroundColor: '#0B4F6C',
        contents: [
          {
            type: 'text',
            text: 'เลือกวิธีชำระเงิน',
            color: '#FFFFFF',
            weight: 'bold',
            size: 'lg'
          },
          {
            type: 'text',
            text: `ค่าเช่า${modeLabel}`,
            color: '#D5EAF2',
            size: 'sm',
            margin: 'sm'
          }
        ]
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          {
            type: 'box',
            layout: 'horizontal',
            spacing: 'sm',
            contents: [
              {
                type: 'box',
                layout: 'vertical',
                flex: 3,
                cornerRadius: '12px',
                paddingAll: '10px',
                backgroundColor: '#F8FAFC',
                borderColor: '#D9E2EC',
                borderWidth: '1px',
                contents: [
                  { type: 'text', text: 'รายการ', size: 'xs', color: '#64748B' },
                  { type: 'text', text: modeLabel, size: 'sm', weight: 'bold', color: '#0F172A', margin: 'xs' }
                ]
              },
              {
                type: 'box',
                layout: 'vertical',
                flex: 3,
                cornerRadius: '12px',
                paddingAll: '10px',
                backgroundColor: '#FFF7ED',
                borderColor: '#FDBA74',
                borderWidth: '1px',
                contents: [
                  { type: 'text', text: 'ยอดชำระ', size: 'xs', color: '#9A3412' },
                  { type: 'text', text: amountLabel, size: 'sm', weight: 'bold', color: '#7C2D12', margin: 'xs' }
                ]
              }
            ]
          },
          room
            ? {
              type: 'box',
              layout: 'horizontal',
              cornerRadius: '10px',
              paddingAll: '10px',
              backgroundColor: '#EEF2FF',
              contents: [
                { type: 'text', text: 'ห้อง', size: 'sm', color: '#3730A3', flex: 2 },
                { type: 'text', text: room.replace(/^ห้อง\s*/, ''), size: 'sm', color: '#1E1B4B', weight: 'bold', align: 'end', flex: 3 }
              ]
            }
            : {
              type: 'text',
              text: 'เลือกรูปแบบการชำระด้านล่างได้เลย',
              size: 'sm',
              color: '#475569',
              wrap: true
            }
        ]
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          {
            type: 'button',
            style: 'secondary',
            action: { type: 'postback', label: 'เงินสด', data: 'act=KEY_RENT_CASH', displayText: 'ชำระเงินสด' }
          },
          {
            type: 'button',
            style: 'primary',
            color: '#0369A1',
            action: { type: 'postback', label: 'โอนจ่าย', data: 'act=KEY_RENT_BANK', displayText: 'โอนจ่าย' }
          },
          {
            type: 'button',
            style: 'secondary',
            action: { type: 'postback', label: 'ยกเลิก', data: 'act=KEY_RENT_CANCEL', displayText: 'ยกเลิก' }
          }
        ]
      }
    }
  };
}

function parseBuildingRoomToken(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  const compact = raw.replace(/\s+/g, '');
  const match = compact.match(/^((?:a|b)|(?:เอ)|(?:บี))(\d{2,4})$/i);
  if (!match) return null;

  const buildingToken = match[1] || '';
  const building = /^a$/i.test(buildingToken) || /^เอ$/i.test(buildingToken)
    ? 'A'
    : (/^b$/i.test(buildingToken) || /^บี$/i.test(buildingToken) ? 'B' : null);
  if (!building) return null;

  return `${building}${match[2]}`;
}

function buildKeyRentDetails(mode, room, rawText) {
  const items = [];
  if (mode === 'SET' || mode === 'KEYCARD') {
    items.push({ assetType: 'KEYCARD', qty: 1, unitPrice: 100, amount: 100 });
  }
  if (mode === 'SET' || mode === 'KEY') {
    items.push({ assetType: 'KEY', qty: 1, unitPrice: 500, amount: 500 });
  }
  if (!items.length) return null;

  const amount = items.reduce((sum, item) => sum + item.amount, 0);
  return { mode, room, items, amount, rawText: rawText || `${mode} ${room}` };
}

// Rent key/keycard/set commands
function parseKeyRent(textRaw) {
  const raw = String(textRaw || '').trim();
  if (!raw) return null;
  const compact = raw.replace(/\s+/g, '');
  const compactNormalized = compact.replace(/^ขอ/, '');

  let mode = null;
  if (compactNormalized.startsWith('เช่าชุดกุญแจ')) mode = 'SET';
  else if (compactNormalized.startsWith('เช่าคีย์การ์ด')) mode = 'KEYCARD';
  else if (compactNormalized.startsWith('เช่ากุญแจ')) mode = 'KEY';
  else return null; // not a rent-key trigger

  const roomMatch = compactNormalized.match(/((?:a|b)|(?:เอ)|(?:บี))(\d{2,4})/i);
  if (!roomMatch) return { error: 'MISSING_ROOM' };
  const room = parseBuildingRoomToken(`${roomMatch[1]}${roomMatch[2]}`);
  if (!room) return { error: 'MISSING_ROOM' };

  return buildKeyRentDetails(mode, room, raw);
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
function hasKV(env) { return !!(env && env.KV && typeof env.KV.get === 'function'); }
async function kvGet(env, k) { try { if (!hasKV(env)) return null; return await env.KV.get(k, 'json'); } catch (_) { return null; } }
async function kvPut(env, k, v, ttlSeconds) { try { if (!hasKV(env)) return; await env.KV.put(k, JSON.stringify(v), { expirationTtl: ttlSeconds || 7200 }); } catch (_) { /* no-op */ } }
async function kvDel(env, k) { try { if (!hasKV(env)) return; await env.KV.delete(k); } catch (_) { /* no-op */ } }

const SCREENING_CFG_KEY = 'cfg:screening_enabled';

async function cfgGet(env, k) {
  try {
    if (!hasKV(env)) return null;
    return await env.KV.get(k, 'json');
  } catch (_) {
    return null;
  }
}

async function cfgPut(env, k, v) {
  try {
    if (!hasKV(env)) return;
    await env.KV.put(k, JSON.stringify(v));
  } catch (_) {
    // no-op
  }
}

async function getScreeningEnabled(env) {
  const v = await cfgGet(env, SCREENING_CFG_KEY);
  if (typeof v === 'boolean') return v;
  if (v && typeof v.enabled === 'boolean') return v.enabled;
  return false;
}

async function setScreeningEnabled(env, enabled) {
  await cfgPut(env, SCREENING_CFG_KEY, { enabled: !!enabled, updatedAt: Date.now() });
}

const LEAD_TTL_SECONDS = 7 * 24 * 60 * 60;
const leadKey = (userId) => `lead:${userId}`;

async function getLead(env, userId) {
  if (!userId) return null;
  return await kvGet(env, leadKey(userId));
}

async function saveLead(env, userId, lead) {
  if (!userId) return;
  await kvPut(env, leadKey(userId), lead, LEAD_TTL_SECONDS);
}

async function clearLead(env, userId) {
  if (!userId) return;
  await kvDel(env, leadKey(userId));
}

function nowBkkString() {
  return `${formatDateBangkok()} ${formatTimeBangkok()}`;
}

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
function getWebhookGas(env) {
  return env.MM_WEBHOOK_URL || '';
}

function getReservationGas(env) {
  // Booking flow → only MM_V2_URL (no fallback)
  return env.MM_V2_URL || '';
}

function getReservationAdminKey(env) {
  return env.ADMIN_API_KEY || '';
}

// GAS #2: new Move-out API (resolve_token / status / moveout_upsert)
function getMoveoutGas(env) {
  return env.MOVEOUT_GAS_URL || '';
}

function getAutoImgGas(env) {
  return env.AUTO_IMG_URL || '';
}

function getGitRepo(env) {
  return String(env.GITHUB_REPO || env.GIT_REPO || '').trim();
}

function getGitBranch(env) {
  return String(env.GITHUB_BRANCH || env.GIT_BRANCH || 'main').trim() || 'main';
}

function getGitToken(env) {
  return String(env.GITHUB_TOKEN || env.GIT_TOKEN || '').trim();
}

function normalizeGitRepo(repo) {
  const value = String(repo || '').trim();
  if (!value) return '';
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) {
    throw new Error('invalid GitHub repo format; expected owner/repo');
  }
  return value;
}

async function fetchLatestGitCommit(env, options = {}) {
  const repo = normalizeGitRepo(options.repo || getGitRepo(env));
  if (!repo) {
    throw new Error('missing GITHUB_REPO (expected owner/repo)');
  }

  const branch = String(options.branch || getGitBranch(env)).trim() || 'main';
  const token = getGitToken(env);
  const headers = {
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'fragrant-term-4318-worker'
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const endpoint = `https://api.github.com/repos/${repo}/commits/${encodeURIComponent(branch)}`;
  const res = await fetch(endpoint, { method: 'GET', headers });
  const bodyText = await res.text();
  let data: Record<string, any> = {};
  try {
    data = JSON.parse(bodyText || '{}');
  } catch (_) {
    data = {};
  }

  if (!res.ok) {
    const message = typeof data?.message === 'string' ? data.message : bodyText.slice(0, 200);
    throw new Error(`github_api_error:${res.status}:${message || 'unknown error'}`);
  }

  const message = String(data?.commit?.message || '');
  const sha = String(data?.sha || '');
  return {
    repo,
    branch,
    sha,
    shortSha: sha ? sha.slice(0, 7) : '',
    message,
    messageTitle: message.split('\n')[0] || '',
    authorName: String(data?.commit?.author?.name || ''),
    authorEmail: String(data?.commit?.author?.email || ''),
    authoredAt: String(data?.commit?.author?.date || ''),
    committedAt: String(data?.commit?.committer?.date || ''),
    url: String(data?.html_url || '')
  };
}


function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin'
  };
}

function getPayRentGas(env) {
  return env.PAYRENT_GAS_URL || '';
}

function getN8nPayRentUrl(env) {
  return env.N8N_PAYRENT_URL || '';
}

const DEFAULT_N8N_RENT_KEY_RECEIVER_URL = 'https://n8n.srv1112305.hstgr.cloud/webhook/rent-key-receiver';
function getRentKeyReceiverUrl(env) {
  // Env var: N8N_RENT_KEY_RECEIVER_URL (optional). If unset, the default webhook URL above is used.
  return env.N8N_RENT_KEY_RECEIVER_URL || DEFAULT_N8N_RENT_KEY_RECEIVER_URL;
}

const DEFAULT_N8N_CONTINUE_TERM_REPLY_URL = 'https://n8n.srv1112305.hstgr.cloud/webhook/CONTINUE_TERM_REPLY';
function isContinueTermReplyAction(action) {
  const normalized = String(action || '').trim().toUpperCase();
  return normalized === 'RENEWAL_ACCEPT_TERMS' || normalized === 'RENEWAL_ASK_MORE';
}

function getRenewalPostbackWebhookUrl(env, action) {
  if (isContinueTermReplyAction(action)) {
    return env.N8N_CONTINUE_TERM_REPLY_URL || DEFAULT_N8N_CONTINUE_TERM_REPLY_URL;
  }
  return env.N8N_RENEWAL_POSTBACK_URL || '';
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
  if (!urlBase || !key) throw new Error('missing reservation admin config');
  const url = `${urlBase}?action=${encodeURIComponent(action)}`;
  const body = JSON.stringify({ ...(payload || {}), key });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body
  });
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  const data = ct.includes('application/json') ? await res.json().catch(() => ({})) : { text: await res.text() };
  return { ok: res.ok && (data.ok !== false), data };
}

async function reservationAdminCallWithAuthGuard(env, action, payload) {
  const urlBase = getReservationGas(env);
  const key = getReservationAdminKey(env);
  if (!urlBase || !key) {
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
  const secret = env.WORKER_SECRET || '';
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
      const j = await res.json().catch(() => ({}));
      ok = !!j.ok || res.ok;
      text = JSON.stringify(j);
    } else {
      text = await res.text();
      ok = res.ok && text.trim() === 'OK';
    }
  } catch (e) {
    console.error('forwardToSpecificGas error', String(e));
  }
  console.log('forwardToSpecificGas result', { url: (new URL(gasUrl)).host, status, ok, text: ('' + text).slice(0, 200) });
  return ok;
}

/** Forward any payload to GAS with header+body secret. Returns boolean ok. */
async function forwardToGas(env, body) {
  const gasUrl = getWebhookGas(env);
  const secret = env.WORKER_SECRET || '';
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
      const j = await res.json().catch(() => ({}));
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
    try { await kvDel(env, stateKey + ':moveout_flow'); } catch { }
    await send([{ type: 'text', text: 'ยกเลิกขั้นตอนแจ้งออกแล้วค่ะ' }]);
    return true;
  }

  if (data.act === 'moveout_yes') {
    // ❗ Don’t trust postback params. Read from KV.
    const flow = await kvGet(env, stateKey + ':moveout_flow');
    const room = String(flow?.room || '').toUpperCase().trim();
    const iso = String(flow?.dateISO || '').trim();
    const phone = String(flow?.phone || '').trim();

    if (!room || !isIsoDate(iso) || !PHONE_RE.test(phone)) {
      console.error('moveout_yes: invalid or missing KV state', { hasRoom: !!room, hasDate: isIsoDate(iso), hasPhone: PHONE_RE.test(phone) });
      await send([{ type: 'text', text: 'ไม่สามารถยืนยันข้อมูลได้ กรุณาเริ่มขั้นตอนใหม่อีกครั้งค่ะ' }]);
      try { await kvDel(env, stateKey + ':moveout_flow'); } catch { }
      return true;
    }

    // 1) show loading immediately (no text yet)
    await lineStartLoading(env.LINE_ACCESS_TOKEN, chatId, 15);

    // 2) fire GAS synchronously (NO push used)
    const ok = await forwardToGas(env, { act: 'moveout', roomId: room, dateISO: iso, phone, lineUserId: (event?.source?.userId || '') });

    // 3) clear flow state
    try { await kvDel(env, stateKey + ':moveout_flow'); } catch { }

    // 4) single reply with final result (within 1 minute)
    const finalMsg = ok
      ? `✅ รับแจ้งออกแล้ว\nห้อง ${room} จะว่างตั้งแต่ ${iso.split('-').reverse().join('/')}\nเบอร์ติดต่อ: ${maskPhone(phone)}`
      : '❗บันทึกไม่สำเร็จ โปรดลองใหม่หรือติดต่อผู้ดูแลค่ะ';

    await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [{ type: 'text', text: finalMsg }]);
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

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname.startsWith('/media/room-rent/')) {
      return serveRoomRentImage(request, url);
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
        try { body = JSON.parse(raw || '{}'); } catch (_) { }
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

    if (request.method === 'GET' && url.pathname === '/git/latest-commit') {
      const secret = String(env.WORKER_SECRET || '').trim();
      if (secret && request.headers.get('x-worker-secret') !== secret) {
        return new Response('Unauthorized', { status: 401 });
      }

      const repo = String(url.searchParams.get('repo') || '').trim();
      const branch = String(url.searchParams.get('branch') || '').trim();

      try {
        const latest = await fetchLatestGitCommit(env, { repo, branch });
        return new Response(JSON.stringify({ ok: true, ...latest }), {
          status: 200,
          headers: { ...corsHeaders(env.ALLOWED_ORIGIN), 'Content-Type': 'application/json' }
        });
      } catch (err) {
        console.error('latest_commit_lookup_failed', err);
        return new Response(JSON.stringify({
          ok: false,
          error: String(err?.message || err)
        }), {
          status: 500,
          headers: { ...corsHeaders(env.ALLOWED_ORIGIN), 'Content-Type': 'application/json' }
        });
      }
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
        const postbackDataString = String(ev?.postback?.data || '');
        let data: Record<string, string> = {};
        try {
          if (typeof parsePostbackData === 'function') {
            const parsed = parsePostbackData(postbackDataString);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              for (const [key, value] of Object.entries(parsed)) {
                if (!key) continue;
                data[key] = String(value ?? '');
              }
            }
          }
        } catch (err) {
          console.warn('rent_key_postback_parsePostbackData_failed', err);
        }
        if (Object.keys(data).length === 0) {
          try {
            const qs = postbackDataString.startsWith('?') ? postbackDataString.slice(1) : postbackDataString;
            data = Object.fromEntries(new URLSearchParams(qs));
          } catch (err) {
            console.warn('rent_key_postback_fallback_parse_failed', err);
            data = {};
          }
        }

        // BEGIN RENT KEY POSTBACK FORWARD
        const rentKeyAction = String(data.act || data.type || '').trim();
        if (rentKeyAction === 'KEY_CASH_CONFIRM' || rentKeyAction === 'KEY_CASH_REJECT') {
          const billId = String(data.billId || '');
          const room = String(data.room || '');
          const billIdLabel = billId || '-';
          const quickReplyText = rentKeyAction === 'KEY_CASH_CONFIRM'
            ? `✅ บันทึกว่า 'รับเงินแล้ว' (BillID: ${billIdLabel})`
            : `❌ บันทึกว่า 'ยังไม่ได้รับเงิน' (BillID: ${billIdLabel})`;

          if (replyToken) {
            await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [
              { type: 'text', text: quickReplyText }
            ]).catch((err) => console.error('rent_key_postback_reply_failed', err));
          } else {
            const chatId = getChatId(ev);
            if (chatId) {
              ctx.waitUntil(linePushText(env.LINE_ACCESS_TOKEN, chatId, quickReplyText).catch((err) => console.error('rent_key_postback_push_failed', err)));
            }
          }

          const rentKeyReceiverUrl = getRentKeyReceiverUrl(env);
          const headers: Record<string, string> = { 'content-type': 'application/json' };
          const workerSecret = String(env?.WORKER_SECRET || '').trim();
          if (workerSecret) {
            headers['x-worker-secret'] = workerSecret;
          }

          const payloadToN8n = {
            source: 'line',
            receivedAt: new Date().toISOString(),
            action: rentKeyAction,
            billId,
            room,
            parsed: data,
            event: ev
          };

          ctx.waitUntil(
            fetch(rentKeyReceiverUrl, {
              method: 'POST',
              headers,
              body: JSON.stringify(payloadToN8n)
            }).catch((err) => console.error('rent_key_postback_forward_failed', err))
          );
          continue;
        }
        // END RENT KEY POSTBACK FORWARD

        const act = String(data.act || '').trim();
        if (act === 'KEY_RENT_START') {
          const chatId = getChatId(ev);
          const userId = ev?.source?.userId || null;
          const stateKey = getStateKey(ev);
          const keyRentFlowKey = stateKey + ':keyrent_flow';
          const mode = normalizeKeyRentMode(data.mode || '');
          if (!mode) {
            await errorReplyOrPush(env, replyToken, chatId, 'ไม่พบประเภทการเช่ากุญแจ กรุณาเลือกใหม่อีกครั้งค่ะ');
            continue;
          }

          const eventId = String(ev?.webhookEventId || '');
          if (eventId) {
            const eventDedupeKey = `idem:keyrent_start:event:${eventId}`;
            const eventSeen = await kvGet(env, eventDedupeKey);
            if (eventSeen) {
              await errorReplyOrPush(env, replyToken, chatId, `ได้รับคำขอเช่า${keyRentModeLabel(mode)}แล้ว กำลังดำเนินการค่ะ`);
              continue;
            }
            await kvPut(
              env,
              eventDedupeKey,
              { ts: Date.now(), eventId, mode, userId, chatId },
              KEY_RENT_START_EVENT_TTL_SECONDS
            );
          }

          const tapGuardKey = `idem:keyrent_start:tap:${stateKey}:${mode}`;
          const recentTap = await kvGet(env, tapGuardKey);
          if (recentTap) {
            await errorReplyOrPush(env, replyToken, chatId, `รับคำขอเช่า${keyRentModeLabel(mode)}ล่าสุดแล้ว กรุณารอสักครู่ค่ะ`);
            continue;
          }

          await kvPut(
            env,
            tapGuardKey,
            { ts: Date.now(), mode, eventId, userId, chatId },
            KEY_RENT_START_TAP_GUARD_TTL_SECONDS
          );

          const modeLabel = keyRentModeLabel(mode);
          const keyRent = buildKeyRentDetails(mode, null, `เช่า${modeLabel}`);
          if (!keyRent) {
            await errorReplyOrPush(env, replyToken, chatId, 'ไม่สามารถสร้างรายการเช่ากุญแจได้ กรุณาลองใหม่อีกครั้งค่ะ');
            continue;
          }

          const flow = {
            keyRent,
            userId,
            chatId: chatId || null,
            sourceType: ev?.source?.type || null,
            messageId: null,
            receivedAt: new Date().toISOString(),
            startAction: 'KEY_RENT_START',
            startEventId: eventId || null,
            ts: Date.now()
          };
          await kvPut(env, keyRentFlowKey, flow, KEY_RENT_FLOW_TTL_SECONDS);

          const messages = [
            { type: 'text', text: `เลือกวิธีชำระค่า${modeLabel}ได้เลยค่ะ` },
            buildKeyRentPaymentMessage(flow.keyRent)
          ];
          if (replyToken) {
            await lineReply(env.LINE_ACCESS_TOKEN, replyToken, messages).catch(console.error);
          } else if (chatId) {
            ctx.waitUntil(linePush(env.LINE_ACCESS_TOKEN, chatId, messages).catch(console.error));
          }
          continue;
        }
        // Booking postbacks → forward to reservation GAS (GAS owns booking flow)
        if (act === 'confirm' || act === 'slip_yes' || act === 'slip_no' || act === 'id_yes' || act === 'id_no' || act === 'booking_confirm') {
          const resvUrl = getReservationGas(env);
          if (resvUrl) {
            const chatId = getChatId(ev);
            const codeHint = String(data.code || data.bookingCode || '').trim();
            const ackMsg = (act === 'id_yes' || act === 'id_no')
              ? 'กำลังประมวลผลค่ะ โปรดรอสักครู่'
              : (codeHint
                ? `รับการยืนยันรหัสจอง ${codeHint} แล้วค่ะ กำลังตรวจสอบให้ทันที`
                : 'รับการยืนยันแล้วค่ะ กำลังตรวจสอบให้ทันที');
            if (replyToken) {
              await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [
                { type: 'text', text: ackMsg }
              ]).catch(console.error);
            } else if (chatId) {
              ctx.waitUntil(linePushText(env.LINE_ACCESS_TOKEN, chatId, ackMsg).catch(console.error));
            }
            ctx.waitUntil(forwardToSpecificGas(env, resvUrl, { events: [ev] }));
            continue;
          }
        }

        // ===== Admin switch postbacks (OWNER GROUP only) =====
        if (act === 'CFG_SCREEN_ON' || act === 'CFG_SCREEN_OFF' || act === 'CFG_SCREEN_STATUS') {
          const chatId = getChatId(ev);
          if (!isOwnerGroupChat(env, chatId)) {
            await errorReplyOrPush(env, replyToken, chatId, 'คำสั่งนี้ใช้ได้เฉพาะในกลุ่มผู้จัดการเท่านั้นครับ');
            continue;
          }

          if (act === 'CFG_SCREEN_ON') {
            await setScreeningEnabled(env, true);
            await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [{ type: 'text', text: '✅ เปิดโหมดคัดกรองแล้ว' }]).catch(console.error);
            continue;
          }
          if (act === 'CFG_SCREEN_OFF') {
            await setScreeningEnabled(env, false);
            await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [{ type: 'text', text: '✅ ปิดโหมดคัดกรองแล้ว' }]).catch(console.error);
            continue;
          }
          if (act === 'CFG_SCREEN_STATUS') {
            const enabled = await getScreeningEnabled(env);
            await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [
              { type: 'text', text: `📌 สถานะโหมดคัดกรอง: ${enabled ? 'ON ✅' : 'OFF ❌'}` }
            ]).catch(console.error);
            continue;
          }
        }

        // ===== Lead screening flow (user answers) =====
        if (act === 'LEAD_START' || act === 'LEAD_A' || act === 'LEAD_CANCEL') {
          const userId = ev?.source?.userId || '';
          if (!userId) {
            await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [
              { type: 'text', text: 'ไม่พบข้อมูลผู้ใช้งาน กรุณาลองใหม่ครับ' }
            ]).catch(console.error);
            continue;
          }

          if (act === 'LEAD_CANCEL') {
            await clearLead(env, userId);
            await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [
              { type: 'text', text: 'ยกเลิกการกรอกข้อมูลแล้วครับ ✅' }
            ]).catch(console.error);
            continue;
          }

          if (act === 'LEAD_START') {
            const lead = {
              userId,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              submittedAt: null,
              status: 'IN_PROGRESS',
              step: 1,
              answers: {}
            };
            await saveLead(env, userId, lead);
            await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [leadQuestion(1)]).catch(console.error);
            continue;
          }

          if (act === 'LEAD_A') {
            const q = String(data.q || '').trim();
            const v = String(data.v || '').trim();
            if (!q || !v) {
              await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [
                { type: 'text', text: 'ข้อมูลไม่ครบ กรุณาลองใหม่ครับ' }
              ]).catch(console.error);
              continue;
            }

            let lead = await getLead(env, userId);
            if (!lead || lead.status !== 'IN_PROGRESS') {
              lead = {
                userId,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                submittedAt: null,
                status: 'IN_PROGRESS',
                step: 1,
                answers: {}
              };
            }

            lead.answers = lead.answers || {};
            lead.answers[q] = v;
            lead.updatedAt = Date.now();

            const stepMap = { movein: 2, people: 3, status: 4, vehicle: 5, stay: 999 };
            let next = stepMap[q] || (Number(lead.step) || 1) + 1;
            if (next > 5) next = 999;

            if (next === 999) {
              lead.status = 'SUBMITTED';
              lead.submittedAt = Date.now();
              await saveLead(env, userId, lead);

              await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [
                { type: 'text', text: 'ขอบคุณครับ 🙏 ได้รับข้อมูลเรียบร้อยแล้ว\nแอดมินจะตรวจสอบและติดต่อกลับอีกครั้งใน LINE ครับ ✅' }
              ]).catch(console.error);

              if (getOwnerGroupIds(env).length) {
                const a = lead.answers || {};
                const valueMap = {
                  movein: { IN3: 'ภายใน 3 วัน', IN7: 'ภายใน 7 วัน', IN30: 'ภายในเดือนนี้', UNSURE: 'ยังไม่แน่ใจ' },
                  people: { '1': '1 คน', '2': '2 คน', '3PLUS': 'มากกว่า 2' },
                  status: { STUDENT: 'นักเรียน/นักศึกษา', WORK: 'ทำงานประจำ', SHIFT: 'ทำงานกะ/กลางคืน', OTHER: 'อื่นๆ' },
                  vehicle: { NONE: 'ไม่มี', MOTO: 'มอเตอร์ไซค์', CAR: 'รถยนต์' },
                  stay: { '6M': '6 เดือน', '1Y': '1 ปี', '1YPLUS': 'มากกว่า 1 ปี' }
                };
                const formatAnswer = (key, value) => (valueMap[key] && valueMap[key][value]) ? valueMap[key][value] : (value || '-');
                const summary = [
                  '🧾 Lead Screening (SUBMITTED)',
                  `👤 UserId: ${userId}`,
                  `🕒 Time: ${nowBkkString()}`,
                  '',
                  `1) Move-in: ${formatAnswer('movein', a.movein)}`,
                  `2) People: ${formatAnswer('people', a.people)}`,
                  `3) Status: ${formatAnswer('status', a.status)}`,
                  `4) Vehicle: ${formatAnswer('vehicle', a.vehicle)}`,
                  `5) Stay: ${formatAnswer('stay', a.stay)}`
                ].join('\n');

                const msg = [
                  { type: 'text', text: summary },
                  {
                    type: 'template',
                    altText: 'Approve / Reject Lead',
                    template: {
                      type: 'buttons',
                      text: 'ต้องการทำอะไรกับลูกค้ารายนี้?',
                      actions: [
                        { type: 'postback', label: '✅ ส่งลิงก์จอง', data: `act=LEAD_APPROVE&uid=${encodeURIComponent(userId)}` },
                        { type: 'postback', label: '❌ ปฏิเสธสุภาพ', data: `act=LEAD_REJECT&uid=${encodeURIComponent(userId)}` }
                      ]
                    }
                  }
                ];

                ctx.waitUntil(pushToOwnerGroups(env, msg).catch(console.error));
              }
              continue;
            }

            lead.step = next;
            await saveLead(env, userId, lead);
            const nextQuestion = leadQuestion(next);
            if (nextQuestion) {
              await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [nextQuestion]).catch(console.error);
              continue;
            }

            await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [
              { type: 'text', text: 'รับข้อมูลแล้วครับ ✅' }
            ]).catch(console.error);
            continue;
          }
        }

        // ===== Owner Approve / Reject lead =====
        if (act === 'LEAD_APPROVE' || act === 'LEAD_REJECT') {
          const chatId = getChatId(ev);
          if (!isOwnerGroupChat(env, chatId)) {
            await errorReplyOrPush(env, replyToken, chatId, 'คำสั่งนี้ใช้ได้เฉพาะในกลุ่มผู้จัดการเท่านั้นครับ');
            continue;
          }

          const uid = String(data.uid || '').trim();
          if (!uid) {
            await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [
              { type: 'text', text: 'ไม่พบ uid' }
            ]).catch(console.error);
            continue;
          }

          const lead = await getLead(env, uid);
          if (!lead) {
            await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [
              { type: 'text', text: 'Lead นี้หมดอายุ/ไม่พบในระบบแล้ว' }
            ]).catch(console.error);
            continue;
          }

          const bookingUrl = String((env?.BOOKING_URL || '').trim() || 'https://mm-v2.pages.dev/#reservation');

          if (act === 'LEAD_APPROVE') {
            await linePush(env.LINE_ACCESS_TOKEN, uid, [
              { type: 'text', text: `ขอบคุณที่ให้ข้อมูลครับ ✅\nสามารถจองห้องได้ที่ลิงก์นี้เลยครับ:\n${bookingUrl}` }
            ]).catch(console.error);

            lead.status = 'APPROVED';
            lead.approvedAt = Date.now();
            await saveLead(env, uid, lead);

            await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [
              { type: 'text', text: '✅ ส่งลิงก์จองให้ลูกค้าแล้ว' }
            ]).catch(console.error);
            continue;
          }

          if (act === 'LEAD_REJECT') {
            await linePush(env.LINE_ACCESS_TOKEN, uid, [
              { type: 'text', text: 'ขอบคุณที่สนใจนะครับ 🙏 ตอนนี้ห้องที่ตรงเงื่อนไขพอดีเต็มอยู่ครับ หากมีห้องว่างเดี๋ยวจะแจ้งให้ทราบอีกครั้งครับ' }
            ]).catch(console.error);

            lead.status = 'REJECTED';
            lead.rejectedAt = Date.now();
            await saveLead(env, uid, lead);

            await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [
              { type: 'text', text: '✅ ส่งข้อความปฏิเสธสุภาพแล้ว' }
            ]).catch(console.error);
            continue;
          }
        }

        const renewalMeta = buildRenewalPostbackMeta(data, ev, act);
        const {
          room,
          end,
          inq,
          actionField,
          actionFieldLower,
          renewalEventType,
          normalizedEventType,
          managerDecision,
          actionType,
          action,
          td,
          eventId,
          slotKey,
          slotStart,
          slotEnd,
          actorUserId,
          payloadUserId,
          renewalUserId,
          sourceType,
          groupId,
          lineRoomId,
          chatId,
          managerDecisionBy,
          managerChatId,
          isRenewalPipeEvent,
          isRenewalAdminEvent,
          isManagerDecisionEvent
        } = renewalMeta;
        const postbackLog = {
          eventType: normalizedEventType || '',
          actionField,
          action,
          actionType,
          managerDecision,
          room,
          end,
          inq,
          actorUserId,
          payloadUserId,
          renewalUserId,
          timestamp: new Date(ev?.timestamp || Date.now()).toISOString()
        };
        console.log('line_postback', postbackLog);

        // Mark paid → quick ack then forward to n8n
        const markPaidUrl = env.N8N_MMV2_MARK_PAID_URL || '';
        if (action === 'MARK_PAID') {
          const chatId = getChatId(ev);
          const ackText = data.resId
            ? `กำลังดำเนินการรหัส ${data.resId} โปรดรอสักครู่…`
            : 'กำลังดำเนินการ โปรดรอสักครู่…';

          if (replyToken) {
            ctx.waitUntil(lineReply(env.LINE_ACCESS_TOKEN, replyToken, [{ type: 'text', text: ackText }]).catch(console.error));
          } else if (chatId) {
            ctx.waitUntil(linePushText(env.LINE_ACCESS_TOKEN, chatId, ackText).catch(console.error));
          }

          if (markPaidUrl) {
            const headers = { 'Content-Type': 'application/json' };
            const secret = env.WORKER_SECRET || env.MM_WORKER_SECRET || '';
            if (secret) headers['x-worker-secret'] = secret;

            const forwardPayload = {
              source: 'line_postback',
              channel: 'mark_paid',
              event: ev,
              data,
              receivedAt: new Date().toISOString()
            };
            ctx.waitUntil(
              fetch(markPaidUrl, {
                method: 'POST',
                headers,
                body: JSON.stringify(forwardPayload)
              }).catch((err) => console.error('mark_paid_forward_failed', err))
            );
          } else {
            console.warn('mark_paid: missing N8N_MMV2_MARK_PAID_URL');
          }
          continue;
        }

        const isSignSlot = action === 'SIGN_SLOT';
        const isSignAskAdmin = action === 'SIGN_ASK_ADMIN';
        const isLeavePickCheckoutAction = action === 'LEAVE_PICK_CHECKOUT';
        const isRenewalAdminAction =
          action === 'ADMIN_SIGN_TEXT' ||
          action === 'ADMIN_SIGN_CALL' ||
          action === 'ADMIN_SIGN_NOW' ||
          action === 'ADMIN_SEND_SLOT' ||
          action === 'ADMIN_HOLD';
        const isContractRenewalAction =
          action === 'CONTINUE' ||
          action === 'LEAVE' ||
          action === 'UNDECIDED' ||
          action === 'RENEWAL_ACCEPT_TERMS' ||
          action === 'RENEWAL_ASK_MORE' ||
          isLeavePickCheckoutAction ||
          isSignSlot ||
          isSignAskAdmin ||
          isRenewalAdminAction ||
          isManagerDecisionEvent;
        const looksLikeContractRenewal =
          isContractRenewalAction ||
          isRenewalPipeEvent ||
          isRenewalAdminEvent ||
          isManagerDecisionEvent ||
          Object.prototype.hasOwnProperty.call(data, 'inq') ||
          Object.prototype.hasOwnProperty.call(data, 'inquiry') ||
          Object.prototype.hasOwnProperty.call(data, 'inquiryId');

        const missingRenewalFields = [];
        const inquiryOptionalActions = ['RENEWAL_ACCEPT_TERMS', 'RENEWAL_ASK_MORE'];
        const requiresInquiryId = !inquiryOptionalActions.includes(action);
        if (!inq && requiresInquiryId) missingRenewalFields.push('inquiryId');
        if (isManagerDecisionEvent) {
          if (!managerDecision) missingRenewalFields.push('decision');
        } else if (!action && !isSignSlot) {
          missingRenewalFields.push('action');
        }

        if (looksLikeContractRenewal && missingRenewalFields.length > 0) {
          if (!isSignSlot) {
            console.warn('contract_renewal_postback_missing_fields', {
              ...postbackLog,
              missingFields: missingRenewalFields
            });
            try {
              await replyToLine(replyToken, [{ type: 'text', text: 'ข้อมูลไม่ครบ กรุณาลองใหม่อีกครั้ง' }]);
            } catch (err) {
              console.error('contract_renewal_reply_fail', err);
            }
            continue;
          }
        }

        if (isContractRenewalAction) {
          const postbackParams = (ev?.postback?.params && typeof ev.postback.params === 'object' && !Array.isArray(ev.postback.params))
            ? ev.postback.params
            : {};
          const selectedDateTime = String(postbackParams.datetime || '');
          const selectedDate = String(postbackParams.date || '');
          const selectedTime = String(postbackParams.time || '');
          if (isRenewalAdminAction) {
            if (!isRenewalAdminGroupChat(env, chatId)) {
              await errorReplyOrPush(env, replyToken, chatId, 'คำสั่งนี้ใช้ได้เฉพาะในกลุ่มผู้จัดการเท่านั้น');
              continue;
            }
          }

          const renewalPayload = {
            source: 'line_postback',
            type: ev?.type || '',
            eventTypeRaw: ev?.type || '',
            sourceType,
            eventType: normalizedEventType,
            eventId: ev?.webhookEventId || eventId || ev?.replyToken || '',
            timestamp: ev?.timestamp || Date.now(),
            userId: renewalUserId,
            lineUserId: renewalUserId,
            actorUserId,
            payloadUserId,
            groupId,
            lineRoomId,
            chatId: chatId || '',
            replyToken: replyToken || '',
            postbackData: postbackDataString,
            rawData: postbackDataString,
            postbackParams,
            selectedDateTime,
            selectedDate,
            selectedTime,
            action,
            actionField,
            actionType,
            ActionType: actionType,
            queryActionRaw: actionFieldLower,
            ManagerDecision: managerDecision,
            Decision: managerDecision,
            ManagerDecisionBy: managerDecisionBy,
            ManagerChatId: managerChatId,
            InquiryId: inq,
            RoomID: room || '',
            ContractEndDateISO: end || '',
            TriggerDay: td || '',
            inquiryId: inq,
            renewalId: inq || '',
            roomId: room || '',
            contractEnd: end || '',
            td: td || '',
            slotKey: slotKey || '',
            slotStart: slotStart || '',
            slotEnd: slotEnd || ''
          };

          if (isSignSlot) {
            const missingFields = [];
            if (!slotStart) missingFields.push('slotStart');
            if (!slotEnd) missingFields.push('slotEnd');
            if (!inq) missingFields.push('inquiryId');
            if (!room) missingFields.push('roomId');
            if (!renewalUserId) missingFields.push('userId');
            if (missingFields.length > 0) {
              renewalPayload.missingCritical = true;
              renewalPayload.missingFields = missingFields;
            }
          }
          ctx.waitUntil(
            notifyN8nRenewalPostback(env, renewalPayload)
              .catch((err) => console.error('contract_renewal_notify_fail', err))
          );

          if (isLeavePickCheckoutAction) {
            const leaveCheckoutAck = selectedDateTime
              ? `Received your checkout date/time: ${selectedDateTime.replace('T', ' ')}`
              : 'Received your checkout date/time.';
            try {
              await replyToLine(replyToken, [{ type: 'text', text: leaveCheckoutAck }]);
            } catch (err) {
              console.error('contract_renewal_reply_fail', err);
            }
            continue;
          }

          const roomLabel = room || 'ไม่ระบุ';
          const managerReplyMap = {
            APPROVE: `Recorded manager approval for room ${roomLabel}.`,
            REJECT: `Recorded manager rejection for room ${roomLabel}.`,
            HOLD: `Recorded manager hold for room ${roomLabel}.`
          };
          const replyMap = {
            CONTINUE: `รับทราบค่ะ ✅ ห้อง ${roomLabel} แจ้งว่า “อยู่ต่อ” แล้ว`,
            LEAVE: `รับทราบค่ะ 🚚 ห้อง ${roomLabel} แจ้งว่า “ย้ายออก” แล้ว แอดมินจะติดต่อกลับเพื่อขั้นตอนถัดไป`,
            UNDECIDED: `รับทราบค่ะ 🤔 ห้อง ${roomLabel} แจ้งว่า “ยังไม่แน่ใจ” แล้ว หากพร้อมเมื่อไหร่กดเลือกได้อีกครั้ง`,
            RENEWAL_ACCEPT_TERMS: `รับทราบค่ะ ✅ ห้อง ${roomLabel} ยืนยันรับทราบเงื่อนไขต่อสัญญาแล้ว`,
            RENEWAL_ASK_MORE: `รับทราบค่ะ 📝 ห้อง ${roomLabel} ขอรายละเอียดเพิ่มเติมแล้ว แอดมินจะติดต่อกลับ`
          };

          try {
            const ackText = isManagerDecisionEvent
              ? (managerReplyMap[managerDecision] || 'Recorded manager decision.')
              : (replyMap[action] || 'รับทราบค่ะ');
            await replyToLine(replyToken, [{ type: 'text', text: ackText }]);
          } catch (err) {
            console.error('contract_renewal_reply_fail', err);
          }

          if (action === 'LEAVE') {
            const leavePushEnabled = String(env.ENABLE_LEAVE_PUSH || '').toLowerCase() === 'true';
            if (getOwnerGroupIds(env).length && leavePushEnabled) {
              const now = `${formatDateBangkok()} ${formatTimeBangkok()}`;
              const summary = [
                '🚚 Tenant plans to leave',
                `Room: ${roomLabel}`,
                `EndDate: ${end || '-'}`,
                `InquiryId: ${inq}`,
                `Time: ${now}`
              ].join('\n');

              ctx.waitUntil(
                pushTextToOwnerGroups(env, summary)
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
          ctx.waitUntil(lineReply(env.LINE_ACCESS_TOKEN, replyToken, [{ type: 'text', text: txt }]).catch(console.error));
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

        // Key rent payment method selection
        if (act === 'KEY_RENT_CASH' || act === 'KEY_RENT_BANK' || act === 'KEY_RENT_CANCEL') {
          const chatId = getChatId(ev);
          const stateKey = getStateKey(ev);
          const keyRentFlowKey = stateKey + ':keyrent_flow';
          const penaltyKey = stateKey + ':penalty_flow';
          const keyRentFlow = await kvGet(env, keyRentFlowKey);

          if (!keyRentFlow || !keyRentFlow.keyRent) {
            await errorReplyOrPush(env, replyToken, chatId, 'ไม่พบรายการเช่ากุญแจ กรุณาเริ่มใหม่อีกครั้งค่ะ');
            continue;
          }

          if (act === 'KEY_RENT_CANCEL') {
            ctx.waitUntil(kvDel(env, keyRentFlowKey));
            await errorReplyOrPush(env, replyToken, chatId, 'ยกเลิกคำขอเช่ากุญแจแล้วค่ะ');
            continue;
          }

          const paymentMethod = act === 'KEY_RENT_CASH' ? 'CASH' : 'MOBILE_BANKING';
          const keyRent = keyRentFlow.keyRent || {};
          const eventId = String(ev?.webhookEventId || ev?.replyToken || '');
          const idempotencyKey = eventId
            ? `line:${eventId}`
            : `line:keyrent:payment:${stateKey}:${paymentMethod}:${Date.now()}`;
          const payload = {
            type: 'KEY_RENT',
            intent: 'key_rent_payment',
            room: keyRent.room,
            mode: keyRent.mode || null,
            items: keyRent.items,
            amount: keyRent.amount,
            userId: keyRentFlow.userId || ev?.source?.userId || null,
            chatId: keyRentFlow.chatId || chatId || null,
            sourceType: keyRentFlow.sourceType || ev?.source?.type || null,
            messageId: keyRentFlow.messageId || null,
            receivedAt: keyRentFlow.receivedAt || new Date().toISOString(),
            paymentMethod,
            eventId,
            idempotencyKey
          };

          const messages = [
            { type: 'text', text: buildKeyRentAckText(keyRent) }
          ];

          if (replyToken) {
            await lineReply(env.LINE_ACCESS_TOKEN, replyToken, messages).catch(console.error);
          } else if (chatId) {
            ctx.waitUntil(linePush(env.LINE_ACCESS_TOKEN, chatId, messages).catch(console.error));
          }

          ctx.waitUntil(
            notifyN8nKeyWebhook(env, payload).catch((err) => console.error('key webhook failed', err))
          );
          if (paymentMethod === 'MOBILE_BANKING') {
            ctx.waitUntil(
              kvPut(
                env,
                penaltyKey,
                {
                  ts: Date.now(),
                  chatId: keyRentFlow.chatId || chatId || null,
                  userId: keyRentFlow.userId || ev?.source?.userId || null,
                  type: 'Others_payment',
                  reason: normalizePenaltyReason(keyRent.rawText || 'ค่าเช่ากุญแจ')
                },
                PENALTY_FLOW_TTL_SECONDS
              )
            );
          } else {
            ctx.waitUntil(kvDel(env, penaltyKey));
          }
          ctx.waitUntil(kvDel(env, keyRentFlowKey));
          continue;
        }

        // Fridge received confirmation (querystring postback)
        const fridgeType = String(data.type || '').trim().toLowerCase();
        const fridgeAction = String(data.action || '').trim().toLowerCase();
        if (fridgeType === 'fridge' && (fridgeAction === 'received_yes' || fridgeAction === 'received_no')) {
          const sanitizedData = {
            ...data,
            type: 'fridge',
            action: fridgeAction,
            lineUserId: ev?.source?.userId || data.lineUserId || null,
            chatId: getChatId(ev) || data.chatId || null
          };

          const fridgePayload = {
            source: 'line_postback',
            channel: 'fridge_received',
            event: ev,
            data: sanitizedData,
            receivedAt: new Date().toISOString()
          };

          ctx.waitUntil(
            notifyN8nFridgeReceived(env, fridgePayload)
              .catch((err) => console.error('fridge received notify failed', err))
          );

          if (replyToken) {
            const ackText = fridgeAction === 'received_yes'
              ? 'รับทราบครับ ✅ บันทึกว่าได้รับตู้เย็นแล้ว'
              : 'รับทราบครับ ❌ เดี๋ยวเจ้าหน้าที่จะติดต่อกลับ';
            await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [
              { type: 'text', text: ackText }
            ]).catch(console.error);
          }
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

        if (data.act === 'parking_owner_approve' || data.act === 'parking_owner_reject') {
          const ownerAction = data.act === 'parking_owner_approve' ? 'approve' : 'reject';
          const parkingOwnerPayload = {
            source: 'line_postback',
            channel: 'parking_owner',
            action: ownerAction,
            event: ev,
            data: {
              ...data,
              lineUserId: data.lineUserId || null,
              roomId: data.roomId || null,
              slotId: data.slotId || null,
              actedByLineUserId: ev?.source?.userId || null,
              chatId: getChatId(ev) || data.chatId || null
            },
            receivedAt: new Date().toISOString()
          };

          ctx.waitUntil(
            notifyN8nParking(env, parkingOwnerPayload).catch((err) => console.error('parking owner decision notify failed', err))
          );

          if (replyToken) {
            const ackText = ownerAction === 'approve'
              ? 'บันทึกการอนุมัติที่จอดรถแล้วครับ'
              : 'บันทึกการปฏิเสธที่จอดรถแล้วครับ';
            await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [
              { type: 'text', text: ackText }
            ]).catch(console.error);
          }
          continue;
        }

        if (data.act === 'parking_rent_request') {
          const selectedParkingSegment = getParkingSegmentByKey(data.customerType);
          const baseParking = {
            ...data,
            type: 'parking',
            plan: 'parking',
            lineUserId: ev?.source?.userId || data.lineUserId || null,
            chatId: getChatId(ev) || data.chatId || null
          };
          const sanitizedParking = selectedParkingSegment
            ? {
              ...baseParking,
              customerType: selectedParkingSegment.key,
              customerLabel: selectedParkingSegment.label,
              pricePerMonth: selectedParkingSegment.pricePerMonth
            }
            : baseParking;
          const parkingPayload = {
            source: 'line_postback',
            channel: 'parking',
            event: ev,
            data: sanitizedParking,
            receivedAt: new Date().toISOString()
          };

          if (replyToken) {
            const ackText = selectedParkingSegment
              ? `รับคำขอเช่าที่จอดรถ (${selectedParkingSegment.label} ${selectedParkingSegment.pricePerMonth.toLocaleString('th-TH')} บาท/เดือน) แล้วครับ กำลังตรวจสอบความว่างให้ทันที`
              : 'รับคำขอที่จอดรถแล้วครับ กำลังตรวจสอบความว่างให้ทันที';
            await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [
              { type: 'text', text: ackText }
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
            const imageMessages = buildRoomRentImageMessages(url.origin);
            const out = [
              { type: 'text', text: text || '[ราคา + ภาพ]' },
              ...imageMessages
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

        if (m.type === 'image' && env.IMAGE_GROUP_ID && chatId === env.IMAGE_GROUP_ID) {
          const imagePayload = {
            source: 'line_group_image',
            intent: 'group_image',
            groupId: chatId,
            userId: ev?.source?.userId || null,
            imageMessageId: m.id || null,
            timestamp: new Date().toISOString(),
            event: ev
          };

          if (env.n8n_slip_receipt_ledger) {
            ctx.waitUntil(
              notifyN8nGroupImage(env, imagePayload).catch((err) => console.error('group_image webhook failed', err))
            );
          } else {
            console.warn('IMAGE_GROUP_ID set but n8n_slip_receipt_ledger is missing');
          }

          if (replyToken) {
            await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [
              { type: 'text', text: '📸 ส่งรูปเข้า workflow แล้ว' }
            ]).catch(console.error);
          }

          continue;
        }

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
          const textIn = (m.text || '').trim();
          const chatId = getChatId(ev);
          const stateKey = getStateKey(ev);
          const userId = ev?.source?.userId || '';

          if (isOwnerGroupChat(env, chatId) && /โหมดคัดกรอง/i.test(textIn)) {
            const msg = {
              type: 'template',
              altText: 'สวิตช์โหมดคัดกรอง',
              template: {
                type: 'buttons',
                text: 'สวิตช์โหมดคัดกรอง (ถามก่อนส่งลิงก์จอง)',
                actions: [
                  { type: 'postback', label: '✅ เปิด', data: 'act=CFG_SCREEN_ON' },
                  { type: 'postback', label: '❌ ปิด', data: 'act=CFG_SCREEN_OFF' },
                  { type: 'postback', label: '📌 เช็คสถานะ', data: 'act=CFG_SCREEN_STATUS' }
                ]
              }
            };
            await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [msg]).catch(console.error);
            continue;
          }

          const coAdminShortcut = parseCoAdminShortcut(textIn);
          if (coAdminShortcut) {
            if (userId !== CO_ADMIN_ALLOWED_LINE_USER_ID) {
              console.log('co_admin_unauthorized', { userId, text: textIn.slice(0, 80) });
              continue;
            }

            const payload = {
              source: 'line_message',
              intent: 'co_admin_shortcut',
              shortcutType: coAdminShortcut.type,
              roomId: coAdminShortcut.roomId,
              outcome: coAdminShortcut.outcome,
              command: coAdminShortcut.normalizedCommand,
              text: textIn,
              lineUserId: userId || null,
              chatId: chatId || null,
              sourceType: ev?.source?.type || null,
              replyToken: replyToken || null,
              eventId: ev?.webhookEventId || null,
              receivedAt: new Date().toISOString()
            };

            const webhookOk = await notifyN8nCoAdminWebhook(env, payload);
            const ackText = webhookOk
              ? `Command received: ${coAdminShortcut.normalizedCommand}`
              : 'Command received, but webhook failed';

            if (replyToken) {
              await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [
                { type: 'text', text: ackText }
              ]).catch(console.error);
            } else if (chatId) {
              ctx.waitUntil(linePushText(env.LINE_ACCESS_TOKEN, chatId, ackText).catch(console.error));
            }
            continue;
          }

          // --- Registration Flow State ---
          const regKey = userId ? 'reg_id:' + userId : '';
          const regState = userId ? await kvGet(env, regKey) : null;
          if (regState && regState.action === 'ask_roomid') {
            // Allow cancel
            if (textIn === 'ยกเลิก' || textIn === 'cancel') {
              await kvDel(env, regKey);
              await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [{ type: 'text', text: 'ยกเลิกการลงทะเบียนแล้วค่ะ' }]).catch(console.error);
              continue;
            }

            const normalized = textIn.toUpperCase().replace(/\s+/g, '');
            const isMatch = /^([AB])(\d{3,4})$/.test(normalized);

            if (isMatch) {
              const webhookUrl = 'https://n8n.srv1112305.hstgr.cloud/webhook/GetLineUserId';
              ctx.waitUntil(
                fetch(webhookUrl, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ lineUserId: userId, replyToken, text: textIn, roomId: normalized, action: 'save_mapping' })
                }).catch(err => console.error('GetLineUserId mapping failed', err))
              );
              await kvDel(env, regKey);
              await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [
                { type: 'text', text: `ลงทะเบียนห้อง ${normalized} เรียบร้อยแล้วค่ะ` }
              ]).catch(console.error);
              continue;
            } else {
              await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [
                { type: 'text', text: 'รูปแบบไม่ถูกต้อง กรุณาพิมพ์เลขห้องของคุณ เช่น A102 หรือ B514 (หรือพิมพ์ "ยกเลิก")' }
              ]).catch(console.error);
              continue;
            }
          }

          const changeLineKey = userId ? TENANT_CHANGE_KEY_PREFIX + userId : '';
          const changeLineState = userId ? await kvGet(env, changeLineKey) : null;
          const fridgeIntent = detectFridgeIntent(textIn);
          const parkingServiceKeyword = isParkingIntent(textIn);
          const checkinRoomCode = parseCheckinCommand(textIn);
          const isPaymentMenuBypass = /^\s*จ่ายเงินมามาแมนชั่น\s*$/i.test(textIn);
          const isPaymentMenu = isPaymentMenuBypass || /^\s*จ่ายเงินมามาแมนชั่น\s*$/i.test(textIn);
          const presetOtherPaymentReason =
            /^\s*จ่ายค่าเช่าที่จอดรถ\s*$/i.test(textIn)
              ? 'CAR'
              : (
                /^\s*(จ่ายเงินค่ายืมกุญแจ|จ่ายเงินค่าเช่ากุญแจ|จ่ายค่าเช่ากุญแจ)\s*$/i.test(textIn)
                  ? 'KEY_RENT'
                  : (
                    /^\s*(จ่ายเงินค่าลืมกุญแจ|จ่ายเงินค่าลืมคีย์การ์ด|จ่ายเงินค่ากุญแจหาย)\s*$/i.test(textIn)
                      ? 'KEY_FORGOT'
                      : null
                  )
              );
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
          const armOtherPaymentSlipFlow = (reasonText) => {
            const normalizedReason = normalizePenaltyReason(reasonText || '');
            return kvPut(
              env,
              penaltyKey,
              {
                ts: Date.now(),
                chatId,
                userId,
                type: 'Others_payment',
                reason: normalizedReason || reasonText || 'ค่าอื่นๆ'
              },
              PENALTY_FLOW_TTL_SECONDS
            );
          };
          const startKeyRentPayment = async (keyRent, rawTextOverride) => {
            const keyRentFlowKey = stateKey + ':keyrent_flow';
            const flow = {
              keyRent: {
                ...keyRent,
                rawText: rawTextOverride || keyRent?.rawText || textIn
              },
              userId: userId || null,
              chatId: chatId || null,
              sourceType: ev?.source?.type || null,
              messageId: m?.id || null,
              receivedAt: new Date().toISOString(),
              ts: Date.now()
            };
            ctx.waitUntil(kvPut(env, keyRentFlowKey, flow, KEY_RENT_FLOW_TTL_SECONDS));

            const paymentMsg = buildKeyRentPaymentMessage(flow.keyRent);
            if (replyToken) {
              await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [paymentMsg]).catch(console.error);
            } else if (chatId) {
              ctx.waitUntil(linePush(env.LINE_ACCESS_TOKEN, chatId, [paymentMsg]).catch(console.error));
            }
          };
          const submitKeyForgot = async (keyForgotPayload, rawTextOverride, penaltyReasonOverride) => {
            const timestamp = new Date().toISOString();
            const payload = {
              ...keyForgotPayload,
              text: rawTextOverride || textIn,
              userId: userId || null,
              chatId: chatId || null,
              sourceType: ev?.source?.type || null,
              messageId: m?.id || null,
              receivedAt: timestamp
            };
            ctx.waitUntil(
              notifyN8nKeyForgotWebhook(env, payload).catch((err) => console.error('key forgot webhook failed', err))
            );
            ctx.waitUntil(armOtherPaymentSlipFlow(penaltyReasonOverride || 'KEY_FORGOT'));

            const ackText = [
              `ส่งข้อมูลคีย์ตึก ${keyForgotPayload.building} ห้อง ${keyForgotPayload.room} จำนวน ${keyForgotPayload.amount} ให้เจ้าหน้าที่แล้วค่ะ`,
              'หากชำระแล้ว กรุณาส่งสลิปในแชตนี้ได้เลยค่ะ'
            ].join('\n');
            if (replyToken) {
              await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [{ type: 'text', text: ackText }]).catch(console.error);
            } else if (chatId) {
              ctx.waitUntil(linePushText(env.LINE_ACCESS_TOKEN, chatId, ackText).catch(console.error));
            }
          };
          // While waiting for penalty reason, treat the next text as reason first.
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
              reason: normalizePenaltyReason(reason),
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

          if (presetOtherPaymentReason) {
            ctx.waitUntil(kvDel(env, payRentKey));
            ctx.waitUntil(armOtherPaymentSlipFlow(presetOtherPaymentReason));
            const askSlip = `บันทึกรายการ${presetOtherPaymentReason}แล้ว โปรดส่งสลิปได้เลยค่ะ`;
            if (replyToken) {
              await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [{ type: 'text', text: askSlip }]).catch(console.error);
            } else if (chatId) {
              ctx.waitUntil(linePushText(env.LINE_ACCESS_TOKEN, chatId, askSlip).catch(console.error));
            }
            continue;
          }

          if (/^\s*(?:ขอ)?เช่าชุดกุญแจ\s*$/i.test(textIn)) {
            const messages = [
              { type: 'text', text: buildKeyRentStartInstructionText(env) },
              buildKeyRentStartOptionsMessage()
            ];
            if (replyToken) {
              await lineReply(env.LINE_ACCESS_TOKEN, replyToken, messages).catch(console.error);
            } else if (chatId) {
              ctx.waitUntil(linePush(env.LINE_ACCESS_TOKEN, chatId, messages).catch(console.error));
            }
            continue;
          }

          const keyRent = parseKeyRent(textIn);
          const keyForgot = parseKeyKeyword(textIn); // simple "key A101 20" legacy path

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

            await startKeyRentPayment(keyRent, textIn);
            continue;
          }

          if (keyForgot) {
            await submitKeyForgot(keyForgot, textIn);
            continue;
          }

          if (/^\s*เปลี่ยนไอดีผู้เช่า\s*$/i.test(textIn)) {
            if (userId) {
              await kvPut(env, changeLineKey, { state: WAIT_ROOM_STATE, ts: Date.now(), chatId, userId });
            }
            notifyTenantChange('tenant_id_change_request');
            await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [
              { type: 'text', text: 'ได้รับคำขอเปลี่ยนไอดีผู้เช่าแล้ว กำลังส่งเรื่องให้เจ้าหน้าที่ค่ะ' }
            ]).catch(console.error);
            continue;
          }

          if (textIn === 'ลงทะเบียนไอดี') {
            // Set state to wait for Room ID
            if (userId) {
              await kvPut(env, 'reg_id:' + userId, { action: 'ask_roomid', ts: Date.now() }, 600); // 10 min TTL
            }

            await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [
              { type: 'text', text: '✅ รับทราบครับ\nกรุณาพิมพ์เลขห้องของคุณ เช่น A102 หรือ B514' }
            ]).catch(console.error);
            continue;
          }


          // (A) Magic link (แจ้งออก) → forward to GAS to issue token + send link
          if (/^\s*(แจ้งออก)\s*$/i.test(textIn)) {
            // quick acknowledge so user sees immediate response
            await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [
              { type: 'text', text: 'กำลังสร้างลิงก์แจ้งออกให้คุณ… กรุณารอสักครู่' }
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
              parkingPlanTextMessage(),
              parkingButtonsMessage(commonOptions)
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
              { type: 'text', text: 'รับรหัสห้องแล้วค่ะ เจ้าหน้าที่แจ้งกลับให้เร็วที่สุด' }
            ]).catch(console.error);
            continue;
          }

          if (OWNER_APPROVAL_KEYWORD_RE.test(textIn)) {
            const intent = textIn.trim().startsWith('ไม่') ? 'tenant_id_change_reject' : 'tenant_id_change_approve';
            notifyTenantChange(intent);
            await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [
              { type: 'text', text: 'ส่งสถานะไปยังเจ้าหน้าที่เรียบร้อยแล้วค่ะ' }
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
          const fast = await quickKeywordReply(textIn, env, userId);
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

          // (Booking) Forward booking-code texts directly to reservation GAS (let GAS own state/flow)
          if (/^#?\s*MM\d{3,}$/i.test(textIn)) {
            const resvUrl = getReservationGas(env);
            if (resvUrl) {
              const bookingCode = extractBookingCode(textIn);
              const ackMsg = bookingCode
                ? `รับรหัสจอง ${bookingCode} แล้วค่ะ กำลังตรวจสอบให้ทันที`
                : 'รับรหัสจองแล้วค่ะ กำลังตรวจสอบให้ทันที';
              if (replyToken) {
                await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [
                  { type: 'text', text: ackMsg }
                ]).catch(console.error);
              } else if (chatId) {
                ctx.waitUntil(linePushText(env.LINE_ACCESS_TOKEN, chatId, ackMsg).catch(console.error));
              }
              ctx.waitUntil(forwardToSpecificGas(env, resvUrl, { events: [ev] }));
              continue;
            }
          }

          // (E) Label → act mapping
          const mappedAct =
            ROOM_LABEL_MAP[textIn] ? ROOM_LABEL_MAP[textIn] :
              FIX_LABEL_MAP[textIn] ? FIX_LABEL_MAP[textIn] :
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

            const expireText = formatTimeBangkok(new Date(expiresAt));
            const instantAck = [
              `รับรหัสจอง ${bookingCode} แล้ว`,
              `โปรดส่งสลิปภายใน 60 นาที (หมดอายุ ${expireText})`
            ].join('\n');
            // Always respond immediately so the user never sees silence
            if (replyToken) {
              await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [{ type: 'text', text: instantAck }]).catch(console.error);
            } else if (chatId) {
              ctx.waitUntil(linePushText(env.LINE_ACCESS_TOKEN, chatId, instantAck).catch(console.error));
            }

            let ackSent = false;
            let ackError = '';
            let ackResp: any = null;
            try {
              const resp = await reservationAdminCallWithAuthGuard(env, 'reservation_ack', {
                reservation_id: bookingCode.replace(/^#/, ''),
                line_user_id: userId || undefined
              });
              ackResp = resp;
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
              const status = (ackResp && ackResp.data && ackResp.data.status) || '';
              const err = (ackResp && ackResp.data && ackResp.data.error) || '';
              const statusLabel = status || err || 'ไม่พร้อมใช้งาน';
              const msg = `รหัสนี้ไม่สามารถใช้งานได้ (สถานะ: ${statusLabel})`;
              if (chatId) {
                ctx.waitUntil(linePushText(env.LINE_ACCESS_TOKEN, chatId, msg).catch(console.error));
              } else if (replyToken) {
                await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [{ type: 'text', text: msg }]).catch(console.error);
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
            const key = stateKey + ':moveout_flow';
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

          // Booking flow: forward booking images directly to reservation GAS (GAS owns slip/ID flow)
          {
            const resvUrl = getReservationGas(env);
            if (resvUrl) {
              ctx.waitUntil(forwardToSpecificGas(env, resvUrl, { events: [ev] }));
              continue;
            }
          }

          // Booking flow gates (slip -> ID)
          const bookingFlowKey = buildBookingFlowKey(ev?.source?.userId, chatId);
          const bookingFlow = await kvGet(env, bookingFlowKey);

          if (bookingFlow && bookingFlow.phase) {
            const phase = bookingFlow.phase || 'await_slip';
            const age = Date.now() - (bookingFlow.ts || 0);
            const ttlMs = (phase === 'await_id' || phase === 'confirm_id') ? BOOKING_ID_TTL_MS : BOOKING_SLIP_TTL_MS;
            const expired = age > ttlMs;

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
                  ? 'ไม่สามารถบันทึกสลิปได้ (สิทธิ์ไม่ผ่าน) แจ้งเจ้าหน้าที่ตั้งค่า ADMIN_API_KEY ให้ตรงกันแล้วลองอีกครั้งค่ะ'
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
                  ? 'ไม่สามารถบันทึกไฟล์บัตรได้ (สิทธิ์ไม่ผ่าน) แจ้งเจ้าหน้าที่ตั้งค่า ADMIN_API_KEY ให้ตรงกันแล้วลองอีกครั้งค่ะ'
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
  'ขนาด/เลย์เอาต์': 'ROOM_SIZE', 'เฟอร์นิเจอร์': 'ROOM_FURNITURE', 'เครื่องใช้ไฟฟ้า': 'ROOM_APPLIANCE',
  'ค่าเช่า': 'ROOM_RENT', 'ค่าน้ำ-ไฟ/เน็ต': 'ROOM_UTIL', 'เงินประกัน/สัญญา': 'ROOM_DEPOSIT',
  'ที่จอดรถ': 'ROOM_PARKING', 'เข้าอยู่เร็วสุด': 'ROOM_EARLIEST'
};
const FIX_LABEL_MAP = {
  'น้ำ/ท่อรั่ว': 'FIX_WATER', 'ไฟ/ปลั๊ก/เบรกเกอร์': 'FIX_ELECTRIC', 'แอร์ไม่เย็น/น้ำหยด': 'FIX_AC',
  'ห้องน้ำ/สุขภัณฑ์': 'FIX_BATH', 'ประตู/กุญแจ': 'FIX_DOOR', 'เฟอร์นิเจอร์/อุปกรณ์': 'FIX_FURN',
  'กลิ่น/เสียงรบกวน': 'FIX_SMELL', 'อื่น ๆ': 'FIX_OTHER'
};
function isRoomAct(a) { return typeof a === 'string' && a.startsWith('ROOM_'); }
function isFixAct(a) { return typeof a === 'string' && a.startsWith('FIX_'); }
function isResAct(a) { return typeof a === 'string' && a.startsWith('RES_'); }
function normalizePenaltyReason(reason) {
  const text = (reason || '').trim();
  if (!text) return text;

  const compact = text
    .toLowerCase()
    .replace(/[^a-z0-9ก-๙]/g, '')
    .replace(/เเ/g, 'แ');

  const hasKeyWord =
    compact.includes('กุญแจ') ||
    compact.includes('คีย์การ์ด') ||
    compact.includes('keycard') ||
    compact.includes('key');
  const hasForgotOrLostWord =
    compact.includes('ลืม') ||
    compact.includes('หาย') ||
    compact.includes('ทำหาย');

  // Keep normal reason text for forgot/lost-key intents (e.g. "ลืมกุญแจ").
  if (hasKeyWord && hasForgotOrLostWord) return text;

  const rentKeyPatterns = [
    'เช่ากุญแจ',
    'เช่าชุดกุญแจ',
    'เช่าคีย์การ์ด',
    'ค่าเช่ากุญแจ',
    'ค่าเช่าชุดกุญแจ',
    'ค่าเช่าคีย์การ์ด',
    'rentkey',
    'rentkeycard',
    'rentkeyset',
    'keyrent'
  ];
  const isRentKeyReason = rentKeyPatterns.some((pattern) => compact.includes(pattern));

  if (isRentKeyReason) return 'KEY_RENT';
  return text;
}
/* =========================================
 * 6) Message builders
 * ========================================= */
function roomDetailByKey(key) {
  const map = {
    ROOM_SIZE: `[ขนาด/เลย์เอาต์]
• Standard: ~22 ตร.ม. ระเบียง
• Corner Plus: ~23 ตร.ม. หน้าต่างมุม + ระเบียง
• Starter: ~22 ตร.ม. ระเบียง`,
    ROOM_FURNITURE: `[เฟอร์นิเจอร์]
🛏️เตียง 5 ฟุต + ที่นอน
🚪ตู้เสื้อผ้า
🪑โต๊ะทำงาน + เก้าอี้
🪟ผ้าม่าน`,
    ROOM_APPLIANCE: `[เครื่องใช้ไฟฟ้า]
❄️แอร์, เครื่องทำน้ำอุ่น
ตู้เย็น 200 บาท/เดือน`,
    ROOM_RENT: `[ค่าเช่า]
• Standard (เฟอร์ครบ): 4,000 บ./ด.
• Corner Plus (เฟอร์ครบ): 4,500 บ./ด.
• Starter (ไม่มีเฟอร์): 3,800 บ./ด.`,
    ROOM_UTIL: `[ค่าน้ำ-ไฟ/เน็ต]
น้ำ 18 | ไฟ 8 
🛜เน็ต: ฟรี`,
    ROOM_RENT_IMG: `[เรทราคา + ภาพ]`,   // 👈 new entry
    ROOM_DEPOSIT: `[เงินประกัน/สัญญา]
สัญญาขั้นต่ำ 1 ปี
หากต้องการเช่า 6 เดือน เพิ่มค่าเช่า 200 บ./เดือน
(รายละเอียดเงินประกัน/ล่วงหน้า ระบุในวันทำสัญญา)`,
    ROOM_PARKING: `[ที่จอดรถ]
🚗ลูกหอ 800 บาท/เดือน (เช่าต่อเนื่องเกิน 3 เดือน)
หากเช่าไม่ต่อเนื่อง คิดค่าบริการ 200 บาท/ครั้ง
🚗บุคคลภายนอก 1,000 บาท/เดือน
🏍️มอเตอร์ไซต์ฟรี`,
    ROOM_EARLIEST: `[เข้าอยู่เร็วสุด]
    ชำระครบเต็มจำนวนแล้วสามารถเข้าอยู่ได้
    และต้องเข้าอยู่ภายใน 7 วันจากวันที่ระบุว่าว่างในเว็บไซต์จองห้อง

(เช็กห้องว่างได้ที่ “วิธีจอง”)`
  };
  return map[key] || 'เลือกรายละเอียดหัวข้อจาก Quick Reply ได้ค่ะ';
}
function fixDetailByKey(key) {
  const map = {
    FIX_WATER: '[น้ำ/ท่อรั่ว]\nปิดวาล์วน้ำชั่วคราว (ถ้าเข้าถึงได้) และถ่ายรูปจุดรั่ว แจ้งเลขห้อง+เวลาสะดวก ทีมช่างจะนัดเข้าซ่อมครับ/ค่ะ',
    FIX_ELECTRIC: '[ไฟฟ้า/ระบบไฟ]\nปลั๊กหรือไฟดับ? แจ้งเลขห้องพร้อมอธิบายอาการครับ/ค่ะ',
    FIX_OTHER: '[อื่น ๆ]\nเพิ่มเติมรายละเอียดให้เรา เพื่อจัดการได้เร็วขึ้น'
  };
  return map[key] || 'เลือกหัวข้อจาก Quick Reply ได้เลยครับ/ค่ะ';
}

function resDetailByKey(key) {
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
  const action = String(payload?.action || '').trim().toUpperCase();
  const url = getRenewalPostbackWebhookUrl(env, action);
  if (!url) {
    console.warn('notifyN8nRenewalPostback: missing webhook URL', { action });
    return false;
  }

  try {
    const headers = { 'Content-Type': 'application/json' };
    const secret = String(env.WORKER_SECRET || env.MM_WORKER_SECRET || '').trim();
    if (secret) {
      headers['x-worker-secret'] = secret;
    }

    const res = await fetch(url, {
      method: 'POST',
      headers,
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
        const out = {};
        for (const [key, value] of Object.entries(parsed)) {
          if (!key) continue;
          out[key] = String(value ?? '');
        }
        if (Object.keys(out).length > 0) {
          return out;
        }
      }
    } catch (err) {
      console.warn('parsePostbackData JSON parse failed', err);
    }
  }

  const pipeIndex = input.indexOf('|');
  if (pipeIndex > 0 && pipeIndex < input.length - 1) {
    const eventType = input.slice(0, pipeIndex).trim();
    const rhsRaw = input.slice(pipeIndex + 1).trim();
    const rhs = rhsRaw.startsWith('?') ? rhsRaw.slice(1) : rhsRaw;

    if (eventType && rhs) {
      try {
        const parsed = parseKv(rhs);
        const out = {};
        for (const [key, value] of Object.entries(parsed)) {
          if (!key) continue;
          if (Array.isArray(value)) {
            out[key] = String(value[value.length - 1] || '');
          } else {
            out[key] = String(value ?? '');
          }
        }
        out.eventType = eventType;
        out.postbackType = eventType;
        if ((eventType === 'renewal_reply' || eventType === 'renewal_followup' || eventType === 'renewal_admin') && !out.action && out.ans) {
          out.action = String(out.ans);
        }
        if ((eventType === 'renewal_reply' || eventType === 'renewal_followup' || eventType === 'renewal_admin') && !out.td && out.trig) {
          out.td = String(out.trig);
        }
        if (Object.keys(out).length > 0) {
          return out;
        }
      } catch (err) {
        console.warn('parsePostbackData pipe format parse failed', err);
      }
    }
  }

  const qs = input.startsWith('?') ? input.slice(1) : input;
  try {
    const parsed = parseKv(qs);
    const out = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (!key) continue;
      if (Array.isArray(value)) {
        out[key] = String(value[value.length - 1] || '');
      } else {
        out[key] = String(value ?? '');
      }
    }
    if (Object.keys(out).length > 0) {
      return out;
    }
  } catch (err) {
    console.warn('parsePostbackData parseKv failed', err);
  }

  try {
    const params = new URLSearchParams(qs);
    const out = {};
    for (const [key, value] of params.entries()) {
      if (!key) continue;
      out[key] = String(value ?? '');
    }
    if (Object.keys(out).length > 0) {
      return out;
    }
  } catch (err) {
    console.warn('parsePostbackData URLSearchParams failed', err);
  }

  return {};
}

function normalizeManagerDecision(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (!normalized) return '';
  if (['APPROVE', 'APPROVED', 'YES', 'Y', 'ALLOW', 'OK'].includes(normalized)) return 'APPROVE';
  if (['REJECT', 'REJECTED', 'NO', 'N', 'DENY', 'DECLINE'].includes(normalized)) return 'REJECT';
  if (['HOLD', 'WAIT', 'PENDING', 'UNDECIDED'].includes(normalized)) return 'HOLD';
  return normalized;
}

function buildRenewalPostbackMeta(data, ev, act = '') {
  const pickFirst = (value) => Array.isArray(value) ? value[0] : value;
  const normalize = (value) => {
    if (value === undefined || value === null) return '';
    return String(pickFirst(value) || '').trim();
  };

  const room = normalize(data.room || data.roomId || data.r);
  const end = normalize(data.contractEnd || data.end || data.endDate || data.checkout);
  const inq = normalize(data.inq || data.inquiry || data.inquiryId || data.renewalId || data.renewalRecordId);
  const actionField = normalize(data.action);
  const actionFieldLower = actionField.toLowerCase();
  const renewalActionFieldIsEventType =
    actionFieldLower === 'renewal_reply' ||
    actionFieldLower === 'renewal_followup' ||
    actionFieldLower === 'renewal_admin';
  const renewalEventType = normalize(
    data.eventType ||
    data.postbackType ||
    (renewalActionFieldIsEventType ? actionField : '')
  ).toLowerCase();
  const isRenewalPipeEvent =
    renewalEventType === 'renewal_reply' ||
    renewalEventType === 'renewal_followup';
  const isRenewalAdminEvent = renewalEventType === 'renewal_admin';
  const isManagerDecisionEvent =
    actionFieldLower === 'manager_renewal_decision' ||
    renewalEventType === 'manager_renewal_decision';
  const renewalAnswer = normalize(data.ans || data.answer);
  const decisionRaw = normalize(data.decision || data.dec);
  const managerDecision = normalizeManagerDecision(decisionRaw);
  const isRenewalAliasPayload =
    !!inq ||
    act === 'renew_decision' ||
    renewalActionFieldIsEventType ||
    isRenewalPipeEvent ||
    isRenewalAdminEvent ||
    isManagerDecisionEvent;
  const actionRaw = normalize(
    isManagerDecisionEvent
      ? managerDecision
      : (
        (renewalActionFieldIsEventType ? '' : actionField) ||
        (isRenewalAliasPayload ? renewalAnswer : data.act)
      )
  );
  const action = actionRaw.toUpperCase();
  const actionType = isManagerDecisionEvent
    ? 'MANAGER_DECISION'
    : (
      renewalEventType === 'renewal_reply' ||
      renewalEventType === 'renewal_followup' ||
      actionFieldLower === 'renewal_reply' ||
      action === 'CONTINUE' ||
      action === 'LEAVE' ||
      action === 'UNDECIDED' ||
      action === 'RENEWAL_ACCEPT_TERMS' ||
      action === 'RENEWAL_ASK_MORE' ||
      action === 'LEAVE_PICK_CHECKOUT' ||
      action === 'SIGN_SLOT' ||
      action === 'SIGN_ASK_ADMIN'
        ? 'TENANT_RENEWAL_REPLY'
        : ''
    );
  const td = normalize(data.td || data.triggerDay || data.trig || ((act === 'renew_decision' || isRenewalPipeEvent) ? data.trig : ''));
  const eventId = normalize(data.eventId || data.eid);
  const slotKey = normalize(data.slotKey);
  const slotStart = normalize(data.slotStart);
  const slotEnd = normalize(data.slotEnd);
  const actorUserId = ev?.source?.userId || '';
  const payloadUserId = normalize(data.userId || data.lineUserId || data.uid);
  const renewalUserId = payloadUserId || actorUserId;
  const sourceType = String(ev?.source?.type || '');
  const groupId = String(ev?.source?.groupId || '');
  const lineRoomId = String(ev?.source?.roomId || '');
  const chatId = getChatId(ev);
  const normalizedEventType = renewalEventType || (isRenewalAdminEvent ? 'renewal_admin' : (isManagerDecisionEvent ? 'manager_renewal_decision' : ''));
  const managerDecisionBy = normalize(actorUserId || renewalUserId);
  const managerChatId = normalize(chatId || groupId || lineRoomId || renewalUserId);

  return {
    room,
    end,
    inq,
    actionField,
    actionFieldLower,
    renewalEventType,
    normalizedEventType,
    renewalAnswer,
    decisionRaw,
    managerDecision,
    actionType,
    actionRaw,
    action,
    td,
    eventId,
    slotKey,
    slotStart,
    slotEnd,
    actorUserId,
    payloadUserId,
    renewalUserId,
    sourceType,
    groupId,
    lineRoomId,
    chatId,
    managerDecisionBy,
    managerChatId,
    isRenewalPipeEvent,
    isRenewalAdminEvent,
    isManagerDecisionEvent
  };
}

async function moveoutTextGate(env, stateKey, textIn, replyToken) {
  // Fallback implementation: forward all handling to GAS by returning false.
  // Existing MOVEOUT flows handled in GAS will continue to work.
  return false;
}

function leadQuestion(step) {
  const mk = (label, q, v) => ({
    type: 'action',
    action: {
      type: 'postback',
      label,
      data: `act=LEAD_A&q=${encodeURIComponent(q)}&v=${encodeURIComponent(v)}`,
      displayText: label
    }
  });

  if (step === 1) {
    return {
      type: 'text',
      text: '1) ต้องการย้ายเข้าเมื่อไหร่ครับ?',
      quickReply: {
        items: [
          mk('ภายใน 3 วัน', 'movein', 'IN3'),
          mk('ภายใน 7 วัน', 'movein', 'IN7'),
          mk('ภายในเดือนนี้', 'movein', 'IN30'),
          mk('ยังไม่แน่ใจ', 'movein', 'UNSURE')
        ]
      }
    };
  }
  if (step === 2) {
    return {
      type: 'text',
      text: '2) อยู่กี่คนครับ?',
      quickReply: {
        items: [
          mk('1 คน', 'people', '1'),
          mk('2 คน', 'people', '2'),
          mk('มากกว่า 2', 'people', '3PLUS')
        ]
      }
    };
  }
  if (step === 3) {
    return {
      type: 'text',
      text: '3) สถานะปัจจุบันครับ',
      quickReply: {
        items: [
          mk('นักเรียน/นักศึกษา', 'status', 'STUDENT'),
          mk('ทำงานประจำ', 'status', 'WORK'),
          mk('ทำงานกะ/กลางคืน', 'status', 'SHIFT'),
          mk('อื่นๆ', 'status', 'OTHER')
        ]
      }
    };
  }
  if (step === 4) {
    return {
      type: 'text',
      text: '4) มียานพาหนะไหมครับ?',
      quickReply: {
        items: [
          mk('ไม่มี', 'vehicle', 'NONE'),
          mk('มอเตอร์ไซค์', 'vehicle', 'MOTO'),
          mk('รถยนต์', 'vehicle', 'CAR')
        ]
      }
    };
  }
  if (step === 5) {
    return {
      type: 'text',
      text: '5) ตั้งใจอยู่ประมาณกี่เดือน/กี่ปีครับ?',
      quickReply: {
        items: [
          mk('6 เดือน', 'stay', '6M'),
          mk('1 ปี', 'stay', '1Y'),
          mk('มากกว่า 1 ปี', 'stay', '1YPLUS')
        ]
      }
    };
  }
  return null;
}

async function quickKeywordReply(text, env, userId) {
  const normalized = (text || '').trim();
  if (!normalized) return null;

  if (isRoomVisitIntent(normalized)) {
    return [{ type: 'text', text: ROOM_VISIT_REPLY_TEXT }];
  }

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
      '',
      '🏢 แยกตามชั้น (เลขท้ายคือชั้นของห้อง)',
      '',
      '🅰️ ตึก A',
      '📶 ชื่อเครือข่าย: MAMA_2.4G_FL1–MAMA_2.4G_FL5 (5G รูปแบบเดียวกัน)',
      '🔑 รหัส: 5021150660',
      '',
      '🅱️ ตึก B',
      '📶 ชื่อเครือข่าย: mama mansion_B_2.4G1–mama mansion_B_2.4G5 (5G รูปแบบเดียวกัน)',
      '🔑 รหัส: 22222222'
    ].join('\n');

    return [{ type: 'text', text: wifiText }];
  }
  if (wantsParkingInfo && !isUrgent) {
    return [
      parkingPlanTextMessage(),
      parkingButtonsMessage({ lineUserId: userId || null })
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
    const enabled = await getScreeningEnabled(env);
    if (enabled) {
      const lead = userId ? await getLead(env, userId) : null;
      if (lead && lead.status === 'SUBMITTED') {
        return [
          { type: 'text', text: 'รับข้อมูลเรียบร้อยแล้วครับ ✅ เดี๋ยวแอดมินติดต่อกลับใน LINE ครับ' }
        ];
      }
      if (lead && lead.status === 'IN_PROGRESS' && lead.step) {
        const nextQuestion = leadQuestion(lead.step);
        if (nextQuestion) {
          return [nextQuestion];
        }
      }
      return [
        {
          type: 'text',
          text: 'ก่อนส่งลิงก์จอง ขออนุญาตถามสั้นๆ 5 ข้อเพื่อจัดห้องให้เหมาะที่สุดครับ 😊',
          quickReply: {
            items: [
              { type: 'action', action: { type: 'postback', label: 'เริ่มตอบคำถาม ✅', data: 'act=LEAD_START', displayText: 'เริ่มตอบคำถาม' } },
              { type: 'action', action: { type: 'postback', label: 'ยกเลิก', data: 'act=LEAD_CANCEL', displayText: 'ยกเลิก' } }
            ]
          }
        }
      ];
    }

    return [
      {
        type: 'text',
        text: 'Please answer right now: the room is almost full. Please contact admin directly to ask for room available.'
      }
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
      { label: 'ภาพ + เรทราคา', act: 'ROOM_RENT_IMG' },
      { label: 'ค่าน้ำ-ไฟ/เน็ต', act: 'ROOM_UTIL' },
      { label: 'ที่จอดรถ', act: 'ROOM_PARKING' },
      { label: 'ขนาด/เลย์เอาต์', act: 'ROOM_SIZE' },
      { label: 'เฟอร์นิเจอร์', act: 'ROOM_FURNITURE' },
      { label: 'เครื่องใช้ไฟฟ้า', act: 'ROOM_APPLIANCE' },
      { label: 'ค่าเช่า', act: 'ROOM_RENT' },
      { label: 'เงินประกัน/สัญญา', act: 'ROOM_DEPOSIT' },
      { label: 'เข้าอยู่เร็วสุด', act: 'ROOM_EARLIEST' }
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
    const enabled = await getScreeningEnabled(env);
    if (enabled) {
      const lead = userId ? await getLead(env, userId) : null;
      if (lead && lead.status === 'SUBMITTED') {
        return [
          { type: 'text', text: 'รับข้อมูลเรียบร้อยแล้วครับ ✅ เดี๋ยวแอดมินติดต่อกลับใน LINE ครับ' }
        ];
      }
      if (lead && lead.status === 'IN_PROGRESS' && lead.step) {
        const nextQuestion = leadQuestion(lead.step);
        if (nextQuestion) {
          return [nextQuestion];
        }
      }
      return [
        {
          type: 'text',
          text: 'ก่อนส่งลิงก์จอง ขออนุญาตถามสั้นๆ 5 ข้อเพื่อจัดห้องให้เหมาะที่สุดครับ 😊',
          quickReply: {
            items: [
              { type: 'action', action: { type: 'postback', label: 'เริ่มตอบคำถาม ✅', data: 'act=LEAD_START', displayText: 'เริ่มตอบคำถาม' } },
              { type: 'action', action: { type: 'postback', label: 'ยกเลิก', data: 'act=LEAD_CANCEL', displayText: 'ยกเลิก' } }
            ]
          }
        }
      ];
    }

    const bookingUrl = String((env?.BOOKING_URL || '').trim() || 'https://mm-v2.pages.dev/#reservation');
    const bookingStepsText = [
      '[📅 วิธีจองห้องพัก]',
      '',
      `1) เข้า “ระบบจอง” ที่ลิงก์นี้: ${bookingUrl}`,
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
      text: 'มีให้เช่าเดือนละ 250 บาท / month',
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
  const optionCard = (title, description, text, accentColor) => ({
    type: 'box',
    layout: 'vertical',
    spacing: 'xs',
    paddingAll: '14px',
    cornerRadius: '16px',
    backgroundColor: '#F8FAFC',
    borderWidth: '1px',
    borderColor: '#D9E2F2',
    action: { type: 'message', label: title, text },
    contents: [
      {
        type: 'text',
        text: title,
        weight: 'bold',
        size: 'md',
        color: '#0F172A'
      },
      {
        type: 'text',
        text: description,
        wrap: true,
        size: 'sm',
        color: '#475569'
      },
      {
        type: 'text',
        text: 'แตะเพื่อเริ่ม',
        size: 'xs',
        color: accentColor,
        weight: 'bold'
      }
    ]
  });

  return {
    type: 'flex',
    altText: 'เลือกประเภทการชำระเงิน',
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          {
            type: 'box',
            layout: 'vertical',
            spacing: 'xs',
            contents: [
              {
                type: 'text',
                text: 'เลือกประเภทการชำระเงิน',
                weight: 'bold',
                size: 'xl',
                color: '#0F172A'
              },
              {
                type: 'text',
                text: 'เริ่มจากหมวดที่ตรงกับรายการที่ต้องการชำระ เพื่อให้บอทพาไปขั้นตอนถัดไปได้ตรงขึ้น',
                wrap: true,
                size: 'sm',
                color: '#475569'
              }
            ]
          },
          {
            type: 'box',
            layout: 'vertical',
            spacing: 'sm',
            margin: 'md',
            contents: [
              {
                type: 'text',
                text: 'ค่าห้องและค่าใช้จ่ายทั่วไป',
                size: 'sm',
                weight: 'bold',
                color: '#1E3A8A'
              },
              optionCard('ชำระค่าเช่า', 'ส่งสลิปค่าเช่าห้องรายเดือน', 'ชำระค่าเช่า', '#2563EB'),
              optionCard('ชำระค่าปรับ', 'กรณีค่าปรับ เช่น เสียงดัง หรือจอดรถผิดจุด', 'ชำระค่าปรับ', '#DC2626'),
              optionCard('ชำระค่าอื่นๆ', 'รายการอื่นที่ไม่ใช่ค่าเช่า เช่น ค่าน้ำดื่มหรือค่าซักผ้า', 'ชำระค่าอื่นๆ', '#EA580C')
            ]
          },
          {
            type: 'box',
            layout: 'vertical',
            spacing: 'sm',
            margin: 'md',
            contents: [
              {
                type: 'text',
                text: 'บริการเพิ่มเติม',
                size: 'sm',
                weight: 'bold',
                color: '#92400E'
              },
              optionCard('จ่ายค่าเช่าที่จอดรถ', 'ส่งสลิปค่าเช่าที่จอดรถเข้าระบบค่าอื่นๆ', 'จ่ายค่าเช่าที่จอดรถ', '#B45309'),
              optionCard('จ่ายค่าเช่ากุญแจ', 'ส่งสลิปสำหรับค่าเช่ากุญแจหรือค่ายืมกุญแจเข้าระบบค่าอื่นๆ', 'จ่ายค่าเช่ากุญแจ', '#B45309'),
              optionCard('จ่ายเงินค่าลืมกุญแจ', 'ส่งสลิปสำหรับค่าลืมกุญแจเข้าระบบค่าอื่นๆ', 'จ่ายเงินค่าลืมกุญแจ', '#B45309')
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
            label: 'เปิดเมนูชำระเงิน',
            text: 'จ่ายเงินมามาแมนชั่น'
          }
        }
      ]
    }
  };
}

const PARKING_CUSTOMER_SEGMENTS = {
  outsider: { key: 'outsider', label: 'บุคคลภายนอก', pricePerMonth: 1000 }
};

function getParkingSegmentByKey(segmentKey) {
  const key = String(segmentKey || '').toLowerCase();
  return PARKING_CUSTOMER_SEGMENTS[key] || null;
}

function buildParkingPostbackPayload(options = {}) {
  // Keep tenant payload backward-compatible for existing n8n flows.
  const basePayload = {
    act: 'parking_rent_request',
    type: 'parking',
    plan: 'parking',
    lineUserId: options.lineUserId || null,
    chatId: options.chatId || null
  };

  const segment = getParkingSegmentByKey(options.customerType);
  if (!segment) {
    return basePayload;
  }

  return {
    ...basePayload,
    customerType: segment.key,
    customerLabel: segment.label,
    pricePerMonth: segment.pricePerMonth
  };
}

function parkingPlanTextMessage() {
  return {
    type: 'text',
    text: 'ค่าจอดรถรายเดือน\n1) ลูกหอ 800 บาท/เดือน (เช่าต่อเนื่องเกิน 3 เดือน)\nหากเช่าไม่ต่อเนื่อง คิดค่าบริการ 200 บาท/ครั้ง\n2) บุคคลภายนอก 1,000 บาท/เดือน\nเลือกประเภทผู้เช่าจากการ์ดด้านล่างได้เลย'
  };
}

function parkingButtonsMessage(options = {}) {
  let tenantData = '{}';
  let outsiderData = '{}';

  try {
    tenantData = JSON.stringify(
      buildParkingPostbackPayload({
        ...options,
        customerType: 'tenant'
      })
    );
    outsiderData = JSON.stringify(
      buildParkingPostbackPayload({
        ...options,
        customerType: 'outsider'
      })
    );
  } catch (err) {
    console.error('parkingButtonsMessage stringify error', err);
  }

  return {
    type: 'flex',
    altText: 'เลือกแพ็กเกจที่จอดรถ',
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#1F4E79',
        paddingAll: '14px',
        contents: [
          {
            type: 'text',
            text: 'ที่จอดรถ',
            color: '#FFFFFF',
            weight: 'bold',
            size: 'lg'
          },
          {
            type: 'text',
            text: 'หากสนใจเช่าที่จอดรถ กดเลือกตัวเลือกด้านล่าง',
            color: '#DCE9F5',
            size: 'sm',
            margin: 'sm',
            wrap: true
          }
        ]
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          {
            type: 'box',
            layout: 'baseline',
            contents: [
              { type: 'text', text: 'ลูกหอ', weight: 'bold', flex: 3, size: 'sm' },
              { type: 'text', text: '800 บาท/เดือน', flex: 4, size: 'sm', align: 'end' }
            ]
          },
          {
            type: 'text',
            text: 'สำหรับเช่าต่อเนื่องเกิน 3 เดือน หากเช่าไม่ต่อเนื่อง คิดค่าบริการ 200 บาท/ครั้ง',
            size: 'xs',
            color: '#5B6470',
            wrap: true
          },
          {
            type: 'box',
            layout: 'baseline',
            contents: [
              { type: 'text', text: 'บุคคลภายนอก', weight: 'bold', flex: 3, size: 'sm' },
              { type: 'text', text: '1,000 บาท/เดือน', flex: 4, size: 'sm', align: 'end' }
            ]
          }
        ]
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: '#1F4E79',
            action: {
              type: 'postback',
              label: 'สำหรับลูกหอ',
              data: tenantData,
              displayText: 'สนใจเช่าที่จอดรถ (ลูกหอ)'
            }
          },
          {
            type: 'button',
            style: 'secondary',
            action: {
              type: 'postback',
              label: 'บุคคลภายนอก',
              data: outsiderData,
              displayText: 'สนใจเช่าที่จอดรถ (บุคคลภายนอก)'
            }
          }
        ]
      }
    }
  };
}

function getN8nFridgeWebhook(env) {
  return env.N8N_FRIDGE_WEBHOOK_URL || '';
}

function getN8nFridgeReceivedWebhook(env) {
  return env.N8N_FRIDGE_RECEIVED_WEBHOOK || '';
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

async function notifyN8nFridgeReceived(env, payload) {
  const url = getN8nFridgeReceivedWebhook(env);
  if (!url) {
    console.warn('notifyN8nFridgeReceived: missing webhook URL');
    return false;
  }

  const headers = { 'Content-Type': 'application/json' };
  const secret = env.WORKER_SECRET || '';
  if (secret) {
    headers['x-worker-secret'] = secret;
  } else {
    console.warn('notifyN8nFridgeReceived: missing WORKER_SECRET');
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      console.error('notifyN8nFridgeReceived: non-200 response', res.status);
    }
    return res.ok;
  } catch (err) {
    console.error('notifyN8nFridgeReceived error', err);
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
      await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [{ type: 'text', text: ack }]);
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
      await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [{ type: 'text', text: finalText }]).catch(err => console.error('checkout_final_reply_fail', err));
    }
  } catch (err) {
    const errMsg = String(err && err.message ? err.message : err);
    console.error('checkout_start_failed', { roomId, err: errMsg });
    const failText = `ระบบมีปัญหา กรุณาลองใหม่ (checkout: ${errMsg.slice(0, 80)})`;
    if (targetChatId) {
      await linePushText(env.LINE_ACCESS_TOKEN, targetChatId, failText).catch(console.error);
    } else if (replyToken) {
      await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [{ type: 'text', text: failText }]).catch(console.error);
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

async function notifyN8nCoAdminWebhook(env, payload) {
  const url = env.N8N_CO_ADMIN_WEBHOOK_URL || CO_ADMIN_WEBHOOK_URL;
  if (!url) {
    console.warn('notifyN8nCoAdminWebhook: missing webhook URL');
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
      console.error('notifyN8nCoAdminWebhook: non-200 response', res.status, text.slice(0, 200));
    }
    return res.ok;
  } catch (err) {
    console.error('notifyN8nCoAdminWebhook error', err);
    return false;
  }
}

async function notifyN8nGroupImage(env, payload) {
  const url = 'https://n8n.srv1112305.hstgr.cloud/webhook/Receipt_Ledger';
  if (!url) {
    console.warn('notifyN8nGroupImage: missing webhook URL');
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
      console.error('notifyN8nGroupImage: non-200 response', res.status, text.slice(0, 200));
    }
    return res.ok;
  } catch (err) {
    console.error('notifyN8nGroupImage error', err);
    return false;
  }
}

export const __testables = {
  parsePostbackData,
  normalizeManagerDecision,
  buildRenewalPostbackMeta,
  isContinueTermReplyAction,
  getRenewalPostbackWebhookUrl
};

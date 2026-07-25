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
const DEFAULT_KEY_RENT_MANAGER_GROUP_ID = 'C8f4b1a7266e9d9e9367cab548f0491cc';

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

function getKeyRentManagerGroupId(env) {
  const configured = String(env?.KEY_RENT_MANAGER_GROUP_ID || '').trim();
  return configured || DEFAULT_KEY_RENT_MANAGER_GROUP_ID;
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
const KMITL_TRAVEL_GUIDE_URL = 'https://mm-v2.pages.dev/kmitl-guide';

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
const CHECKIN_KEYCARD_PHOTO_TTL_SECONDS = 20 * 60;
const CHECKIN_KEYCARD_PHOTO_TTL_MS = CHECKIN_KEYCARD_PHOTO_TTL_SECONDS * 1000;

const BOOKING_SLIP_TTL_SECONDS = 60 * 60;       // 60 minutes to send slip
const BOOKING_SLIP_TTL_MS = BOOKING_SLIP_TTL_SECONDS * 1000;
const BOOKING_PAYMENT_FLOW_TTL_SECONDS = 24 * 60 * 60; // GAS payment window
const BOOKING_ID_TTL_SECONDS = 6 * 60 * 60;     // 6 hours to send ID after slip
const BOOKING_ID_TTL_MS = BOOKING_ID_TTL_SECONDS * 1000;
const PENALTY_FLOW_TTL_SECONDS = 15 * 60;
const PENALTY_FLOW_TTL_MS = PENALTY_FLOW_TTL_SECONDS * 1000;
const CHECKOUT_FLOW_TTL_SECONDS = 10 * 60;
const CHECKOUT_CASH_FLOW_TTL_SECONDS = 15 * 60;
const CHECKOUT_CASH_FLOW_TTL_MS = CHECKOUT_CASH_FLOW_TTL_SECONDS * 1000;
const CHECKOUT_CASH_ACTION = 'CHECKOUT_CASH';
const CHECKOUT_CASH2_ACTION = 'CHECKOUT_CASH2';
const CHECKOUT_CASH_ACTIONS = new Set([CHECKOUT_CASH_ACTION, CHECKOUT_CASH2_ACTION]);
const CHECKOUT_CASH_WAIT_AMOUNT = 'WAIT_CHECKOUT_CASH_AMOUNT';
const CHECKOUT_CASH_WAIT_IMAGE = 'WAIT_CHECKOUT_CASH_IMAGE';
const KEY_RENT_FLOW_TTL_SECONDS = 15 * 60;
const KEY_RENT_START_TAP_GUARD_TTL_SECONDS = 45;
const KEY_RENT_START_EVENT_TTL_SECONDS = 24 * 60 * 60;
const KEY_RENT_WAITING_PHOTO_TTL_SECONDS = 10 * 60;
const PAY_RENT_SLIP_PROMPT = 'โปรดส่งสลิปได้เลยค่ะ';
const KEY_RENT_WAITING_PHOTO_KEY_PREFIX = 'keyrent:waiting-photo:';
const CHECKIN_KEYCARD_WAITING_PHOTO_KEY_PREFIX = 'checkin:keycard:waiting-photo:';
const CHECKOUT2_GROUP_WAITING_SLIP_KEY_PREFIX = 'checkout2:waiting-slip:';
const checkinKeycardWaitingPhotoMemory = new Map();

function getKeyRentWaitingPhotoKey(groupId) {
  return `${KEY_RENT_WAITING_PHOTO_KEY_PREFIX}${String(groupId || '').trim()}`;
}

function getCheckout2GroupWaitingSlipKey(event) {
  const groupId = String(event?.source?.groupId || '').trim();
  return groupId ? `${CHECKOUT2_GROUP_WAITING_SLIP_KEY_PREFIX}${groupId}` : '';
}

function isCheckout2SlipFlow(flow) {
  return String(flow?.reason || flow?.categories || '').trim().toUpperCase() === 'CHECKOUT2';
}

function isCheckoutTransferSlipFlow(flow) {
  const reason = String(flow?.reason || flow?.categories || '').trim().toUpperCase();
  return reason === 'CHECKOUT' || reason === 'CHECKOUT2';
}

function selectPenaltyFlowForImage(directFlow, checkout2GroupFlow, chatId, now = Date.now()) {
  const isActive = (flow) => !!(
    flow &&
    flow.ts &&
    (now - flow.ts < PENALTY_FLOW_TTL_MS)
  );
  const directActive = isActive(directFlow);
  const checkout2GroupActive = !!(
    isActive(checkout2GroupFlow) &&
    isCheckoutTransferSlipFlow(checkout2GroupFlow) &&
    String(checkout2GroupFlow?.chatId || '') === String(chatId || '')
  );
  return {
    flow: directActive ? directFlow : (checkout2GroupActive ? checkout2GroupFlow : directFlow),
    active: directActive || checkout2GroupActive,
    directActive,
    checkout2GroupActive
  };
}

function isKeyRentWaitingPhotoStateForUser(state, userId) {
  if (!state || state.mode !== 'WAITING_KEY_PHOTO') return false;
  const startedByUserId = String(state.startedByUserId || '').trim();
  const senderUserId = String(userId || '').trim();
  return !(startedByUserId && senderUserId && startedByUserId !== senderUserId);
}

function getCheckinKeycardWaitingPhotoKey(groupId, userId) {
  return `${CHECKIN_KEYCARD_WAITING_PHOTO_KEY_PREFIX}${String(groupId || '').trim()}:${String(userId || '').trim()}`;
}

function getCheckinKeycardWaitingPhotoGroupKey(groupId) {
  return `${CHECKIN_KEYCARD_WAITING_PHOTO_KEY_PREFIX}${String(groupId || '').trim()}:_latest`;
}

function getCheckinKeycardWaitingPhotoUserKey(userId) {
  return `${CHECKIN_KEYCARD_WAITING_PHOTO_KEY_PREFIX}user:${String(userId || '').trim()}`;
}

function getCheckinKeycardWaitingPhotoMemoryKey(groupId, userId) {
  return `${String(groupId || '').trim()}:${String(userId || '').trim()}`;
}

function rememberCheckinKeycardWaitingPhotoState(groupId, userId, state) {
  const now = Date.now();
  const entries = [
    getCheckinKeycardWaitingPhotoMemoryKey(groupId, userId),
    getCheckinKeycardWaitingPhotoMemoryKey(groupId, '_latest')
  ];
  for (const key of entries) {
    if (key.replace(':', '')) {
      checkinKeycardWaitingPhotoMemory.set(key, { ...state, memoryTs: now });
    }
  }
}

function forgetCheckinKeycardWaitingPhotoState(groupId, userId) {
  checkinKeycardWaitingPhotoMemory.delete(getCheckinKeycardWaitingPhotoMemoryKey(groupId, userId));
  checkinKeycardWaitingPhotoMemory.delete(getCheckinKeycardWaitingPhotoMemoryKey(groupId, '_latest'));
}

function getRememberedCheckinKeycardWaitingPhotoState(groupId, userId) {
  const now = Date.now();
  const keys = [
    getCheckinKeycardWaitingPhotoMemoryKey(groupId, userId),
    getCheckinKeycardWaitingPhotoMemoryKey(groupId, '_latest')
  ];
  for (const key of keys) {
    const state = checkinKeycardWaitingPhotoMemory.get(key);
    if (!state) continue;
    if (state.memoryTs && now - state.memoryTs < CHECKIN_KEYCARD_PHOTO_TTL_MS) {
      return state;
    }
    checkinKeycardWaitingPhotoMemory.delete(key);
  }
  return null;
}

function isCheckinKeycardWaitingPhotoStateForEvent(state, groupId, userId) {
  if (!state) return false;
  const stateGroupId = String(state.groupId || '').trim();
  const stateManagerUserId = String(state.managerUserId || '').trim();
  const eventGroupId = String(groupId || '').trim();
  const eventUserId = String(userId || '').trim();

  // Keycard-photo mode must always be group-scoped. Reject legacy/malformed
  // states (missing groupId) so they cannot hijack unrelated image flows.
  if (!stateGroupId) return false;
  // Never apply keycard state to 1:1/private events.
  if (!eventGroupId) return false;
  if (stateGroupId !== eventGroupId) return false;
  if (stateManagerUserId && eventUserId && stateManagerUserId !== eventUserId) return false;
  return true;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getCheckinKeycardWaitingPhotoState(env, userKey, groupKey, userOnlyKey, groupId, userId) {
  const readState = async () => {
    const stateFromUser = userKey ? await kvGet(env, userKey) : null;
    const stateFromGroup = groupKey ? await kvGet(env, groupKey) : null;
    const stateFromUserOnly = userOnlyKey ? await kvGet(env, userOnlyKey) : null;
    const stateFromMemory = getRememberedCheckinKeycardWaitingPhotoState(groupId, userId);
    return {
      stateFromUser,
      stateFromGroup,
      stateFromUserOnly,
      stateFromMemory,
      state: [stateFromUser, stateFromGroup, stateFromUserOnly, stateFromMemory]
        .find((state) => isCheckinKeycardWaitingPhotoStateForEvent(state, groupId, userId)) || null
    };
  };

  let result = await readState();
  if (result.state) return result;

  // The keycard-photo workflow is group-only. Private images must never pay
  // the 2.9 second KV consistency retry cost before reaching their owner flow.
  if (!String(groupId || '').trim()) return result;

  // Workers KV is eventually consistent. A manager often sends the photo
  // immediately after pressing the postback button, so retry briefly before
  // falling through to the generic image handlers.
  for (const delayMs of [400, 900, 1600]) {
    await sleep(delayMs);
    result = await readState();
    if (result.state) {
      return { ...result, retryDelayMs: delayMs };
    }
  }

  return result;
}

function getKeyRentPaymentFlowByStartAction(action) {
  const normalized = String(action || '').trim().toUpperCase();
  if (normalized === 'KEY_MB_START_PHOTO') return 'MOBILE_BANKING';
  return 'CASH';
}

function isCheckout2PaymentPostback(data) {
  const action = String(
    data?.act ||
    data?.action ||
    data?.type ||
    data?.eventType ||
    data?.postbackType ||
    data?.Category ||
    data?.category ||
    ''
  ).trim().toUpperCase();
  return action === 'CHECKOUT2';
}

function buildCheckout2PaymentFlowState(data, event, postbackDataString, ts = Date.now()) {
  const roomId = String(data?.roomId || data?.RoomID || data?.room || '').trim().toUpperCase();
  return {
    ts,
    chatId: getChatId(event),
    userId: event?.source?.userId || String(data?.lineUserId || data?.LINEUserId || data?.LineUserId || ''),
    type: 'Others_payment',
    reason: 'CHECKOUT2',
    categories: 'CHECKOUT2',
    roomId,
    postbackData: String(postbackDataString || '')
  };
}

function parseCheckoutPaymentText(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const roomId = extractRoomId(raw);
  const optionalRoom = String.raw`(?:\s+(?:ห้อง|room)?\s*[ab]\d{3,4})?`;
  const checkout2Re = new RegExp(
    String.raw`^\s*(ชำระค่าเช็คเอ้าท์สอง|จ่ายค่าเช็คเอ้าท์สอง|ชำระค่าเช็คเอาท์สอง|จ่ายค่าเช็คเอาท์สอง|ชำระค่าcheckout2|จ่ายค่าcheckout2|checkout2 payment)` + optionalRoom + String.raw`\s*$`,
    'i'
  );
  if (checkout2Re.test(raw)) return { reason: 'CHECKOUT2', roomId };

  const checkoutRe = new RegExp(
    String.raw`^\s*(ชำระค่าเช็คเอาท์|จ่ายค่าเช็คเอาท์|ชำระค่าcheckout|จ่ายค่าcheckout|checkout payment)` + optionalRoom + String.raw`\s*$`,
    'i'
  );
  if (checkoutRe.test(raw)) return { reason: 'CHECKOUT', roomId };

  return null;
}

async function armCheckoutTransferSlipFlow(env, event, checkoutPayment, postbackData = '') {
  const reason = String(checkoutPayment?.reason || '').trim().toUpperCase();
  if (reason !== 'CHECKOUT' && reason !== 'CHECKOUT2') return null;

  const roomId = String(checkoutPayment?.roomId || '').trim().toUpperCase();
  const chatId = getChatId(event);
  const userId = String(event?.source?.userId || '').trim();
  const penaltyKey = `${getStateKey(event)}:penalty_flow`;
  const groupKey = getCheckout2GroupWaitingSlipKey(event);
  const flow = {
    ts: Date.now(),
    chatId,
    userId,
    type: 'Others_payment',
    reason,
    categories: reason,
    ...(roomId ? { roomId, room: roomId } : {}),
    ...(postbackData ? { postbackData: String(postbackData) } : {})
  };

  await clearPaymentStatesForEvent(env, event);
  await Promise.all([
    kvPut(env, penaltyKey, flow, PENALTY_FLOW_TTL_SECONDS),
    groupKey ? kvPut(env, groupKey, flow, PENALTY_FLOW_TTL_SECONDS) : Promise.resolve()
  ]);

  return { flow, penaltyKey, groupKey };
}

async function replyOrPushMessages(env, replyToken, chatId, messages, logLabel = 'line_reply_or_push_failed') {
  let replied = false;
  if (replyToken) {
    try {
      await lineReply(env.LINE_ACCESS_TOKEN, replyToken, messages);
      replied = true;
    } catch (err) {
      console.error(`${logLabel}_reply`, err);
    }
  }
  if (!replied && chatId) {
    try {
      await linePush(env.LINE_ACCESS_TOKEN, chatId, messages);
      return true;
    } catch (err) {
      console.error(`${logLabel}_push`, {
        to: chatId,
        error: String(err?.message || err)
      });
      return false;
    }
  }
  return replied;
}

async function replyOrPushText(env, replyToken, chatId, text, logLabel = 'line_reply_or_push_failed') {
  return replyOrPushMessages(
    env,
    replyToken,
    chatId,
    [{ type: 'text', text }],
    logLabel
  );
}

function detectPresetOtherPaymentReason(text, checkoutPaymentShortcut = null) {
  if (checkoutPaymentShortcut?.reason) return checkoutPaymentShortcut.reason;

  const compact = normalizeCommandText(text).replace(/\s+/g, '');
  if (/^(จ่ายค่าทำความสะอาด|ชำระค่าทำความสะอาด)$/i.test(compact)) return 'CLEANING_PAYMENT';
  if (/^(จ่ายค่าเช่าที่จอดรถ|ชำระค่าเช่าที่จอดรถ)$/i.test(compact)) return 'CAR';
  if (/^(จ่ายเงินค่ายืมกุญแจ|จ่ายเงินค่าเช่ากุญแจ|จ่ายค่าเช่ากุญแจ|ชำระค่าเช่ากุญแจ|เช่ากุญแจเพิ่ม|เช่าคีย์การ์ดเพิ่ม|เช่าชุดกุญแจเพิ่ม)$/i.test(compact)) {
    return 'KEY_RENT';
  }
  if (/^(จ่ายเงินค่าลืมกุญแจ|จ่ายเงินค่าลืมคีย์การ์ด|จ่ายเงินค่ากุญแจหาย|ชำระค่าลืมกุญแจ|ชำระค่าลืมคีย์การ์ด|ชำระค่ากุญแจหาย|ลืม\/ทำกุญแจหาย|ลืมทำกุญแจหาย|กุญแจหาย|คีย์การ์ดหาย)$/i.test(compact)) {
    return 'KEY_FORGOT';
  }
  return null;
}

function getCheckoutCashFlowKey(event) {
  return `${getStateKey(event)}:checkout_cash_flow`;
}

function getPaymentStateKeys(event) {
  const stateKey = getStateKey(event);
  const lineUserId = String(event?.source?.userId || '').trim();
  return [
    `${stateKey}:penalty_flow`,
    `${stateKey}:payrent_flow`,
    `${stateKey}:keyrent_flow`,
    `${stateKey}:checkout_cash_flow`,
    lineUserId ? getBillManualPaymentStateKey(lineUserId) : '',
    getCheckout2GroupWaitingSlipKey(event)
  ].filter(Boolean);
}

async function getClearablePaymentStateKeys(env, event) {
  const keys = getPaymentStateKeys(event);
  const groupKey = getCheckout2GroupWaitingSlipKey(event);
  if (!groupKey || !keys.includes(groupKey)) return keys;

  const groupState = await kvGet(env, groupKey);
  const currentUserId = String(event?.source?.userId || '').trim();
  const ownerUserId = String(
    groupState?.userId ||
    groupState?.startedByUserId ||
    groupState?.operatorLineUserId ||
    ''
  ).trim();

  // A group fallback state may belong to another operator. Never let a new
  // command from this sender erase another sender's in-progress image flow.
  if (!groupState || !ownerUserId || !currentUserId || ownerUserId !== currentUserId) {
    return keys.filter((key) => key !== groupKey);
  }
  return keys;
}

async function clearPaymentStatesForEvent(env, event, keepKeys = []) {
  const keepSet = new Set((keepKeys || []).filter(Boolean));
  const clearableKeys = await getClearablePaymentStateKeys(env, event);
  const keys = clearableKeys.filter((key) => !keepSet.has(key));
  await Promise.all(keys.map((key) => kvDel(env, key)));
  return keys;
}

function normalizeCheckoutCashAction(data) {
  const action = String(
    data?.act ||
    data?.action ||
    data?.type ||
    data?.eventType ||
    data?.postbackType ||
    ''
  ).trim().toUpperCase();
  return CHECKOUT_CASH_ACTIONS.has(action) ? action : '';
}

function isCheckoutCashPaymentPostback(data) {
  return !!normalizeCheckoutCashAction(data);
}

function getCheckoutCashType(action) {
  return String(action || '').trim().toUpperCase() === CHECKOUT_CASH2_ACTION ? 'CHECKOUT2' : 'CHECKOUT';
}

function buildCheckoutCashFlowState(data, event, postbackDataString, ts = Date.now()) {
  const roomId = String(data?.roomId || data?.RoomID || data?.room || '').trim().toUpperCase();
  const tenantLineUserId = String(data?.lineUserId || data?.tenantLineUserId || data?.LINEUserId || data?.LineUserId || '').trim();
  const action = normalizeCheckoutCashAction(data) || CHECKOUT_CASH_ACTION;
  const checkoutType = getCheckoutCashType(action);
  return {
    mode: CHECKOUT_CASH_WAIT_AMOUNT,
    ts,
    chatId: getChatId(event),
    userId: String(event?.source?.userId || '').trim(),
    tenantLineUserId,
    roomId,
    action,
    checkoutType,
    categories: checkoutType,
    paymentMethod: 'CASH',
    postbackData: String(postbackDataString || '')
  };
}

function parseCheckoutCashAmount(text) {
  const normalized = String(text || '')
    .trim()
    .replace(/บาท/gi, '')
    .replace(/thb/gi, '')
    .replace(/[, ]+/g, '');
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return amount;
}

function formatCheckoutCashAmount(amount) {
  const value = Number(amount);
  if (!Number.isFinite(value)) return '';
  return value.toLocaleString('en-US', {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2
  });
}

function buildCheckoutCashAmountState(flow, amount, ts = Date.now()) {
  return {
    ...flow,
    mode: CHECKOUT_CASH_WAIT_IMAGE,
    amount,
    amountText: formatCheckoutCashAmount(amount),
    ts
  };
}

function isCheckoutCashFlowActive(flow, mode = '') {
  if (!flow || !flow.ts) return false;
  if (mode && flow.mode !== mode) return false;
  return Date.now() - flow.ts < CHECKOUT_CASH_FLOW_TTL_MS;
}

function buildCheckoutCashAmountPrompt(flow) {
  const roomText = flow?.roomId ? `ห้อง ${flow.roomId} ` : '';
  return `กรุณาพิมพ์ยอดเงินสดค่าเช็คเอาท์${roomText}เช่น 1500`;
}

function buildCheckoutCashImagePrompt(flow) {
  const roomText = flow?.roomId ? `ห้อง ${flow.roomId} ` : '';
  const amountText = flow?.amountText || formatCheckoutCashAmount(flow?.amount);
  return `บันทึกยอดเงินสด${roomText}${amountText ? `${amountText} บาท` : ''}แล้ว กรุณาส่งรูปหลักฐานเงินสดในแชทนี้`;
}

function buildCheckoutCashImagePayload(event, flow, receivedAt = new Date().toISOString()) {
  const source = event?.source || {};
  const action = String(flow?.action || CHECKOUT_CASH_ACTION).trim().toUpperCase();
  const checkoutType = String(flow?.checkoutType || getCheckoutCashType(action)).trim().toUpperCase();
  return {
    source: 'line_message',
    intent: 'checkout_cash_payment_image',
    action,
    channel: 'checkout_cash',
    checkoutType,
    categories: String(flow?.categories || checkoutType),
    paymentMethod: 'CASH',
    roomId: String(flow?.roomId || '').trim(),
    room: String(flow?.roomId || '').trim(),
    amount: Number(flow?.amount || 0),
    amountText: String(flow?.amountText || formatCheckoutCashAmount(flow?.amount)),
    tenantLineUserId: String(flow?.tenantLineUserId || ''),
    lineUserId: String(source?.userId || ''),
    operatorLineUserId: String(flow?.userId || source?.userId || ''),
    chatId: getChatId(event),
    sourceType: String(source?.type || ''),
    imageMessageId: String(event?.message?.id || ''),
    postbackData: String(flow?.postbackData || ''),
    webhookEventId: String(event?.webhookEventId || ''),
    event,
    receivedAt
  };
}

async function handlePenaltyPaymentImage(env, ctx, options = {}) {
  const {
    event,
    replyToken,
    chatId,
    penaltyFlow,
    penaltyStateKeys = [],
    activeFlow = null
  } = options;
  const stateKeys = Array.from(new Set((penaltyStateKeys || []).filter(Boolean)));

  if (!penaltyFlow?.reason) {
    const askReason = (penaltyFlow?.type || '') === 'Others_payment'
      ? 'โปรดระบุว่าเป็นค่าอะไร เช่น ค่าคีย์การ์ด, ค่าน้ำดื่ม ฯลฯ'
      : 'โปรดระบุว่าค่าปรับเรื่องอะไร เช่น เสียงดัง, จอดรถ, สูบบุหรี่ ฯลฯ';
    let replied = false;
    if (replyToken) {
      try {
        await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [{ type: 'text', text: askReason }]);
        replied = true;
      } catch (err) {
        console.error('penalty_reason_reply_failed', err);
      }
    }
    if (!replied && chatId) {
      await safeLinePushText(env.LINE_ACCESS_TOKEN, chatId, askReason, 'penalty_reason_push_failed');
    }
    ctx.waitUntil(Promise.all(
      stateKeys.map((key) => kvPut(env, key, { ...penaltyFlow, ts: Date.now() }, PENALTY_FLOW_TTL_SECONDS))
    ));
    return true;
  }

  const typeLabel = penaltyFlowPaymentLabel(penaltyFlow);
  const slipPayload = {
    source: 'line_message',
    intent: 'penalty_payment_slip',
    channel: 'penalty',
    event,
    lineUserId: event?.source?.userId || penaltyFlow?.userId || null,
    chatId,
    imageMessageId: event?.message?.id || null,
    type: normalizePenaltySlipType(penaltyFlow?.type || 'penalty'),
    reason: normalizePenaltySlipReason(penaltyFlow?.type || 'penalty', penaltyFlow?.reason || ''),
    categories: penaltyFlow?.categories || penaltyFlow?.reason || '',
    roomId: penaltyFlow?.roomId || penaltyFlow?.room || '',
    room: penaltyFlow?.roomId || penaltyFlow?.room || '',
    building: penaltyFlow?.building || '',
    amount: penaltyFlow?.amount ?? null,
    flowId: activeFlow?.flowId || penaltyFlow?.flowId || '',
    flowVersion: activeFlow?.version || activeFlow?.flowVersion || penaltyFlow?.version || '',
    version: activeFlow?.version || activeFlow?.flowVersion || penaltyFlow?.version || '',
    receivedAt: new Date().toISOString()
  };

  // Acknowledge LINE before waiting for n8n. LINE reply tokens are short-lived,
  // and the downstream workflow can be slow or temporarily unavailable.
  const receivedText = `รับสลิปชำระ${typeLabel}แล้ว กำลังส่งต่อให้เจ้าหน้าที่ตรวจสอบค่ะ`;
  let replied = false;
  if (replyToken) {
    try {
      await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [{ type: 'text', text: receivedText }]);
      replied = true;
    } catch (err) {
      console.error('penalty_slip_immediate_reply_failed', err);
    }
  }
  if (!replied && chatId) {
    await safeLinePushText(env.LINE_ACCESS_TOKEN, chatId, receivedText, 'penalty_slip_immediate_push_failed');
  }

  ctx.waitUntil((async () => {
    let ok = false;
    try {
      ok = await Penalty_webhook(env, slipPayload, {
        target: penaltyFlow?.webhookTarget || ''
      });
    } catch (err) {
      console.error('Penalty_webhook failed', err);
    }

    const activeFlowStillOwnsImage = async () => {
      if (!activeFlow) return true;
      const current = await getActiveFlow(
        env,
        activeFlow.userId || event?.source?.userId || '',
        activeFlow
      );
      return isSameActiveFlow(current, activeFlow);
    };

    if (!(await activeFlowStillOwnsImage())) {
      console.log('penalty_slip_stale_callback_ignored', {
        flowId: activeFlow?.flowId || '',
        version: activeFlow?.version || ''
      });
      return;
    }

    if (ok) {
      for (const key of stateKeys) {
        if (!(await activeFlowStillOwnsImage())) return;
        const stored = await kvGet(env, key);
        if (activeFlow && !isSameActiveFlow(
            { flowId: stored?.flowId, version: stored?.version || stored?.flowVersion },
            activeFlow
          )) continue;
        await kvDel(env, key);
      }
      if (activeFlow) {
        await clearActiveFlowIfCurrent(env, activeFlow.userId || event?.source?.userId || '', activeFlow);
      }
      return;
    }

    let retryActiveFlow = activeFlow;
    if (activeFlow) {
      retryActiveFlow = await updateActiveFlowIfCurrent(
        env,
        activeFlow.userId || event?.source?.userId || '',
        activeFlow,
        { phase: 'await_slip', ttlSeconds: PENALTY_FLOW_TTL_SECONDS }
      );
      if (!retryActiveFlow) return;
      // The Durable Object remains the authoritative retry state. Rewriting a
      // legacy KV mirror here could resurrect this old flow after a newer
      // command has already replaced it.
    } else {
      await Promise.all(
        stateKeys.map((key) => kvPut(env, key, {
          ...penaltyFlow,
          ts: Date.now()
        }, PENALTY_FLOW_TTL_SECONDS))
      );
    }
    if (chatId) {
      await safeLinePushText(
        env.LINE_ACCESS_TOKEN,
        chatId,
        `รับรูปแล้ว แต่ระบบปลายทางยังไม่ตอบรับสลิปชำระ${typeLabel} กรุณาลองส่งอีกครั้งค่ะ`,
        'penalty_slip_failure_push_failed'
      );
    }
  })());

  return true;
}

function buildCheckinFlowKey(userId, chatId) {
  if (userId) {
    return `checkin_flow:${userId}`;
  }
  if (chatId) {
    return `checkin_flow:${chatId}`;
  }
  return 'checkin_flow:unknown';
}

function isCheckinFlowStateActive(state, now = Date.now()) {
  return !!(
    state &&
    state.ts &&
    (now - state.ts < CHECKIN_FLOW_TTL_MS)
  );
}

async function clearUserWorkflowStatesForEvent(env, event, reason = 'new_command', options = {}) {
  const userId = String(event?.source?.userId || '').trim();
  const chatId = getChatId(event);
  if (!userId) return [];

  const stateKey = getStateKey(event);
  const groupId = String(event?.source?.groupId || '').trim();
  const clearablePaymentKeys = await getClearablePaymentStateKeys(env, event);
  const keys = new Set([
    ...clearablePaymentKeys,
    options?.preserveActiveFlow ? '' : buildActiveFlowKey(userId),
    buildBookingFlowKey(userId, chatId),
    buildCheckinFlowKey(userId, chatId),
    `reg_id:${userId}`,
    `${TENANT_CHANGE_KEY_PREFIX}${userId}`,
    parkingOutsiderPhoneFlowKey(userId),
    `${stateKey}:moveout_flow`,
    getCheckinKeycardWaitingPhotoUserKey(userId)
  ].filter(Boolean));

  if (groupId) {
    keys.add(getCheckinKeycardWaitingPhotoKey(groupId, userId));

    const keycardGroupKey = getCheckinKeycardWaitingPhotoGroupKey(groupId);
    const keycardGroupState = await kvGet(env, keycardGroupKey);
    if (String(keycardGroupState?.managerUserId || '').trim() === userId) {
      keys.add(keycardGroupKey);
    }

    const keyRentWaitingPhotoKey = getKeyRentWaitingPhotoKey(groupId);
    const keyRentWaitingPhotoState = await kvGet(env, keyRentWaitingPhotoKey);
    if (String(keyRentWaitingPhotoState?.startedByUserId || '').trim() === userId) {
      keys.add(keyRentWaitingPhotoKey);
    }

    checkinKeycardWaitingPhotoMemory.delete(
      getCheckinKeycardWaitingPhotoMemoryKey(groupId, userId)
    );
    const latestMemoryKey = getCheckinKeycardWaitingPhotoMemoryKey(groupId, '_latest');
    const latestMemoryState = checkinKeycardWaitingPhotoMemory.get(latestMemoryKey);
    if (String(latestMemoryState?.managerUserId || '').trim() === userId) {
      checkinKeycardWaitingPhotoMemory.delete(latestMemoryKey);
    }
  }

  const clearedKeys = [...keys];
  if (!options?.preserveActiveFlow) {
    await clearActiveFlow(env, userId, event);
  }
  const deleteResults = await Promise.allSettled(clearedKeys.map(async (key) => {
    if (!hasKV(env)) return;
    // Do not use the best-effort kvDel wrapper here: cleanup needs to expose
    // individual failures for observability while never blocking the command.
    await env.KV.delete(key);
  }));
  const failedDeletes = deleteResults.flatMap((result, index) => (
    result.status === 'rejected'
      ? [{ key: clearedKeys[index], error: String(result.reason?.message || result.reason) }]
      : []
  ));
  if (failedDeletes.length) {
    console.warn('user_workflow_state_cleanup_partial_failure', {
      reason,
      userId,
      chatId,
      failedDeletes
    });
  }
  console.log('user_workflow_states_cleared', {
    reason,
    userId,
    chatId,
    clearedKeys
  });
  return clearedKeys;
}

async function clearUserWorkflowStatesForCheckin(env, event) {
  return clearUserWorkflowStatesForEvent(env, event, 'checkin');
}

async function startCheckinFlow(env, ctx, event, replyToken, text, roomId, activeFlowExpected = null) {
  const userId = String(event?.source?.userId || '').trim();
  const chatId = getChatId(event);
  await clearUserWorkflowStatesForEvent(
    env,
    event,
    'checkin',
    { preserveActiveFlow: !!activeFlowExpected }
  );
  if (activeFlowExpected && userId) {
    await updateActiveFlowIfCurrent(env, userId, activeFlowExpected, {
      flowType: 'checkin',
      kind: 'checkin',
      phase: 'await_slip',
      context: { roomId },
      preserveVersion: true,
      ttlSeconds: CHECKIN_FLOW_TTL_SECONDS
    });
  }

  const payload = {
    source: 'line_message',
    intent: 'checkin_start',
    channel: 'checkin',
    event,
    text,
    roomId,
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
      roomId,
      chatId,
      lineUserId: userId || null,
      ts: Date.now()
    };
    try {
      await env.KV.put(
        checkinFlowKey,
        JSON.stringify(checkinFlowState),
        { expirationTtl: CHECKIN_FLOW_TTL_SECONDS }
      );
    } catch (err) {
      console.error('checkin flow kv put failed', err);
    }
  }

  const ackMsg = `รับทราบแล้วค่ะ กำลังแจ้งเจ้าหน้าที่ให้ดำเนินงานเช็คอินห้อง ${roomId} ต่อทันที กรุณาส่งสลิป/หลักฐานภายใน 30 นาที`;
  await replyOrPushText(env, replyToken, chatId, ackMsg, 'checkin_start_ack_failed');
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
const RETURN_KEY_TRIGGER_RE = /(คืน\s*กุญแจ|return\s*key)/i;
function parseReturnKeyTrigger(text) {
  if (!text) return null;
  const raw = String(text || '').trim();
  if (!RETURN_KEY_TRIGGER_RE.test(raw)) return null;

  const compact = raw.replace(/\s+/g, '');
  const roomMatchSpaced = raw.match(/(?:คืน\s*กุญแจ|return\s*key)\s*(?:ห้อง|room)?\s*([ab]\d{3,4})\b/i);
  const roomMatchCompact = compact.match(/(?:คืนกุญแจ|returnkey)(?:ห้อง|room)?([ab]\d{3,4})\b/i);
  const roomToken = (roomMatchSpaced?.[1] || roomMatchCompact?.[1] || '').toUpperCase();
  if (!roomToken) return null;
  if (!/^[AB]\d{3,4}$/.test(roomToken)) return null;
  return roomToken;
}

const CO_ADMIN_ALLOWED_LINE_USER_IDS = new Set([
  'Ue90558b73d62863e2287ac32e69541a3',
  'U2855d93e108ccebbef7d1b55ec8827e5',
  'U9293d43980e98649e20c8759a2c2d7f0'
]);
const RETURN_KEY_ALLOWED_LINE_USER_IDS = new Set([
  'Ue90558b73d62863e2287ac32e69541a3', // Ma
  'U193cae8dd9197f7d4bd6ada8046fd98b', // KP
  'U2855d93e108ccebbef7d1b55ec8827e5', // P'Koy
  'U9293d43980e98649e20c8759a2c2d7f0', // P'Yu
  'Ua3e2f84505daa64ee21b8608e8857c33'  // POCO
]);
const CLEANING_MANAGEMENT_ALLOWED_LINE_USER_IDS = new Set([
  'Ue90558b73d62863e2287ac32e69541a3', // Ma
  'U193cae8dd9197f7d4bd6ada8046fd98b', // KP
  'U2855d93e108ccebbef7d1b55ec8827e5', // P'Koy
  'U9293d43980e98649e20c8759a2c2d7f0'  // P'Yu
]);
const CO_ADMIN_WEBHOOK_URL = 'https://n8n.srv1112305.hstgr.cloud/webhook/co-admin';
const DEFAULT_N8N_CHECKOUT_START_WEBHOOK = 'https://n8n.srv1112305.hstgr.cloud/webhook/checkout';
const DEFAULT_N8N_RETURN_KEY_WEBHOOK_URL = 'https://n8n.srv1112305.hstgr.cloud/webhook/Return_Key';
const DEFAULT_N8N_RETURN_KEY_DECISION_WEBHOOK_URL = 'https://n8n.srv1112305.hstgr.cloud/webhook/Return_Key_Desicion';
const DEFAULT_N8N_PREBOOK_WEBHOOK_URL = 'https://n8n.srv1112305.hstgr.cloud/webhook/prebook';
const DEFAULT_N8N_CHECKIN_KEYCARD_PHOTO_WEBHOOK_URL = 'https://n8n.srv1112305.hstgr.cloud/webhook/c157057d-5a43-4f6d-96ad-5655c7ebf76e';
const DEFAULT_N8N_CLEANING_WEBHOOK_URL = 'https://n8n.srv1112305.hstgr.cloud/webhook/cleaning_mm';
const DEFAULT_N8N_BILL_MANUAL_WEBHOOK_URL = 'https://n8n.srv1112305.hstgr.cloud/webhook/bill-manual-received';
const BILL_MANUAL_PAY_CLICK_ACTION = 'BILL_PAY_CLICK';
const BILL_MANUAL_PAYMENT_TTL_SECONDS = 10 * 60;
const BILL_MANUAL_PAYMENT_KEY_PREFIX = 'bill-manual:payment:';
const CLEANING_TENANT_CONFIRM_ACT = 'CLEANING_TENANT_CONFIRM';
const CO_ADMIN_OUTCOME_SET = new Set(['no', 'forfeit', 'waive']);

function parseRoomToken(token) {
  const room = String(token || '').trim().toUpperCase();
  if (!/^[AB]\d{3,4}$/.test(room)) return null;
  return room;
}

function parseCleaningCommand(text) {
  const raw = String(text || '').trim();
  const compact = raw.replace(/\s+/g, '');

  if (raw === 'บริการทำความสะอาด') {
    return { act: 'tenant', roomId: '' };
  }

  const match =
    raw.match(/^ทำความสะอาด\s+([AB]\d{3,4})$/i) ||
    compact.match(/^ทำความสะอาด([AB]\d{3,4})$/i);

  if (match) {
    return { act: 'management', roomId: match[1].toUpperCase() };
  }

  return null;
}

function isCleaningManagementAllowedLineUserId(userId) {
  return CLEANING_MANAGEMENT_ALLOWED_LINE_USER_IDS.has(String(userId || '').trim());
}

function buildCleaningManagementAckText(roomId) {
  const room = String(roomId || '').trim().toUpperCase() || '-';
  return `รับคำสั่งทำความสะอาดห้อง ${room} แล้วค่ะ กำลังส่งงานให้ทีมทำความสะอาด`;
}

function buildCleaningTenantConfirmFlex() {
  return {
    type: 'flex',
    altText: 'บริการทำความสะอาด 300-500 บาท',
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#155E75',
        paddingAll: '16px',
        contents: [
          {
            type: 'text',
            text: 'บริการทำความสะอาด',
            color: '#FFFFFF',
            weight: 'bold',
            size: 'lg'
          },
          {
            type: 'text',
            text: 'สำหรับผู้เช่ามามาแมนชั่น',
            color: '#CFFAFE',
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
            type: 'text',
            text: 'ค่าบริการประมาณ 300-500 บาท',
            weight: 'bold',
            size: 'md',
            color: '#0F172A',
            wrap: true
          },
          {
            type: 'text',
            text: 'ราคาขึ้นอยู่กับขนาดห้องและสภาพหน้างาน ทีมงานจะติดต่อกลับเพื่อแจ้งรายละเอียดและนัดหมาย',
            size: 'sm',
            color: '#475569',
            wrap: true
          },
          {
            type: 'text',
            text: 'หากต้องการให้แอดมินรับเรื่อง กรุณากดยืนยันด้านล่าง',
            size: 'sm',
            color: '#64748B',
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
            style: 'primary',
            color: '#155E75',
            action: {
              type: 'postback',
              label: 'ยืนยันขอใช้บริการ',
              data: `act=${CLEANING_TENANT_CONFIRM_ACT}`,
              displayText: 'ยืนยันขอใช้บริการทำความสะอาด'
            }
          }
        ]
      }
    }
  };
}

function extractRoomId(value) {
  const raw = String(value || '').trim().toUpperCase();
  const match = raw.match(/\b([AB]\d{3,4})\b/);
  return match ? match[1] : '';
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

function isCheckoutStartShortcut(shortcut) {
  if (!shortcut || shortcut.type !== 'co') return false;
  return !shortcut.outcome;
}

function requiresCoAdminShortcutPermission(shortcut) {
  return !!shortcut && !isCheckoutStartShortcut(shortcut);
}

function isCoAdminAllowedLineUserId(userId) {
  const normalized = String(userId || '').trim();
  if (!normalized) return false;
  return CO_ADMIN_ALLOWED_LINE_USER_IDS.has(normalized);
}

function isReturnKeyAllowedLineUserId(userId) {
  const normalized = String(userId || '').trim();
  if (!normalized) return false;
  return RETURN_KEY_ALLOWED_LINE_USER_IDS.has(normalized);
}

function buildBookingFlowKey(userId, chatId) {
  if (userId) return `booking_flow:${userId}`;
  if (chatId) return `booking_flow:${chatId}`;
  return 'booking_flow:unknown';
}

const ACTIVE_FLOW_KEY_PREFIX = 'active_flow:';
const ACTIVE_FLOW_CONTRACT_VERSION = 'latest-command-v2';
const RESERVATION_ACTIVE_FLOW_PHASES = new Set(['await_confirm', 'await_slip', 'confirm_slip', 'await_id', 'confirm_id']);
const RESERVATION_TERMINAL_FLOW_PHASES = new Set(['done', 'completed']);
const ACTIVE_FLOW_OWNER_BINDING = 'ACTIVE_FLOW_OWNER';

function buildActiveFlowOwnerKey(userId, scopeHint = null) {
  const uid = String(userId || '').trim();
  if (!uid) return '';
  const explicitOwnerKey = String(scopeHint?.ownerKey || '').trim();
  if (explicitOwnerKey) return explicitOwnerKey;

  const source = scopeHint?.source || scopeHint?.event?.source || {};
  const scopeType = String(scopeHint?.scopeType || source?.type || 'user').trim().toLowerCase();
  const scopeId = String(
    scopeHint?.scopeId ||
    (scopeType === 'group' ? source?.groupId : (scopeType === 'room' ? source?.roomId : '')) ||
    ''
  ).trim();
  if ((scopeType === 'group' || scopeType === 'room') && scopeId) {
    return `${scopeType}:${scopeId}:user:${uid}`;
  }
  return `user:${uid}`;
}

function hasActiveFlowOwner(env) {
  const namespace = env?.[ACTIVE_FLOW_OWNER_BINDING];
  return !!(
    namespace &&
    typeof namespace.idFromName === 'function' &&
    typeof namespace.get === 'function'
  );
}

async function callActiveFlowOwner(env, ownerKey, action, payload = {}) {
  if (!hasActiveFlowOwner(env) || !ownerKey) return null;
  const namespace = env[ACTIVE_FLOW_OWNER_BINDING];
  const stub = namespace.get(namespace.idFromName(ownerKey));
  const response = await stub.fetch('https://active-flow-owner.internal/state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ownerKey, ...payload })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result?.ok === false) {
    throw new Error(`active_flow_owner_${action}_failed:${result?.error || response.status}`);
  }
  return result;
}

function buildActiveFlowKey(userId) {
  return `${ACTIVE_FLOW_KEY_PREFIX}${String(userId || '').trim()}`;
}

function createActiveFlowIdentity(event, flowType = 'reservation') {
  const commandTs = Number(event?.timestamp || Date.now());
  const eventId = String(event?.webhookEventId || event?.message?.id || event?.replyToken || '').trim();
  const randomId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const suffix = eventId || randomId;
  return {
    flowId: `${String(flowType || 'flow').trim().toLowerCase()}:${suffix}`,
    // GAS uses an incrementing numeric generation for booking buttons. Keep
    // the command identity in flowId and start every new command at version 1.
    version: '1',
    commandTs
  };
}

function isSameActiveFlow(current, expected) {
  if (!current || !expected) return false;
  const expectedFlowId = String(expected.flowId || '').trim();
  const expectedVersion = String(expected.version || expected.flowVersion || '').trim();
  if (expectedFlowId && String(current.flowId || '').trim() !== expectedFlowId) return false;
  if (expectedVersion && String(current.version || current.flowVersion || '').trim() !== expectedVersion) return false;
  return !!(expectedFlowId || expectedVersion);
}

function getReservationFlowTtlSecondsByPhase(phase) {
  const p = String(phase || '').trim().toLowerCase();
  if (p === 'await_id' || p === 'confirm_id') return BOOKING_ID_TTL_SECONDS;
  return BOOKING_PAYMENT_FLOW_TTL_SECONDS;
}

function parseFlowExpiresAt(value) {
  if (value === null || value === undefined || value === '') return 0;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    // Accept both epoch seconds and epoch milliseconds at the boundary.
    return numeric < 1e12 ? Math.trunc(numeric * 1000) : Math.trunc(numeric);
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function isReservationActiveFlowPhase(phase) {
  return RESERVATION_ACTIVE_FLOW_PHASES.has(String(phase || '').trim().toLowerCase());
}

function isReservationFlowScopeMatchEvent(flow, ev) {
  if (!flow || !ev) return false;
  const source = ev.source || {};
  const sourceType = String(source.type || '').trim();
  const userId = String(source.userId || '').trim();
  const flowUserId = String(flow.userId || '').trim();
  const flowScopeType = String(flow.scopeType || '').trim();
  const flowScopeId = String(flow.scopeId || '').trim();
  if (flowUserId && userId && flowUserId !== userId) return false;
  if (!flowScopeType) return true;
  if (flowScopeType === 'user') return sourceType === 'user';
  if (flowScopeType === 'group') return sourceType === 'group' && String(source.groupId || '').trim() === flowScopeId;
  if (flowScopeType === 'room') return sourceType === 'room' && String(source.roomId || '').trim() === flowScopeId;
  return true;
}

async function setActiveFlow(env, userId, flow) {
  const uid = String(userId || '').trim();
  if (!uid || !flow || typeof flow !== 'object') return null;
  const now = Date.now();
  const phase = String(flow.phase || '').trim().toLowerCase() || 'await_slip';
  const ttl = Math.max(1, Number(flow.ttlSeconds) || getReservationFlowTtlSecondsByPhase(phase));
  const requestedExpiresAt = parseFlowExpiresAt(flow.expiresAt);
  const expiresAt = requestedExpiresAt || (now + (ttl * 1000));
  const identity = (flow.flowId && (flow.version || flow.flowVersion))
    ? {
      flowId: String(flow.flowId),
      version: String(flow.version || flow.flowVersion),
      commandTs: Number(flow.commandTs || now)
    }
    : createActiveFlowIdentity(flow.event, flow.flowType || flow.kind || 'reservation');
  const ownerKey = buildActiveFlowOwnerKey(uid, flow);
  const state = {
    flowType: String(flow.flowType || 'reservation').trim().toLowerCase(),
    kind: String(flow.kind || flow.flowType || 'reservation').trim().toLowerCase(),
    phase,
    code: flow.code ? String(flow.code).trim().toUpperCase() : '',
    scopeType: String(flow.scopeType || 'user').trim(),
    scopeId: String(flow.scopeId || '').trim(),
    userId: uid,
    ownerKey,
    flowId: identity.flowId,
    version: identity.version,
    flowVersion: identity.version,
    commandTs: identity.commandTs,
    commandEventId: String(flow.commandEventId || flow.event?.webhookEventId || '').trim(),
    context: flow.context && typeof flow.context === 'object' ? flow.context : {},
    ts: now,
    expiresAt
  };
  if (hasActiveFlowOwner(env)) {
    // A newly delivered LINE event is the user's latest explicit command and
    // must be allowed to replace poisoned/future-dated state left by an older
    // deployment. Only redeliveries retain timestamp-based stale protection.
    const force = flow.event?.deliveryContext?.isRedelivery !== true;
    const result = await callActiveFlowOwner(env, ownerKey, 'replace', { flow: state, force });
    return result?.accepted === false ? null : (result?.flow || state);
  }

  // Local/unit-test fallback. Production is configured with the Durable
  // Object above; KV remains only a backwards-compatible development path.
  const current = await kvGet(env, buildActiveFlowKey(uid));
  if (
    current &&
    String(current.commandEventId || '') !== String(state.commandEventId || '') &&
    Number(current.commandTs || 0) > Number(state.commandTs || 0)
  ) return null;
  // KV requires a minimum 60-second storage TTL; expiresAt remains exact and
  // is enforced on every read. Production ownership uses the Durable Object.
  const storageTtl = Math.max(60, Math.ceil((expiresAt - now) / 1000));
  await kvPutStrict(env, buildActiveFlowKey(uid), state, storageTtl);
  return state;
}

async function replaceWithReservationFlow(env, event, flow, options = {}) {
  const userId = String(event?.source?.userId || '').trim();
  if (!userId) return null;

  const scopeType = String(event?.source?.type || '').trim() || 'user';
  const scopeId = scopeType === 'group'
    ? String(event?.source?.groupId || '').trim()
    : (scopeType === 'room' ? String(event?.source?.roomId || '').trim() : '');

  const activeFlow = await setActiveFlow(env, userId, {
    ...flow,
    flowType: 'reservation',
    kind: 'reservation',
    event,
    scopeType,
    scopeId
  });
  if (!activeFlow) return null;

  const cleanupPromise = clearUserWorkflowStatesForEvent(
    env,
    event,
    'reservation',
    { preserveActiveFlow: true }
  );
  if (options?.deferLegacyCleanup) {
    return { ...activeFlow, cleanupPromise };
  }
  await cleanupPromise;
  return getActiveFlow(env, userId, activeFlow);
}

async function getActiveFlow(env, userId, scopeHint = null) {
  const uid = String(userId || '').trim();
  if (!uid) return null;
  const ownerKey = buildActiveFlowOwnerKey(uid, scopeHint);
  if (hasActiveFlowOwner(env)) {
    const result = await callActiveFlowOwner(env, ownerKey, 'get');
    return result?.flow || null;
  }
  const key = buildActiveFlowKey(uid);
  const flow = await kvGet(env, key);
  if (!flow) return null;
  const expiresAt = Number(flow.expiresAt || 0);
  if (expiresAt && Date.now() > expiresAt) {
    await kvDel(env, key);
    return null;
  }
  return flow;
}

async function clearActiveFlow(env, userId, scopeHint = null) {
  const uid = String(userId || '').trim();
  if (!uid) return;
  const ownerKey = buildActiveFlowOwnerKey(uid, scopeHint);
  if (hasActiveFlowOwner(env)) {
    await callActiveFlowOwner(env, ownerKey, 'clear');
    return;
  }
  await kvDel(env, buildActiveFlowKey(uid));
}

async function updateActiveFlowIfCurrent(env, userId, expected, patch = {}) {
  const uid = String(userId || '').trim();
  const ownerKey = buildActiveFlowOwnerKey(uid, expected);
  if (hasActiveFlowOwner(env)) {
    const now = Date.now();
    const ttl = Math.max(
      1,
      Number(patch.ttlSeconds) || getReservationFlowTtlSecondsByPhase(patch.phase || expected?.phase)
    );
    const requestedExpiresAt = parseFlowExpiresAt(patch.expiresAt);
    const expiresAt = requestedExpiresAt || (now + (ttl * 1000));
    const result = await callActiveFlowOwner(env, ownerKey, 'updateIfCurrent', {
      expected: {
        flowId: String(expected?.flowId || ''),
        version: String(expected?.version || expected?.flowVersion || '')
      },
      patch: {
        ...patch,
        version: String(patch.version || patch.flowVersion || (
          patch.preserveVersion
            ? expected?.version
            : String(Math.max(1, Number(expected?.version || 1)) + 1)
        )),
        flowVersion: String(patch.version || patch.flowVersion || (
          patch.preserveVersion
            ? expected?.version
            : String(Math.max(1, Number(expected?.version || 1)) + 1)
        )),
        ts: now,
        expiresAt
      }
    });
    return result?.updated ? (result.flow || null) : null;
  }

  const current = await getActiveFlow(env, uid, expected);
  if (!isSameActiveFlow(current, expected)) return null;
  return setActiveFlow(env, userId, {
    ...current,
    ...patch,
    flowId: current.flowId,
    version: String(patch.version || patch.flowVersion || (
      patch.preserveVersion
        ? current.version
        : String(Math.max(1, Number(current.version || 1)) + 1)
    )),
    commandTs: current.commandTs,
    ttlSeconds: patch.ttlSeconds || getReservationFlowTtlSecondsByPhase(patch.phase || current.phase)
  });
}

async function clearActiveFlowIfCurrent(env, userId, expected) {
  const uid = String(userId || '').trim();
  const ownerKey = buildActiveFlowOwnerKey(uid, expected);
  if (hasActiveFlowOwner(env)) {
    const result = await callActiveFlowOwner(env, ownerKey, 'clearIfCurrent', {
      expected: {
        flowId: String(expected?.flowId || ''),
        version: String(expected?.version || expected?.flowVersion || '')
      }
    });
    return !!result?.cleared;
  }
  const current = await getActiveFlow(env, userId, expected);
  if (!isSameActiveFlow(current, expected)) return false;
  await clearActiveFlow(env, userId, expected);
  return true;
}

function buildReservationForwardPayload(event, flow) {
  const version = String(flow?.version || flow?.flowVersion || '').trim();
  const code = String(flow?.code || '').trim().toUpperCase();
  const phase = String(flow?.phase || '').trim().toLowerCase();
  const lineUserId = String(event?.source?.userId || flow?.userId || '').trim();
  const metadata = {
    contract: ACTIVE_FLOW_CONTRACT_VERSION,
    flowType: 'reservation',
    kind: 'reservation',
    flowId: String(flow?.flowId || '').trim(),
    flowVersion: version,
    version,
    phase,
    flowPhase: phase,
    lineUserId,
    bookingCode: code,
    reservationId: code,
    webhookEventId: String(event?.webhookEventId || '').trim(),
    messageId: String(event?.message?.id || '').trim()
  };
  const forwardedEvent = {
    ...event,
    // GAS forwarded-event handlers consume event-local metadata. Keeping the
    // same fields at the request root preserves compatibility with admin APIs.
    reservationFlow: metadata,
    workerFlow: metadata,
    flowId: metadata.flowId,
    flowVersion: metadata.flowVersion,
    version: metadata.version,
    phase: metadata.phase,
    bookingCode: metadata.bookingCode,
    reservationId: metadata.reservationId
  };
  return {
    events: [forwardedEvent],
    reservationFlow: metadata,
    flowId: metadata.flowId,
    flowVersion: version,
    version,
    phase,
    lineUserId,
    bookingCode: code,
    reservationId: code,
    webhookEventId: metadata.webhookEventId,
    messageId: metadata.messageId
  };
}

function getReservationFlowAck(data) {
  const ack = data?.reservationFlow && typeof data.reservationFlow === 'object'
    ? data.reservationFlow
    : data;
  if (!ack || typeof ack !== 'object') return null;
  const phase = String(ack.flowPhase || ack.phase || '').trim().toLowerCase();
  const flowExpiresAt = parseFlowExpiresAt(ack.flowExpiresAtMs || ack.flowExpiresAt || ack.expiresAt);
  const expiredByAbsoluteDeadline = flowExpiresAt > 0 && flowExpiresAt <= Date.now();
  const clearActiveFlow = ack.clearActiveFlow === true ||
    String(ack.clearActiveFlow || '').trim().toLowerCase() === 'true' ||
    expiredByAbsoluteDeadline;
  const terminal = RESERVATION_TERMINAL_FLOW_PHASES.has(phase) || clearActiveFlow;
  if (!isReservationActiveFlowPhase(phase) && !terminal) return null;
  const ttlHint = Number(ack.flowTtlSeconds);
  const ttlSeconds = flowExpiresAt > Date.now()
    ? Math.max(1, Math.ceil((flowExpiresAt - Date.now()) / 1000))
    : (Number.isFinite(ttlHint) && ttlHint > 0
      ? ttlHint
      : getReservationFlowTtlSecondsByPhase(phase));
  return {
    phase,
    terminal,
    clearActiveFlow,
    outcome: String(ack.outcome || ack.result || ack.status || '').trim().toLowerCase(),
    flowId: String(ack.flowId || '').trim(),
    version: String(ack.flowVersion || ack.version || '').trim(),
    code: String(ack.reservationId || ack.bookingCode || ack.code || '').trim().toUpperCase(),
    ttlSeconds,
    expiresAt: flowExpiresAt || 0
  };
}

async function syncReservationFlowFromGasAck(env, userId, expected, data, fallbackPhase = '') {
  if (!userId || !expected) return null;
  const ack = getReservationFlowAck(data);
  // Phase inference from HTTP success was the source of state loss. A booking
  // transition is accepted only when GAS returns its structured flow result.
  if (!ack) return null;
  const phase = ack.phase || String(fallbackPhase || '').trim().toLowerCase();
  if (ack.terminal) return null;
  if (!isReservationActiveFlowPhase(phase)) return null;
  if (ack?.flowId && ack.flowId !== String(expected.flowId || '')) return null;
  if (!ack?.flowId || !ack?.version) return null;
  if (ack?.code && expected?.code && ack.code !== String(expected.code).trim().toUpperCase()) return null;
  return updateActiveFlowIfCurrent(env, userId, expected, {
    phase,
    code: ack?.code || expected.code || '',
    version: ack?.version || expected.version,
    preserveVersion: !ack?.version,
    ttlSeconds: ack?.ttlSeconds || getReservationFlowTtlSecondsByPhase(phase),
    expiresAt: ack?.expiresAt || undefined
  });
}

const COMMAND_INVISIBLE_CHAR_RE = /[\u200B-\u200D\u2060\uFEFF\u202A-\u202E\u2066-\u2069]/g;

function normalizeCommandText(text) {
  return String(text || '')
    .normalize('NFKC')
    // NFKC decomposes Thai SARA AM (ำ) into NIKHAHIT + SARA AA. Recompose it
    // so normalized input still matches the Thai command literals below.
    .replace(/\u0E4D\u0E32/g, '\u0E33')
    .replace(COMMAND_INVISIBLE_CHAR_RE, '')
    .replace(/\u00A0/g, ' ')
    .trim();
}

function parseBookingCodeCommand(text) {
  const compact = normalizeCommandText(text).replace(/\s+/g, '').toUpperCase();
  const match = /^#?MM(\d{3,})$/.exec(compact);
  return match ? `#MM${match[1]}` : null;
}

function extractBookingCode(text) {
  const normalized = normalizeCommandText(text).replace(/\s+/g, '');
  const match = /MM\d{3,}/i.exec(normalized);
  if (!match) return null;
  const code = match[0].toUpperCase();
  return code.startsWith('#') ? code : `#${code}`;
}

function withCanonicalTextEvent(event, text) {
  return {
    ...event,
    message: {
      ...(event?.message || {}),
      text
    }
  };
}

const PREBOOK_BIND_TTL_SECONDS = 180 * 24 * 60 * 60;

function extractPrebookCode(text) {
  const match = /PB\d{3,}/i.exec(text || '');
  if (!match) return null;
  const code = match[0].toUpperCase();
  return code.startsWith('#') ? code : `#${code}`;
}

function buildPrebookUserKey(userId) {
  return `prebook_user:${String(userId || '').trim()}`;
}

function buildPrebookCodeKey(code) {
  const normalized = String(code || '').trim().replace(/^#/, '').toUpperCase();
  return `prebook_code:${normalized}`;
}

const OWNER_APPROVAL_KEYWORD_RE = /^(?:อนุมัติ|ไม่อนุมัติ)\s*(?:เปลี่ยนไลน์|เปลี่ยนไอดีผู้เช่า|line\s*id\s*change)/i;

const AVAILABILITY_REGEXES = [
  /(ห้อง|ตึก)[\s\S]{0,10}(ยัง)?ว่าง/i,
  /(ยัง)?มีห้อง/i,
  /เหลือห้อง/i,
  /ห้องเต็มไหม/i,
  /(ห้อง|ห้องพัก)[\s\S]{0,10}เต็ม[\s\S]{0,10}(รึยัง|หรือยัง|ยัง|ไหม|มั้ย|มั๊ย)/i,
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

function isKmitlTravelGuideIntent(text) {
  const raw = String(text || '').trim();
  if (!raw) return false;

  const normalized = raw
    .toLowerCase()
    .replace(/[“”"'`]/g, '')
    .replace(/\s+/g, '');

  const mentionsCampus =
    /(kmitl|สจล|พระจอมเกล้า(?:เจ้าคุณทหาร)?ลาดกระบัง|ลาดกระบัง|ม\.?ลาดกระบัง)/i.test(raw) ||
    /(kmitl|สจล|พระจอมเกล้า(?:เจ้าคุณทหาร)?ลาดกระบัง|ลาดกระบัง|มลาดกระบัง)/i.test(normalized);

  const mentionsSongthaew =
    /(สองแถว|2แถว|รถสองแถว|รถแดง)/i.test(raw) ||
    /(สองแถว|2แถว|รถสองแถว|รถแดง)/i.test(normalized);

  const asksFare =
    /(ราคา|ค่าโดยสาร|กี่บาท|เท่าไหร่|เท่าไร)/i.test(raw) ||
    /(ราคา|ค่าโดยสาร|กี่บาท|เท่าไหร่|เท่าไร)/i.test(normalized);

  const asksDistance =
    /(ระยะทาง|ห่าง|กี่กิโล|กี่โล|กิโลเมตร|ไกลไหม)/i.test(raw) ||
    /(ระยะทาง|ห่าง|กี่กิโล|กี่โล|กิโลเมตร|ไกลไหม)/i.test(normalized);

  const asksRouteOrTransit =
    /(เดินทาง|ไปยังไง|ไปไง|ไปยังงัย|วิธีไป|ทางไป|นั่งอะไร|ขึ้นอะไร|วิ่งผ่าน|ผ่านแถว|ถึงมอ)/i.test(raw) ||
    /(เดินทาง|ไปยังไง|ไปไง|ไปยังงัย|วิธีไป|ทางไป|นั่งอะไร|ขึ้นอะไร|วิ่งผ่าน|ผ่านแถว|ถึงมอ)/i.test(normalized);

  if (mentionsCampus && (asksRouteOrTransit || asksDistance || asksFare || mentionsSongthaew)) return true;
  if (mentionsSongthaew && (asksFare || asksRouteOrTransit || normalized.includes('ถึงมอ'))) return true;

  return false;
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

function isRoomRentInquiry(text) {
  const normalized = (text || '').trim().toLowerCase();
  if (!normalized) return false;
  if (/ราคา(?:ห้อง|ห้องพัก)?|(?:ห้อง|ห้องพัก)[\s\S]{0,20}ราคา|ค่าเช่า(?:ห้อง|ห้องพัก)?|(?:ห้อง|ห้องพัก)[\s\S]{0,20}ค่าเช่า/i.test(normalized)) return true;
  if (/(?:ห้อง|ห้องพัก)[\s\S]{0,30}(เท่าไหร่|กี่บาท|ต่อเดือน|เดือนละ)/i.test(normalized)) return true;
  return ['room price', 'room rent', 'rent per month', 'monthly rent'].some((kw) => normalized.includes(kw));
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

function normalizeKeyRentPaymentMethod(paymentRaw) {
  const payment = String(paymentRaw || '').trim().toUpperCase();
  if (payment === 'CASH' || payment === 'MOBILE_BANKING') return payment;
  return '';
}

function parseKeyRentPaymentMethod(textRaw) {
  const raw = String(textRaw || '').trim();
  if (!raw) return '';

  const compactLower = raw.toLowerCase().replace(/\s+/g, '');
  if (
    compactLower.endsWith('เงินสด') ||
    compactLower.endsWith('สด') ||
    compactLower.endsWith('cash')
  ) {
    return 'CASH';
  }
  if (
    compactLower.endsWith('โอนจ่าย') ||
    compactLower.endsWith('โอนเงิน') ||
    compactLower.endsWith('โอน') ||
    compactLower.endsWith('bank') ||
    compactLower.endsWith('mobilebanking')
  ) {
    return 'MOBILE_BANKING';
  }
  return '';
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
  const keyRent = buildKeyRentDetails(mode, room, raw);
  if (!keyRent) return null;
  const paymentMethod = parseKeyRentPaymentMethod(raw);
  if (paymentMethod) keyRent.paymentMethod = paymentMethod;
  return keyRent;
}

// Legacy "key A101 20" parser for forgot-key flow
function parseKeyKeyword(text) {
  const raw = normalizeCommandText(text);
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

async function handleKeyForgotTextCommand(
  env,
  ev,
  replyToken,
  rawText,
  keyForgotPayload,
  onStateReady = () => {}
) {
  const chatId = getChatId(ev);
  const userId = String(ev?.source?.userId || '').trim();
  const stateKey = getStateKey(ev);
  const penaltyKey = `${stateKey}:penalty_flow`;
  const timestamp = new Date().toISOString();
  const commandOwner = userId ? await setActiveFlow(env, userId, {
    flowType: 'key_forgot',
    kind: 'key_forgot',
    phase: 'starting',
    event: ev,
    scopeType: String(ev?.source?.type || '').trim() || 'user',
    scopeId: String(ev?.source?.groupId || ev?.source?.roomId || '').trim(),
    ttlSeconds: PENALTY_FLOW_TTL_SECONDS
  }) : null;

  if (userId && !commandOwner) {
    onStateReady(false);
    console.log('stale_text_command_ignored', {
      kind: 'key_forgot',
      userId,
      webhookEventId: ev?.webhookEventId || ''
    });
    return false;
  }

  const ackText = [
    `รับข้อมูลคีย์ตึก ${keyForgotPayload.building} ห้อง ${keyForgotPayload.room} จำนวน ${keyForgotPayload.amount} แล้วค่ะ กำลังส่งให้เจ้าหน้าที่`,
    'หากชำระแล้ว กรุณาส่งสลิปในแชตนี้ได้เลยค่ะ'
  ].join('\n');
  const ackPromise = replyOrPushText(
    env,
    replyToken,
    chatId,
    ackText,
    'key_forgot_ack_failed'
  );

  const workflowPromise = (async () => {
    const clearedKeys = await clearUserWorkflowStatesForEvent(
      env,
      ev,
      'text_command:key_forgot',
      { preserveActiveFlow: true }
    );
    console.log('text_command_classified', {
      kind: 'key_forgot',
      statePolicy: TEXT_COMMAND_REPLACE_FLOW,
      userId,
      chatId,
      clearedStateCount: clearedKeys.length,
      webhookEventId: ev?.webhookEventId || ''
    });

    const roomId = `${keyForgotPayload.building || ''}${keyForgotPayload.room || ''}`.trim().toUpperCase();
    const penaltyContext = {
      ts: Date.now(),
      chatId,
      userId,
      type: 'Others_payment',
      reason: 'KEY_FORGOT',
      ...(roomId ? { roomId, room: roomId } : {}),
      ...(keyForgotPayload.building
        ? { building: String(keyForgotPayload.building).trim().toUpperCase() }
        : {}),
      amount: Number(keyForgotPayload.amount)
    };
    const activeFlow = userId
      ? await updateActiveFlowIfCurrent(env, userId, commandOwner, {
        flowType: 'key_forgot',
        kind: 'key_forgot',
        phase: 'await_slip',
        context: { penaltyFlow: penaltyContext },
        preserveVersion: true,
        ttlSeconds: PENALTY_FLOW_TTL_SECONDS
      })
      : null;

    if (userId && !activeFlow) {
      onStateReady(false);
      console.log('key_forgot_state_update_stale_ignored', {
        userId,
        chatId,
        flowId: commandOwner?.flowId || ''
      });
      return false;
    }

    const flow = {
      ...penaltyContext,
      ...(activeFlow ? {
        flowId: activeFlow.flowId,
        version: activeFlow.version,
        flowVersion: activeFlow.version
      } : {})
    };
    const mirrorResult = await Promise.allSettled([
      kvPutStrict(env, penaltyKey, flow, PENALTY_FLOW_TTL_SECONDS)
    ]);
    if (mirrorResult[0]?.status === 'rejected') {
      console.warn('key_forgot_kv_mirror_partial_failure', {
        userId,
        chatId,
        flowId: activeFlow?.flowId || '',
        failedMirrors: [{
          key: penaltyKey,
          error: String(mirrorResult[0].reason?.message || mirrorResult[0].reason)
        }]
      });
    }
    onStateReady(true);

    // Legacy n8n contract from 8da308e. Keep this as the unwrapped request
    // body and preserve the field names; the receiver reads them directly.
    const payload = {
      ...keyForgotPayload,
      text: rawText,
      userId: userId || null,
      chatId: chatId || null,
      sourceType: ev?.source?.type || null,
      messageId: ev?.message?.id || null,
      flowId: activeFlow?.flowId || '',
      flowVersion: activeFlow?.version || '',
      version: activeFlow?.version || '',
      receivedAt: timestamp
    };
    const ok = await notifyN8nKeyForgotWebhook(env, payload);
    if (!ok && chatId) {
      const current = userId ? await getActiveFlow(env, userId, activeFlow || ev) : null;
      if (!activeFlow || isSameActiveFlow(current, activeFlow)) {
        await safeLinePushText(
          env.LINE_ACCESS_TOKEN,
          chatId,
          'รับข้อมูลลืมกุญแจแล้ว แต่ระบบแจ้งเจ้าหน้าที่ยังไม่ตอบ กรุณาพิมพ์คำสั่งเดิมอีกครั้งค่ะ',
          'key_forgot_webhook_failure_push_failed'
        );
      }
    }
    return ok;
  })();

  const [, workflowResult] = await Promise.allSettled([ackPromise, workflowPromise]);
  if (workflowResult.status === 'rejected') throw workflowResult.reason;
  return workflowResult.value;
}

const TEXT_COMMAND_REPLACE_FLOW = 'replace_flow';
const TEXT_COMMAND_BYPASS_FLOW = 'bypass_flow';
const TEXT_STATE_CHECKOUT_AMOUNT = 'checkout_cash_amount';
const TEXT_STATE_CHECKOUT_IMAGE = 'checkout_cash_image';
const TEXT_STATE_PARKING_PHONE = 'parking_phone';
const TEXT_STATE_REGISTRATION_ROOM = 'registration_room';
const TEXT_STATE_TENANT_CHANGE_ROOM = 'tenant_change_room';
const TEXT_STATE_PENALTY_REASON = 'penalty_reason';
const TEXT_STATE_PAYMENT_IMAGE = 'payment_image';

// This is the single routing policy for text that represents a new command.
// A known command must never be consumed as input for an older workflow state.
// Commands that start a new workflow replace the sender's old state; information
// commands bypass the old state without canceling it.
function classifyTextCommand(text, options = {}) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  const checkoutPayment = parseCheckoutPaymentText(raw);
  if (checkoutPayment) {
    return { kind: 'checkout_payment', statePolicy: TEXT_COMMAND_REPLACE_FLOW };
  }
  if (parseCheckinCommand(raw)) {
    return { kind: 'checkin', statePolicy: TEXT_COMMAND_REPLACE_FLOW };
  }
  if (parseCleaningCommand(raw)) {
    return { kind: 'cleaning', statePolicy: TEXT_COMMAND_BYPASS_FLOW };
  }
  if (options.isOwnerGroup && /โหมดคัดกรอง/i.test(raw)) {
    return { kind: 'screening_config', statePolicy: TEXT_COMMAND_BYPASS_FLOW };
  }

  const coAdminShortcut = parseCoAdminShortcut(raw);
  if (coAdminShortcut) {
    return {
      kind: 'co_admin',
      statePolicy: isCheckoutStartShortcut(coAdminShortcut)
        ? TEXT_COMMAND_REPLACE_FLOW
        : TEXT_COMMAND_BYPASS_FLOW
    };
  }

  if (/^\s*จ่าย\s*เงิน\s*มามา\s*แมนชั่น\s*$/i.test(raw)) {
    return { kind: 'payment_menu', statePolicy: TEXT_COMMAND_BYPASS_FLOW };
  }

  const presetPaymentReason = detectPresetOtherPaymentReason(raw, checkoutPayment);
  if (presetPaymentReason) {
    return { kind: 'preset_payment', statePolicy: TEXT_COMMAND_REPLACE_FLOW };
  }
  if (parseKeyRent(raw)) {
    return { kind: 'key_rent', statePolicy: TEXT_COMMAND_REPLACE_FLOW };
  }
  if (parseKeyKeyword(raw)) {
    return { kind: 'key_forgot', statePolicy: TEXT_COMMAND_REPLACE_FLOW };
  }
  if (/เปลี่ยนไอดีผู้เช่า/i.test(raw)) {
    return { kind: 'tenant_id_change', statePolicy: TEXT_COMMAND_REPLACE_FLOW };
  }
  if (raw === 'ลงทะเบียนไอดี') {
    return { kind: 'registration', statePolicy: TEXT_COMMAND_REPLACE_FLOW };
  }
  if (/^\s*แจ้งออก\s*$/i.test(raw)) {
    return { kind: 'moveout', statePolicy: TEXT_COMMAND_REPLACE_FLOW };
  }
  if (/^\s*(ส่งสลิปค่าเช่า|ชำระค่าเช่า|ชำระค่าเช่าห้อง|จ่ายค่าเช่า|จ่ายค่าเช่าห้อง|send\s*rent\s*slip|pay\s*rent)\s*$/i.test(raw)) {
    return { kind: 'pay_rent', statePolicy: TEXT_COMMAND_REPLACE_FLOW };
  }
  if (/^\s*(ชำระค่าปรับ|ชำระค่าอื่นๆ)\s*$/i.test(raw)) {
    return { kind: 'penalty_payment', statePolicy: TEXT_COMMAND_REPLACE_FLOW };
  }
  if (parseCheckoutTrigger(raw)) {
    return { kind: 'checkout', statePolicy: TEXT_COMMAND_REPLACE_FLOW };
  }
  if (parseReturnKeyTrigger(raw)) {
    return { kind: 'return_key', statePolicy: TEXT_COMMAND_REPLACE_FLOW };
  }
  if (isCheckinChangeIntent(raw)) {
    return { kind: 'checkin_change', statePolicy: TEXT_COMMAND_REPLACE_FLOW };
  }
  if (/^#?\s*PB\d{3,}$/i.test(raw)) {
    return { kind: 'prebook_code', statePolicy: TEXT_COMMAND_REPLACE_FLOW };
  }
  if (parseBookingCodeCommand(raw)) {
    return { kind: 'booking_code', statePolicy: TEXT_COMMAND_REPLACE_FLOW };
  }

  const fridgeIntent = detectFridgeIntent(raw);
  if (fridgeIntent.matches) {
    return { kind: 'fridge_info', statePolicy: TEXT_COMMAND_BYPASS_FLOW };
  }
  if (isParkingIntent(raw)) {
    return { kind: 'parking_info', statePolicy: TEXT_COMMAND_BYPASS_FLOW };
  }
  if (ROOM_LABEL_MAP[raw] || FIX_LABEL_MAP[raw]) {
    return { kind: 'menu_label', statePolicy: TEXT_COMMAND_BYPASS_FLOW };
  }
  if (options.fastReply) {
    return { kind: 'quick_keyword', statePolicy: TEXT_COMMAND_BYPASS_FLOW };
  }

  return null;
}

// A state is allowed to consume text only when the text matches the exact
// input type that state is waiting for. Waiting-for-image states never own text.
function shouldTextStateConsumeInput(stateType, text, commandRoute = null) {
  if (commandRoute) return false;
  const raw = String(text || '').trim();

  if (stateType === TEXT_STATE_CHECKOUT_AMOUNT) {
    return !!parseCheckoutCashAmount(raw);
  }
  if (stateType === TEXT_STATE_PARKING_PHONE) {
    return isValidParkingPhone(normalizeParkingPhone(raw));
  }
  if (stateType === TEXT_STATE_REGISTRATION_ROOM) {
    if (raw === 'ยกเลิก' || raw.toLowerCase() === 'cancel') return true;
    return /^([AB])(\d{3,4})$/i.test(raw.replace(/\s+/g, ''));
  }
  if (stateType === TEXT_STATE_TENANT_CHANGE_ROOM) {
    return !!parseRoomToken(raw.replace(/\s+/g, ''));
  }
  if (stateType === TEXT_STATE_PENALTY_REASON) {
    return !!raw;
  }
  if (stateType === TEXT_STATE_CHECKOUT_IMAGE || stateType === TEXT_STATE_PAYMENT_IMAGE) {
    return false;
  }

  return false;
}

/* =========================
 * 1) KV + Loading helpers
 * ========================= */
function hasKV(env) { return !!(env && env.KV && typeof env.KV.get === 'function'); }
async function kvGet(env, k) { try { if (!hasKV(env)) return null; return await env.KV.get(k, 'json'); } catch (_) { return null; } }
async function kvPutStrict(env, k, v, ttlSeconds) {
  if (!hasKV(env)) throw new Error('missing_kv_binding');
  await env.KV.put(k, JSON.stringify(v), { expirationTtl: ttlSeconds || 7200 });
}
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

async function safeLinePushText(channelToken, to, text, logLabel = 'line_push_failed') {
  if (!channelToken || !to || !text) return false;
  try {
    await linePushText(channelToken, to, text);
    return true;
  } catch (err) {
    console.error(logLabel, {
      to,
      error: String(err?.message || err)
    });
    return false;
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
  // Booking flow endpoint
  return env.CONFIRMBOOKING_URL || '';
}

function getReservationAdminKey(env) {
  return String(env?.ADMIN_API_KEY || '').trim();
}

function getWorkerForwardSecret(env) {
  return String(env?.WORKER_SECRET || env?.MM_WORKER_SECRET || '').trim();
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

function getN8nPayRentUrl(env) {
  return env.N8N_PAYRENT_URL || '';
}

const DEFAULT_N8N_RENT_KEY_RECEIVER_URL = 'https://n8n.srv1112305.hstgr.cloud/webhook/rent-key-receiver';
function getRentKeyReceiverUrl(env) {
  // Env var: N8N_RENT_KEY_RECEIVER_URL (optional). If unset, the default webhook URL above is used.
  return env.N8N_RENT_KEY_RECEIVER_URL || DEFAULT_N8N_RENT_KEY_RECEIVER_URL;
}

async function notifyRentKeyReceiver(env, payload) {
  const url = getRentKeyReceiverUrl(env);
  if (!url) {
    console.warn('notifyRentKeyReceiver: missing webhook URL');
    return false;
  }

  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const workerSecret = String(env?.WORKER_SECRET || env?.MM_WORKER_SECRET || '').trim();
  if (workerSecret) {
    headers['x-worker-secret'] = workerSecret;
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error('notifyRentKeyReceiver non-200', res.status, text.slice(0, 200));
    }
    return res.ok;
  } catch (err) {
    console.error('notifyRentKeyReceiver error', err);
    return false;
  }
}

const DEFAULT_N8N_CONTINUE_TERM_REPLY_URL = 'https://n8n.srv1112305.hstgr.cloud/webhook/CONTINUE_TERM_REPLY';
function normalizeRenewalAction(action) {
  const normalized = String(action || '').trim().toUpperCase();
  if (normalized === 'RENEWAL_ADMIN_PICK_SIGNING_FOLLOWUP') {
    return 'RENEWAL_ADMIN_PICK_SIGNING';
  }
  return normalized;
}

function isContinueTermReplyAction(action) {
  const normalized = normalizeRenewalAction(action);
  return (
    normalized === 'RENEWAL_ACCEPT_TERMS' ||
    normalized === 'RENEWAL_ASK_MORE' ||
    normalized === 'RENEWAL_SIGN_SLOT_CONFIRM' ||
    normalized === 'RENEWAL_SIGN_SLOT_CHANGE' ||
    normalized === 'RENEWAL_ADMIN_PICK_SIGNING'
  );
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

async function forwardToSpecificGasResult(env, gasUrl, body) {
  const secret = getWorkerForwardSecret(env);
  const payload = { ...body, workerSecret: secret };

  if (!gasUrl || !secret) {
    console.error('forwardToSpecificGas: missing config', { hasUrl: !!gasUrl, hasSecret: !!secret });
    return { ok: false, status: 0, data: {}, text: '', error: 'missing_config' };
  }

  let ok = false, status = 0, text = '', data = {};
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
      data = j;
      ok = res.ok && (Object.prototype.hasOwnProperty.call(j, 'ok') ? !!j.ok : true);
      text = JSON.stringify(j);
    } else {
      text = await res.text();
      ok = res.ok && text.trim() === 'OK';
    }
  } catch (e) {
    console.error('forwardToSpecificGas error', String(e));
  }
  console.log('forwardToSpecificGas result', { url: (new URL(gasUrl)).host, status, ok, text: ('' + text).slice(0, 200) });
  return { ok, status, data, text };
}

async function forwardToSpecificGas(env, gasUrl, body) {
  const result = await forwardToSpecificGasResult(env, gasUrl, body);
  return !!result.ok;
}

/** Forward any payload to GAS with header+body secret. Returns boolean ok. */
async function forwardToGas(env, body) {
  const gasUrl = getWebhookGas(env);
  const secret = getWorkerForwardSecret(env);
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

/**
 * Strongly-consistent owner for the latest command in one conversation scope.
 * Every mutation is serialized in one Durable Object, so an async callback
 * from an older command cannot clear or overwrite the latest flow.
 */
export class ActiveFlowOwner {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  json(body, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }

  async readCurrent(storage = this.state.storage) {
    const current = await storage.get('flow');
    if (!current) return null;
    const expiresAt = Number(current.expiresAt || 0);
    if (expiresAt && expiresAt <= Date.now()) {
      await storage.delete('flow');
      return null;
    }
    return current;
  }

  async fetch(request) {
    if (request.method !== 'POST') return this.json({ ok: false, error: 'method_not_allowed' }, 405);
    let body = {};
    try {
      body = await request.json();
    } catch (_) {
      return this.json({ ok: false, error: 'invalid_json' }, 400);
    }

    const action = String(body?.action || '').trim();
    try {
      if (action === 'get') {
        return this.json({ ok: true, flow: await this.readCurrent() });
      }

      if (action === 'replace') {
        const incoming = body?.flow;
        const force = body?.force === true;
        if (!incoming?.flowId || !incoming?.version) {
          return this.json({ ok: false, error: 'invalid_flow' }, 400);
        }
        const result = await this.state.storage.transaction(async (txn) => {
          const current = await this.readCurrent(txn);
          const sameEvent = !!(
            current?.commandEventId && incoming?.commandEventId &&
            String(current.commandEventId) === String(incoming.commandEventId)
          );
          const sameIdentity = isSameActiveFlow(current, incoming);
          if (sameEvent || sameIdentity) {
            return { accepted: true, idempotent: true, flow: current };
          }
          if (!force && current && Number(current.commandTs || 0) > Number(incoming.commandTs || 0)) {
            return { accepted: false, stale: true, flow: current };
          }
          await txn.put('flow', incoming);
          return { accepted: true, idempotent: false, flow: incoming };
        });
        const expiresAt = Number(result?.flow?.expiresAt || 0);
        if (result?.accepted && expiresAt > Date.now()) {
          await this.state.storage.setAlarm(expiresAt).catch(() => {});
        }
        return this.json({ ok: true, ...result });
      }

      if (action === 'updateIfCurrent') {
        const expected = body?.expected || {};
        const patch = body?.patch || {};
        const result = await this.state.storage.transaction(async (txn) => {
          const current = await this.readCurrent(txn);
          if (!isSameActiveFlow(current, expected)) {
            return { updated: false, flow: current };
          }
          const next = {
            ...current,
            ...patch,
            ownerKey: current.ownerKey,
            userId: current.userId,
            flowId: current.flowId,
            commandTs: current.commandTs,
            commandEventId: current.commandEventId
          };
          await txn.put('flow', next);
          return { updated: true, flow: next };
        });
        const expiresAt = Number(result?.flow?.expiresAt || 0);
        if (result?.updated && expiresAt > Date.now()) {
          await this.state.storage.setAlarm(expiresAt).catch(() => {});
        }
        return this.json({ ok: true, ...result });
      }

      if (action === 'clearIfCurrent') {
        const expected = body?.expected || {};
        const result = await this.state.storage.transaction(async (txn) => {
          const current = await this.readCurrent(txn);
          if (!isSameActiveFlow(current, expected)) {
            return { cleared: false, flow: current };
          }
          await txn.delete('flow');
          return { cleared: true, flow: null };
        });
        if (result.cleared) await this.state.storage.deleteAlarm().catch(() => {});
        return this.json({ ok: true, ...result });
      }

      if (action === 'clear') {
        await this.state.storage.delete('flow');
        await this.state.storage.deleteAlarm().catch(() => {});
        return this.json({ ok: true, cleared: true, flow: null });
      }

      return this.json({ ok: false, error: 'unknown_action' }, 400);
    } catch (err) {
      console.error('active_flow_owner_error', { action, error: String(err?.message || err) });
      return this.json({ ok: false, error: 'storage_failure' }, 500);
    }
  }

  async alarm() {
    const current = await this.readCurrent();
    if (current?.expiresAt && Number(current.expiresAt) > Date.now()) {
      await this.state.storage.setAlarm(Number(current.expiresAt));
    }
  }
}

/* =========================
 * 4) Main Worker Entrypoint
 * ========================= */
const LINE_BACKGROUND_PROCESSING_HEADER = 'x-mama-line-background';

const worker = {
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

    if (request.method === 'GET' && url.pathname === '/health') {
      const durableOwnerConfigured = hasActiveFlowOwner(env);
      const reservationGasConfigured = !!getReservationGas(env);
      return new Response(JSON.stringify({
        ok: durableOwnerConfigured && reservationGasConfigured,
        service: 'fragrant-term-4318',
        bookingFlowContract: ACTIVE_FLOW_CONTRACT_VERSION,
        activeFlowVersioned: durableOwnerConfigured,
        activeFlowStorage: durableOwnerConfigured ? 'durable-object' : 'missing',
        reservationGasConfigured,
        claimedImageSingleRoute: true,
        healthSignatureRequired: false,
        lineWebhookSignatureRequired: true
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }

    if (request.method === 'GET' && url.pathname === '/debug/postback') {
      const sample = url.searchParams.get('data') || 'action=CONTINUE&room=A106&end=2026-02-27&inq=INQ_A106_2026-02-27_xxxxxx';
      const parsed = parsePostbackData(sample);
      const body = JSON.stringify({ raw: sample, parsed }, null, 2);
      return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    if (request.method === 'GET' && url.pathname === '/debug/checkin-keycard-state') {
      const secret = String(env.WORKER_SECRET || env.MM_WORKER_SECRET || '').trim();
      const providedSecret = String(request.headers.get('x-worker-secret') || url.searchParams.get('key') || '').trim();
      if (!secret || providedSecret !== secret) {
        return new Response('Unauthorized', { status: 401 });
      }

      const groupId = String(url.searchParams.get('groupId') || '').trim();
      const userId = String(url.searchParams.get('userId') || '').trim();
      const userKey = (groupId && userId) ? getCheckinKeycardWaitingPhotoKey(groupId, userId) : '';
      const groupKey = groupId ? getCheckinKeycardWaitingPhotoGroupKey(groupId) : '';
      const userOnlyKey = userId ? getCheckinKeycardWaitingPhotoUserKey(userId) : '';
      const stateResult = await getCheckinKeycardWaitingPhotoState(env, userKey, groupKey, userOnlyKey, groupId, userId);
      const state = stateResult.state || null;
      const ageMs = state?.ts ? Date.now() - state.ts : null;
      const active = !!(
        state &&
        state.mode === 'WAITING_CHECKIN_KEYCARD_PHOTO' &&
        state.ts &&
        ageMs < CHECKIN_KEYCARD_PHOTO_TTL_MS
      );
      const inactiveReason = !state
        ? 'state_not_found'
        : (state.mode !== 'WAITING_CHECKIN_KEYCARD_PHOTO'
          ? `wrong_state_mode:${state.mode || 'missing'}`
          : (ageMs >= CHECKIN_KEYCARD_PHOTO_TTL_MS ? 'waiting_state_expired' : 'waiting_state_invalid'));

      const body = JSON.stringify({
        groupId,
        userId,
        expectedImageEvent: {
          eventType: 'message',
          messageType: 'image',
          sourceType: 'group',
          note: 'Image events do not contain act. The button postback creates mode=WAITING_CHECKIN_KEYCARD_PHOTO.'
        },
        keys: { userKey, groupKey, userOnlyKey },
        found: {
          user: !!stateResult.stateFromUser,
          group: !!stateResult.stateFromGroup,
          userOnly: !!stateResult.stateFromUserOnly,
          memory: !!stateResult.stateFromMemory
        },
        active,
        inactiveReason: active ? '' : inactiveReason,
        ageMs,
        ttlMs: CHECKIN_KEYCARD_PHOTO_TTL_MS,
        state
      }, null, 2);
      return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    if (request.method === 'POST' && url.pathname === '/debug/line-push') {
      const secret = String(env.WORKER_SECRET || env.MM_WORKER_SECRET || '').trim();
      const providedSecret = String(request.headers.get('x-worker-secret') || '').trim();
      if (!secret || providedSecret !== secret) {
        return new Response('Unauthorized', { status: 401 });
      }

      let body = {};
      try {
        body = await request.json();
      } catch (_) {
        body = {};
      }

      const to = String(body?.to || '').trim();
      const text = String(body?.text || '').trim();
      if (!to || !text) {
        return new Response(JSON.stringify({ ok: false, error: 'missing_to_or_text' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      try {
        await linePushText(env.LINE_ACCESS_TOKEN, to, text);
        return new Response(JSON.stringify({ ok: true, to, text }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (err) {
        return new Response(JSON.stringify({
          ok: false,
          to,
          error: String(err?.message || err)
        }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' }
        });
      }
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
    const sig = request.headers.get('x-line-signature') || '';
    if (!(await verifySig(bodyText, sig, env.LINE_CHANNEL_SECRET))) {
      return new Response('Unauthorized', { status: 401 });
    }

    // LINE closes webhook connections aggressively. Finish signature
    // verification, acknowledge the delivery immediately, then keep the full
    // command workflow alive with waitUntil. Without this boundary, a Durable
    // Object/KV cold start can make LINE disconnect and cancel the command
    // before the keyword handler stores state or sends its reply.
    if (request.headers.get(LINE_BACKGROUND_PROCESSING_HEADER) !== '1') {
      const backgroundHeaders = new Headers(request.headers);
      backgroundHeaders.set(LINE_BACKGROUND_PROCESSING_HEADER, '1');
      const backgroundRequest = new Request(request.url, {
        method: 'POST',
        headers: backgroundHeaders,
        body: bodyText
      });
      ctx.waitUntil(
        worker.fetch(backgroundRequest, env, ctx)
          .then(async (response) => {
            if (!response.ok) {
              console.error('line_background_processing_failed', {
                status: response.status,
                body: (await response.text()).slice(0, 300)
              });
            }
          })
          .catch((err) => {
            console.error('line_background_processing_exception', {
              error: String(err?.message || err)
            });
          })
      );
      return new Response('OK', { status: 200 });
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
      const receiptChatId = getChatId(ev) || 'unknown';
      const eventReceipt = {
        receivedAt: new Date().toISOString(),
        eventTimestamp: ev?.timestamp || null,
        eventType: ev?.type || '',
        messageType: ev?.message?.type || '',
        messageId: ev?.message?.id || '',
        textPreview: ev?.message?.type === 'text' ? String(ev?.message?.text || '').slice(0, 160) : '',
        sourceType: ev?.source?.type || '',
        groupId: ev?.source?.groupId || '',
        roomId: ev?.source?.roomId || '',
        userId: ev?.source?.userId || '',
        webhookEventId: ev?.webhookEventId || '',
        isRedelivery: !!ev?.deliveryContext?.isRedelivery
      };
      console.log('line_event_received', eventReceipt);
      ctx.waitUntil(kvPut(env, `line:event-receipt:${receiptChatId}`, eventReceipt, 60 * 60));

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

        const cleaningPostback = Object.keys(data).length > 0 ? data : parseQueryString(postbackDataString);
        if (isBillManualPayClick(cleaningPostback)) {
          const chatId = getChatId(ev);
          const lineUserId = String(ev?.source?.userId || '').trim();
          const stateKey = getBillManualPaymentStateKey(lineUserId);

          if (!lineUserId || !stateKey || !hasKV(env)) {
            const failText = 'ไม่สามารถเริ่มขั้นตอนรับสลิปได้ กรุณาลองกดปุ่มจ่ายรายการนี้อีกครั้งค่ะ';
            if (replyToken) {
              await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [{ type: 'text', text: failText }]).catch(console.error);
            } else if (chatId) {
              ctx.waitUntil(linePushText(env.LINE_ACCESS_TOKEN, chatId, failText).catch(console.error));
            }
            continue;
          }

          const paymentState = buildBillManualPaymentState(ev, cleaningPostback, postbackDataString);
          await clearPaymentStatesForEvent(env, ev);
          await kvPut(env, stateKey, paymentState, BILL_MANUAL_PAYMENT_TTL_SECONDS);

          const roomText = paymentState.room ? `ห้อง ${paymentState.room} ` : '';
          const billText = paymentState.billId ? `เลขอ้างอิง ${paymentState.billId}` : 'รายการนี้';
          const ackText = `เลือกชำระ${roomText}${billText}แล้วค่ะ กรุณาส่งสลิปในแชทนี้ภายใน 10 นาที`;
          if (replyToken) {
            await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [{ type: 'text', text: ackText }]).catch(console.error);
          } else if (chatId) {
            ctx.waitUntil(linePushText(env.LINE_ACCESS_TOKEN, chatId, ackText).catch(console.error));
          }
          continue;
        }

        if (String(cleaningPostback.act || '').trim() === 'CLEANING_MANAGER_PRICE') {
          const billingPayload = buildCleaningBillingPostbackPayload(ev, cleaningPostback, postbackDataString);
          const ackText = buildCleaningBillingAckText(cleaningPostback);
          if (replyToken) {
            ctx.waitUntil(
              lineReply(env.LINE_ACCESS_TOKEN, replyToken, [{ type: 'text', text: ackText }])
                .catch((err) => console.error('cleaning_billing_postback_reply_failed', err))
            );
          } else if (billingPayload.chatId) {
            ctx.waitUntil(
              linePushText(env.LINE_ACCESS_TOKEN, billingPayload.chatId, ackText)
                .catch((err) => console.error('cleaning_billing_postback_push_failed', err))
            );
          }
          ctx.waitUntil(
            notifyN8nCleaning(env, billingPayload)
              .catch((err) => console.error('cleaning_billing_postback_forward_failed', err))
          );
          continue;
        }

        if (String(cleaningPostback.act || '').trim() === 'CLEANING_TENANT_PAY_METHOD') {
          const paymentPayload = buildCleaningPaymentMethodPostbackPayload(ev, cleaningPostback, postbackDataString);
          const ackText = buildCleaningPaymentMethodAckText(cleaningPostback);
          if (replyToken) {
            ctx.waitUntil(
              lineReply(env.LINE_ACCESS_TOKEN, replyToken, [{ type: 'text', text: ackText }])
                .catch((err) => console.error('cleaning_payment_method_postback_reply_failed', err))
            );
          } else if (paymentPayload.chatId) {
            ctx.waitUntil(
              linePushText(env.LINE_ACCESS_TOKEN, paymentPayload.chatId, ackText)
                .catch((err) => console.error('cleaning_payment_method_postback_push_failed', err))
            );
          }
          ctx.waitUntil(
            notifyN8nCleaning(env, paymentPayload)
              .catch((err) => console.error('cleaning_payment_method_postback_forward_failed', err))
          );
          continue;
        }

        if (String(cleaningPostback.act || '').trim() === 'CLEANING_CASH_CONFIRM') {
          const cashPayload = buildCleaningCashConfirmPostbackPayload(ev, cleaningPostback, postbackDataString);
          const ackText = buildCleaningCashConfirmAckText(cleaningPostback);
          if (replyToken) {
            ctx.waitUntil(
              lineReply(env.LINE_ACCESS_TOKEN, replyToken, [{ type: 'text', text: ackText }])
                .catch((err) => console.error('cleaning_cash_confirm_postback_reply_failed', err))
            );
          } else if (cashPayload.chatId) {
            ctx.waitUntil(
              linePushText(env.LINE_ACCESS_TOKEN, cashPayload.chatId, ackText)
                .catch((err) => console.error('cleaning_cash_confirm_postback_push_failed', err))
            );
          }
          ctx.waitUntil(
            notifyN8nCleaning(env, cashPayload)
              .catch((err) => console.error('cleaning_cash_confirm_postback_forward_failed', err))
          );
          continue;
        }

        // BEGIN RENT KEY POSTBACK FORWARD
        const rentKeyAction = String(data.act || data.type || '').trim();
        if (
          rentKeyAction === 'KEY_CASH_START_PHOTO' ||
          rentKeyAction === 'KEY_MB_START_PHOTO' ||
          rentKeyAction === 'KEY_CASH_REJECT' ||
          rentKeyAction === 'KEY_CASH_CONFIRM'
        ) {
          const normalizedRentKeyAction = rentKeyAction === 'KEY_CASH_CONFIRM'
            ? 'KEY_CASH_START_PHOTO'
            : rentKeyAction;
          const isStartPhotoAction =
            normalizedRentKeyAction === 'KEY_CASH_START_PHOTO' ||
            normalizedRentKeyAction === 'KEY_MB_START_PHOTO';
          const paymentFlow = getKeyRentPaymentFlowByStartAction(normalizedRentKeyAction);
          const billId = String(data.billId || '');
          const room = String(data.room || '');
          const groupId = String(ev?.source?.groupId || '');
          const sourceType = String(ev?.source?.type || '');
          const startedByUserId = String(ev?.source?.userId || '');
          const billIdLabel = billId || '-';
          const quickReplyText = isStartPhotoAction
            ? `✅ เริ่มขั้นตอนถ่ายรูปแล้ว กรุณาส่งรูปกุญแจ/คีย์การ์ดในกลุ่มนี้ได้เลย (BillID: ${billIdLabel})`
            : `❌ บันทึกว่า 'ยังไม่ได้รับเงิน' (BillID: ${billIdLabel})`;

          if (isStartPhotoAction) {
            if (sourceType === 'group' && groupId) {
              const waitingPhotoState = {
                mode: 'WAITING_KEY_PHOTO',
                startAction: normalizedRentKeyAction,
                paymentFlow,
                billId,
                room,
                groupId,
                startedByUserId,
                startedAt: new Date().toISOString()
              };
              await kvPut(
                env,
                getKeyRentWaitingPhotoKey(groupId),
                waitingPhotoState,
                KEY_RENT_WAITING_PHOTO_TTL_SECONDS
              );
            } else {
              console.warn('rent_key_start_photo_non_group_source', {
                sourceType,
                hasGroupId: !!groupId
              });
            }
          }

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

          const parsedPayload = {
            ...data,
            act: normalizedRentKeyAction,
            paymentFlow
          };
          if (rentKeyAction !== normalizedRentKeyAction) {
            parsedPayload.legacyAct = rentKeyAction;
          }
          const payloadToN8n = {
            source: 'line',
            receivedAt: new Date().toISOString(),
            action: normalizedRentKeyAction,
            paymentFlow,
            billId,
            room,
            parsed: parsedPayload,
            event: ev
          };

          ctx.waitUntil(
            notifyRentKeyReceiver(env, payloadToN8n)
              .catch((err) => console.error('rent_key_postback_forward_failed', err))
          );
          continue;
        }
        // END RENT KEY POSTBACK FORWARD

        const act = String(data.act || '').trim();
        const postbackAction = String(data.act || data.action || data.type || data.eventType || data.postbackType || '').trim();
        const postbackActionLower = postbackAction.toLowerCase();
        if (postbackAction.toUpperCase() === 'PAY_REVIEW_ACCEPT') {
          const chatId = getChatId(ev);
          const forwardPayload = buildPayReviewAcceptForwardPayload(data, ev, postbackDataString);
          const roomText = forwardPayload.room ? ` room ${forwardPayload.room}` : '';
          const delivery = await notifyN8nPayReviewAccept(env, forwardPayload);
          const ackText = delivery.ok
            ? `Received payment approval${roomText}. Sent to payrent system.`
            : `Received payment approval${roomText}, but n8n did not accept it (${delivery.status ? `HTTP ${delivery.status}` : delivery.error || 'no webhook URL'}).`;

          if (replyToken) {
            await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [{ type: 'text', text: ackText }]).catch(console.error);
          } else if (chatId) {
            ctx.waitUntil(linePushText(env.LINE_ACCESS_TOKEN, chatId, ackText).catch(console.error));
          }
          continue;
        }

        if (isCheckoutCashPaymentPostback(data)) {
          const chatId = getChatId(ev);
          const cashFlowKey = getCheckoutCashFlowKey(ev);
          const flow = buildCheckoutCashFlowState(data, ev, postbackDataString);

          await clearPaymentStatesForEvent(env, ev);
          await kvPut(env, cashFlowKey, flow, CHECKOUT_CASH_FLOW_TTL_SECONDS);

          const prompt = buildCheckoutCashAmountPrompt(flow);
          if (replyToken) {
            await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [{ type: 'text', text: prompt }]).catch(console.error);
          } else if (chatId) {
            ctx.waitUntil(linePushText(env.LINE_ACCESS_TOKEN, chatId, prompt).catch(console.error));
          }
          continue;
        }

        if (isCheckout2PaymentPostback(data)) {
          const chatId = getChatId(ev);
          const stateKey = getStateKey(ev);
          const penaltyKey = stateKey + ':penalty_flow';
          const checkout2GroupKey = getCheckout2GroupWaitingSlipKey(ev);
          const flow = buildCheckout2PaymentFlowState(data, ev, postbackDataString);

          await clearPaymentStatesForEvent(env, ev);
          await Promise.all([
            kvPut(env, penaltyKey, flow, PENALTY_FLOW_TTL_SECONDS),
            checkout2GroupKey
              ? kvPut(env, checkout2GroupKey, flow, PENALTY_FLOW_TTL_SECONDS)
              : Promise.resolve()
          ]);

          const askSlip = flow.roomId
            ? `บันทึกรายการ${paymentReasonLabel(flow.reason)} ห้อง ${flow.roomId} แล้ว โปรดส่งสลิปได้เลยค่ะ`
            : `บันทึกรายการ${paymentReasonLabel(flow.reason)}แล้ว โปรดส่งสลิปได้เลยค่ะ`;
          if (replyToken) {
            await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [{ type: 'text', text: askSlip }]).catch(console.error);
          } else if (chatId) {
            ctx.waitUntil(linePushText(env.LINE_ACCESS_TOKEN, chatId, askSlip).catch(console.error));
          }
          continue;
        }

        if (act === CLEANING_TENANT_CONFIRM_ACT) {
          const chatId = getChatId(ev);
          const userId = ev?.source?.userId || '';
          const cleaningPayload = {
            source: 'line_postback',
            intent: 'cleaning_request',
            act: 'tenant',
            roomId: '',
            text: 'ยืนยันขอใช้บริการทำความสะอาด',
            lineUserId: userId || '',
            chatId: chatId || '',
            sourceType: ev?.source?.type || '',
            replyToken: replyToken || '',
            postbackData: postbackDataString,
            webhookEventId: ev?.webhookEventId || '',
            receivedAt: new Date().toISOString()
          };

          const webhookOk = await notifyN8nCleaning(env, cleaningPayload);
          const ackText = webhookOk
            ? 'รับคำขอใช้บริการทำความสะอาดแล้วค่ะ แอดมินจะติดต่อกลับเพื่อแจ้งรายละเอียดและนัดหมาย'
            : 'รับคำยืนยันแล้วค่ะ แต่ระบบส่งข้อมูลให้แอดมินไม่สำเร็จ กรุณาลองอีกครั้งหรือติดต่อแอดมิน';

          if (replyToken) {
            await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [{ type: 'text', text: ackText }]).catch(console.error);
          } else if (chatId) {
            ctx.waitUntil(linePushText(env.LINE_ACCESS_TOKEN, chatId, ackText).catch(console.error));
          }
          continue;
        }

        if (isReturnKeyDecisionAction(postbackAction) || hasReturnKeyDecisionHints(data, postbackDataString)) {
          const chatId = getChatId(ev);
          const roomRaw = String(data.roomId || data.room || data.roomNo || data.room_code || '').trim();
          const roomId = parseRoomToken(roomRaw) || roomRaw.toUpperCase();
          const selectedItem = String(
            data.item || data.option || data.selection || data.selectedItem || data.assetType || ''
          ).trim();
          const decision = normalizeReturnKeyDecision(data);
          const payloadToN8n = {
            source: 'line_postback',
            intent: 'return_key_decision',
            action: postbackAction,
            roomId: roomId || '',
            decision: decision || '',
            selectedItem: selectedItem || '',
            parsed: data,
            postbackData: postbackDataString,
            event: ev,
            receivedAt: new Date().toISOString()
          };

          const ackBits = [
            'รับคำสั่งคืนกุญแจแล้ว',
            roomId ? `ห้อง ${roomId}` : '',
            decision ? `(สถานะ: ${decision})` : ''
          ].filter(Boolean);
          const ackMsg = `${ackBits.join(' ')} กำลังส่งข้อมูลให้เจ้าหน้าที่ค่ะ`;

          if (replyToken) {
            await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [{ type: 'text', text: ackMsg }]).catch(console.error);
          } else if (chatId) {
            ctx.waitUntil(linePushText(env.LINE_ACCESS_TOKEN, chatId, ackMsg).catch(console.error));
          }

          ctx.waitUntil(
            notifyN8nReturnKeyDecision(env, payloadToN8n).catch((err) => console.error('return_key_decision_postback_forward_failed', err))
          );
          continue;
        }

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
          await clearPaymentStatesForEvent(env, ev);
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
            const flowUserId = String(ev?.source?.userId || '').trim();
            let currentFlow = flowUserId ? await getActiveFlow(env, flowUserId, ev) : null;
            const buttonFlowId = String(data.flowId || data.flowID || data.flowid || '').trim();
            const buttonVersion = String(data.flowVersion || data.version || '').trim();
            const currentKind = String(currentFlow?.kind || currentFlow?.flowType || '').trim().toLowerCase();

            if (
              (buttonFlowId || buttonVersion) &&
              !isSameActiveFlow(currentFlow, { flowId: buttonFlowId, version: buttonVersion })
            ) {
              await errorReplyOrPush(env, replyToken, chatId, 'ปุ่มนี้เป็นขั้นตอนเก่า กรุณาพิมพ์รหัสจองอีกครั้งค่ะ');
              continue;
            }
            if (currentFlow && currentKind !== 'reservation') {
              await errorReplyOrPush(env, replyToken, chatId, 'ตอนนี้กำลังทำรายการอื่นอยู่ หากต้องการกลับมาจอง กรุณาพิมพ์รหัส #MM อีกครั้งค่ะ');
              continue;
            }

            const normalizedCode = codeHint
              ? extractBookingCode(codeHint) || String(codeHint).trim().toUpperCase()
              : String(currentFlow?.code || '').trim().toUpperCase();
            if (
              currentFlow?.code && normalizedCode &&
              String(currentFlow.code).toUpperCase() !== normalizedCode
            ) {
              await errorReplyOrPush(env, replyToken, chatId, 'ปุ่มนี้ไม่ตรงกับรหัสจองล่าสุด กรุณาพิมพ์รหัสจองอีกครั้งค่ะ');
              continue;
            }

            const expectedFlow = currentFlow;
            const resumePhase = (act === 'confirm' || act === 'booking_confirm')
              ? 'await_confirm'
              : (act === 'slip_yes' || act === 'slip_no' ? 'confirm_slip' : 'confirm_id');
            if (
              expectedFlow &&
              String(expectedFlow.phase || '').trim().toLowerCase() !== resumePhase
            ) {
              await errorReplyOrPush(env, replyToken, chatId, 'ปุ่มนี้ไม่ตรงกับขั้นตอนล่าสุด กรุณาทำตามปุ่มล่าสุดในแชตค่ะ');
              continue;
            }
            const forwardFlow = expectedFlow || {
              flowId: buttonFlowId,
              version: buttonVersion,
              flowVersion: buttonVersion,
              phase: resumePhase,
              code: normalizedCode,
              userId: flowUserId
            };
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
            ctx.waitUntil((async () => {
              const gasResult = await forwardToSpecificGasResult(
                env,
                resvUrl,
                buildReservationForwardPayload(ev, forwardFlow)
              );
              if (!gasResult.ok) {
                if (chatId) {
                  await safeLinePushText(
                    env.LINE_ACCESS_TOKEN,
                    chatId,
                    'ระบบการจองยังไม่ตอบรับ กรุณากดปุ่มอีกครั้งค่ะ',
                    'reservation_postback_failure_push_failed'
                  );
                }
                return;
              }
              if (!flowUserId) return;
              const gasAck = getReservationFlowAck(gasResult.data);
              if (expectedFlow) {
                const sameAckIdentity = !!(
                  gasAck?.flowId && gasAck?.version &&
                  gasAck.flowId === String(expectedFlow.flowId || '') &&
                  (!gasAck.code || !expectedFlow.code || gasAck.code === String(expectedFlow.code).trim().toUpperCase())
                );
                if (!sameAckIdentity) {
                  if (chatId) {
                    await safeLinePushText(
                      env.LINE_ACCESS_TOKEN,
                      chatId,
                      'ระบบการจองยังไม่ยืนยันขั้นตอนนี้ กรุณากดปุ่มอีกครั้งค่ะ',
                      'reservation_postback_missing_ack_push_failed'
                    );
                  }
                  return;
                }

                if (gasAck.clearActiveFlow) {
                  await clearActiveFlowIfCurrent(env, flowUserId, expectedFlow);
                  return;
                }

                if (gasAck.terminal) {
                  const acceptedOutcomes = new Set(['accepted', 'completed', 'done', 'success', 'succeeded']);
                  if (act === 'id_yes' && acceptedOutcomes.has(gasAck.outcome)) {
                    await clearActiveFlowIfCurrent(env, flowUserId, expectedFlow);
                  } else if (chatId) {
                    await safeLinePushText(
                      env.LINE_ACCESS_TOKEN,
                      chatId,
                      'ระบบยังไม่ยืนยันว่าขั้นตอนเสร็จสมบูรณ์ กรุณากดปุ่มอีกครั้งค่ะ',
                      'reservation_terminal_unconfirmed_push_failed'
                    );
                  }
                  return;
                }

                const synced = await syncReservationFlowFromGasAck(
                  env,
                  flowUserId,
                  expectedFlow,
                  gasResult.data
                );
                if (!synced && chatId) {
                  await safeLinePushText(
                    env.LINE_ACCESS_TOKEN,
                    chatId,
                    'ขั้นตอนถูกเปลี่ยนแล้ว กรุณาทำตามข้อความล่าสุดในแชตค่ะ',
                    'reservation_postback_stale_sync_push_failed'
                  );
                }
                return;
              }

              // Legacy buttons may not carry flow identity. Only recreate a
              // reservation owner after GAS accepts the action and only while
              // no newer command has claimed this user.
              if (await getActiveFlow(env, flowUserId, ev)) return;
              if (!gasAck?.flowId || !gasAck?.version || gasAck.terminal) return;
              await setActiveFlow(env, flowUserId, {
                flowType: 'reservation',
                kind: 'reservation',
                phase: gasAck.phase,
                code: gasAck?.code || normalizedCode || '',
                event: ev,
                ...(gasAck?.flowId && gasAck?.version ? {
                  flowId: gasAck.flowId,
                  version: gasAck.version
                } : {}),
                ttlSeconds: gasAck.ttlSeconds || getReservationFlowTtlSecondsByPhase(gasAck.phase)
              });
            })());
            continue;
          }
        }

        // Check-in picker postback routes to legacy MM_WEBHOOK GAS only
        if (act === 'checkin_pick') {
          await forwardToGas(env, { events: [ev] });
          continue;
        }

        if (act === 'checkin_keycard_start' || postbackActionLower === 'checkin_keycard_start') {
          const chatId = getChatId(ev);
          const sourceType = String(ev?.source?.type || '');
          const groupId = String(ev?.source?.groupId || '');
          const managerUserId = String(ev?.source?.userId || '');
          const flowId = String(data.flowId || data.flowID || data.flowid || '').trim();
          const roomRaw = String(data.roomId || data.room || data.roomNo || '').trim();
          const roomId = parseRoomToken(roomRaw) || roomRaw.toUpperCase();

          if (!flowId) {
            await errorReplyOrPush(env, replyToken, chatId, 'ไม่พบ FlowId สำหรับการถ่ายรูปคีย์การ์ด กรุณากดปุ่มใหม่อีกครั้งค่ะ');
            continue;
          }

          if (sourceType !== 'group' || !groupId) {
            await errorReplyOrPush(env, replyToken, chatId, 'คำสั่งนี้ต้องกดจากกลุ่มผู้จัดการเท่านั้นค่ะ');
            continue;
          }

          const key = managerUserId ? getCheckinKeycardWaitingPhotoKey(groupId, managerUserId) : '';
          const groupKey = getCheckinKeycardWaitingPhotoGroupKey(groupId);
          const userOnlyKey = managerUserId ? getCheckinKeycardWaitingPhotoUserKey(managerUserId) : '';
          const now = Date.now();
          const state = {
            mode: 'WAITING_CHECKIN_KEYCARD_PHOTO',
            flowId,
            roomId: roomId || '',
            managerUserId,
            groupId,
            startedAt: new Date(now).toISOString(),
            expiresAt: new Date(now + (CHECKIN_KEYCARD_PHOTO_TTL_SECONDS * 1000)).toISOString(),
            ts: now
          };
          if (key) {
            await kvPut(env, key, state, CHECKIN_KEYCARD_PHOTO_TTL_SECONDS);
          }
          await kvPut(env, groupKey, state, CHECKIN_KEYCARD_PHOTO_TTL_SECONDS);
          if (userOnlyKey) {
            await kvPut(env, userOnlyKey, state, CHECKIN_KEYCARD_PHOTO_TTL_SECONDS);
          }
          rememberCheckinKeycardWaitingPhotoState(groupId, managerUserId, state);

          const roomLabel = roomId ? ('ห้อง ' + roomId) : 'ห้องที่ระบุ';
          const ack = '✅ เริ่มขั้นตอนถ่ายรูปคีย์การ์ดแล้ว (' + roomLabel + ')\nกรุณาส่งรูปคีย์การ์ดในแชทนี้ภายใน 20 นาที';
          await errorReplyOrPush(env, replyToken, chatId, ack);
          continue;
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

          if (act === 'LEAD_START') {
            await clearLead(env, userId);
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

          if (act === 'LEAD_CANCEL') {
            await clearLead(env, userId);
            await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [
              { type: 'text', text: 'ยกเลิกการกรอกข้อมูลแล้วครับ ✅' }
            ]).catch(console.error);
            continue;
          }

          if (act === 'LEAD_A') {
            const q = String(data.q || '').trim();
            const v = normalizeLeadAnswer(q, data.v, ev?.postback?.params);
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

            const stepMap = { status: 2, movein: 999 };
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
                  movein: { IN7: 'ภายใน 7 วัน', IN30: 'ภายในเดือนนี้', UNSURE: 'ยังไม่แน่ใจ' },
                  status: { STUDENT: 'นักศึกษา', FACTORY: 'พนักงานโรงงาน', OFFICE: 'พนักงานออฟฟิศ', OTHER: 'อื่น ๆ' }
                };
                const formatAnswer = (key, value) => {
                  if (key === 'movein' && String(value || '').startsWith('DATE:')) {
                    return String(value).slice(5);
                  }
                  return (valueMap[key] && valueMap[key][value]) ? valueMap[key][value] : (value || '-');
                };
                const summary = [
                  '🧾 Booking Lead (SUBMITTED)',
                  `👤 UserId: ${userId}`,
                  `🕒 Time: ${nowBkkString()}`,
                  '',
                  `อาชีพ: ${formatAnswer('status', a.status)}`,
                  `ต้องการเข้าอยู่: ${formatAnswer('movein', a.movein)}`
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
                        { type: 'postback', label: '✅ ส่งลิงก์ฝากห้อง', data: `act=LEAD_APPROVE&uid=${encodeURIComponent(userId)}` },
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

          const prebookUrl = getPrebookUrl(env);

          if (act === 'LEAD_APPROVE') {
            await linePush(env.LINE_ACCESS_TOKEN, uid, [
              {
                type: 'text',
                text: [
                  'ขอบคุณที่ให้ข้อมูลครับ ✅',
                  `ฝากข้อมูลรับห้องว่างได้ที่ลิงก์นี้เลยครับ:`,
                  prebookUrl,
                  '',
                  'หลังส่งฟอร์ม ระบบจะออกรหัส #PBxxx',
                  'จากนั้นกดปุ่มส่งรหัสกลับเข้า LINE เพื่อให้ทีมงานค้นหาและติดต่อกลับได้เร็วขึ้น'
                ].join('\n')
              }
            ]).catch(console.error);

            lead.status = 'APPROVED';
            lead.approvedAt = Date.now();
            await saveLead(env, uid, lead);

            await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [
              { type: 'text', text: '✅ ส่งลิงก์ฝากห้องให้ลูกค้าแล้ว' }
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
          leaseId,
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
          leaseId,
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

            const forwardPayload = buildMarkPaidForwardPayload(data, ev);
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
        const isRenewalSignSlotConfirmAction = action === 'RENEWAL_SIGN_SLOT_CONFIRM';
        const isRenewalSignSlotChangeAction = action === 'RENEWAL_SIGN_SLOT_CHANGE';
        const isRenewalAdminPickSigningAction = action === 'RENEWAL_ADMIN_PICK_SIGNING';
        const isLeavePickCheckoutAction = action === 'LEAVE_PICK_CHECKOUT';
        const isRenewalAdminAction =
          action === 'ADMIN_SIGN_TEXT' ||
          action === 'ADMIN_SIGN_CALL' ||
          action === 'ADMIN_SIGN_NOW' ||
          action === 'ADMIN_SEND_SLOT' ||
          action === 'ADMIN_HOLD' ||
          isRenewalAdminPickSigningAction;
        const isContractRenewalAction =
          action === 'CONTINUE' ||
          action === 'LEAVE' ||
          action === 'UNDECIDED' ||
          action === 'RENEWAL_ACCEPT_TERMS' ||
          action === 'RENEWAL_ASK_MORE' ||
          isRenewalSignSlotConfirmAction ||
          isRenewalSignSlotChangeAction ||
          isRenewalAdminPickSigningAction ||
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
        const inquiryOptionalActions = [
          'RENEWAL_ACCEPT_TERMS',
          'RENEWAL_ASK_MORE',
          'RENEWAL_ADMIN_PICK_SIGNING'
        ];
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
            LeaseID: leaseId || '',
            RoomID: room || '',
            ContractEndDateISO: end || '',
            TriggerDay: td || '',
            inquiryId: inq,
            leaseId: leaseId || '',
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
          if (action === 'RENEWAL_ADMIN_PICK_SIGNING') {
            console.log('renewal_admin_pick_signing_forward', {
              inquiryId: inq || '',
              roomId: room || '',
              leaseId: leaseId || '',
              selectedDateTime,
              selectedDate,
              selectedTime
            });
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
            RENEWAL_ASK_MORE: `รับทราบค่ะ 📝 ห้อง ${roomLabel} ขอรายละเอียดเพิ่มเติมแล้ว แอดมินจะติดต่อกลับ`,
            RENEWAL_SIGN_SLOT_CONFIRM: `รับทราบค่ะ ✅ ยืนยันวันนัดเซ็นสัญญาห้อง ${roomLabel} แล้ว`,
            RENEWAL_SIGN_SLOT_CHANGE: `รับทราบค่ะ 🗓️ รับคำขอเปลี่ยนวันนัดเซ็นสัญญาห้อง ${roomLabel} แล้ว`,
            RENEWAL_ADMIN_PICK_SIGNING: `รับทราบค่ะ ✅ ส่งวันและเวลาใหม่ของห้อง ${roomLabel} แล้ว`
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
          await clearPaymentStatesForEvent(env, ev);
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
          const shouldWaitForOutsiderPhone = selectedParkingSegment?.key === 'outsider' && !!sanitizedParking.lineUserId;
          if (shouldWaitForOutsiderPhone) {
            await kvPut(
              env,
              parkingOutsiderPhoneFlowKey(sanitizedParking.lineUserId),
              buildParkingOutsiderPhoneState({
                lineUserId: sanitizedParking.lineUserId,
                chatId: sanitizedParking.chatId,
                requestData: sanitizedParking
              }),
              PARKING_OUTSIDER_PHONE_TTL_SECONDS
            );
          }

          if (replyToken) {
            const ackText = shouldWaitForOutsiderPhone
              ? `รับคำขอเช่าที่จอดรถ (${selectedParkingSegment.label} ${selectedParkingSegment.pricePerMonth.toLocaleString('th-TH')} บาท/เดือน) แล้วครับ กรุณาส่งเบอร์โทรศัพท์ภายใน 2 นาที เพื่อให้เจ้าหน้าที่ติดต่อกลับครับ`
              : selectedParkingSegment
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
        // Pay Rent postbacks → instant push from Worker, then forward to n8n only.
        if (
          data.scope === 'payrent' ||
          ['pick_month', 'quick_month', 'upload', 'status', 'faq', 'howto'].includes(data.act)
        ) {
          const chatId = getChatId(ev);
          const rentUrl = getN8nPayRentUrl(env);

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

          // 3) forward the original postback to n8n (await for snappiest UX)
          if (rentUrl) {
            await forwardToSpecificGas(env, rentUrl, { events: [ev] });
          } else {
            console.warn('pay rent postback: missing N8N_PAYRENT_URL, skipping forward');
          }

          continue;
        }



        // Heavy postbacks → quick ack then forward
        console.log('postback_unmatched_fallback', {
          action: String(data.act || data.action || data.type || ''),
          keys: Object.keys(data || {}),
          dataPreview: JSON.stringify(data || {}).slice(0, 300),
          rawPreview: String(postbackDataString || '').slice(0, 300)
        });
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
        const messageUserId = String(ev?.source?.userId || '').trim();
        const earlyCanonicalActiveFlow = (m.type === 'image' && messageUserId)
          ? await getActiveFlow(env, messageUserId, ev)
          : null;
        const earlyCanonicalKind = String(
          earlyCanonicalActiveFlow?.kind || earlyCanonicalActiveFlow?.flowType || ''
        ).trim().toLowerCase();
        const canonicalImageOwner = !!(
          earlyCanonicalActiveFlow &&
          isReservationFlowScopeMatchEvent(earlyCanonicalActiveFlow, ev) &&
          (
            (earlyCanonicalKind === 'reservation' && isReservationActiveFlowPhase(earlyCanonicalActiveFlow.phase)) ||
            (earlyCanonicalKind === 'key_forgot' && earlyCanonicalActiveFlow.phase === 'await_slip')
          )
        );

        if (
          m.type === 'image' &&
          ev?.source?.type === 'group' &&
          chatId &&
          !canonicalImageOwner
        ) {
          const waitingPhotoKey = getKeyRentWaitingPhotoKey(chatId);
          const waitingPhotoState = await kvGet(env, waitingPhotoKey);
          if (isKeyRentWaitingPhotoStateForUser(waitingPhotoState, ev?.source?.userId)) {
            const startedByUserId = String(waitingPhotoState.startedByUserId || '');
            const billId = String(waitingPhotoState.billId || '');
            const room = String(waitingPhotoState.room || '');
            const startAction = String(waitingPhotoState.startAction || '');
            const paymentFlow = String(waitingPhotoState.paymentFlow || getKeyRentPaymentFlowByStartAction(startAction) || 'CASH');
            const actionDetail = paymentFlow === 'MOBILE_BANKING'
              ? 'KEY_PHOTO_RECEIVED_MB'
              : 'KEY_PHOTO_RECEIVED_CASH';
            const payloadToN8n = {
              source: 'line',
              receivedAt: new Date().toISOString(),
              action: 'KEY_PHOTO_RECEIVED',
              actionDetail,
              paymentFlow,
              billId,
              room,
              parsed: {
                act: 'KEY_PHOTO_RECEIVED',
                actionDetail,
                paymentFlow,
                startAction,
                billId,
                room
              },
              event: ev,
              photoContext: {
                fromKv: true,
                groupId: chatId,
                startedByUserId,
                startAction,
                paymentFlow
              }
            };

            const forwarded = await notifyRentKeyReceiver(env, payloadToN8n);
            if (forwarded) {
              await kvDel(env, waitingPhotoKey);
            }

            if (replyToken) {
              const ackText = forwarded
                ? '✅ รับรูปแล้ว กำลังส่งเข้าระบบ'
                : '⚠️ รับรูปแล้ว แต่ส่งเข้าระบบไม่สำเร็จ กรุณาส่งรูปอีกครั้ง';
              await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [
                { type: 'text', text: ackText }
              ]).catch(console.error);
            }
            continue;
          }
        }

        if (m.type === 'image' && !canonicalImageOwner && env.IMAGE_GROUP_ID && chatId === env.IMAGE_GROUP_ID) {
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
        if (env.EXPENSE_GROUP_ID && chatId === env.EXPENSE_GROUP_ID && !(m.type === 'image' && canonicalImageOwner)) {
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
          const rawTextIn = String(m.text || '');
          const textIn = rawTextIn.trim();
          const chatId = getChatId(ev);
          const stateKey = getStateKey(ev);
          const userId = ev?.source?.userId || '';
          const inboundLogPayload = {
            timestamp: new Date(ev?.timestamp || Date.now()).toISOString(),
            direction: 'IN',
            eventType: ev?.type || 'message',
            messageType: m?.type || 'text',
            text: textIn,
            replyToken: replyToken || '',
            userId: userId || '',
            groupId: ev?.source?.groupId || '',
            roomId: ev?.source?.roomId || '',
            chatId: chatId || '',
            sourceType: ev?.source?.type || '',
            messageId: m?.id || '',
            webhookEventId: ev?.webhookEventId || '',
            deliveryContext: ev?.deliveryContext || null,
            normalizedBookingCode: parseBookingCodeCommand(textIn) || '',
            raw: ev
          };

          ctx.waitUntil(
            notifyN8nChatLog(env, inboundLogPayload).catch((err) => console.error('chat_log_inbound_failed', err))
          );

          const priorityBookingCode = parseBookingCodeCommand(textIn);
          if (priorityBookingCode) {
            const resvUrl = getReservationGas(env);
            const bookingCode = priorityBookingCode;
            if (!resvUrl) {
              await errorReplyOrPush(env, replyToken, chatId, 'Reservation system is not configured. Please contact admin.');
              continue;
            }

            const canonicalEvent = withCanonicalTextEvent(ev, bookingCode);
            let reservationFlow = null;
            try {
              reservationFlow = userId
                ? await replaceWithReservationFlow(env, canonicalEvent, {
                  phase: 'await_confirm',
                  code: bookingCode,
                  ttlSeconds: BOOKING_PAYMENT_FLOW_TTL_SECONDS
                }, { deferLegacyCleanup: true })
                : null;
            } catch (err) {
              console.error('booking_code_owner_failed', {
                bookingCode,
                userId,
                chatId,
                webhookEventId: ev?.webhookEventId || '',
                error: String(err?.message || err)
              });
              await replyOrPushText(
                env,
                replyToken,
                chatId,
                `รับรหัสจอง ${bookingCode} แล้ว แต่ระบบเริ่มขั้นตอนไม่สำเร็จ กรุณาส่งรหัสอีกครั้งค่ะ`,
                'booking_code_owner_failure_reply_failed'
              );
              continue;
            }
            if (userId && !reservationFlow) {
              console.log('booking_code_stale_redelivery_ignored', {
                bookingCode,
                userId,
                webhookEventId: ev?.webhookEventId || ''
              });
              if (ev?.deliveryContext?.isRedelivery !== true) {
                await replyOrPushText(
                  env,
                  replyToken,
                  chatId,
                  `รับรหัสจอง ${bookingCode} แล้ว แต่มีขั้นตอนใหม่กว่ากำลังทำงานอยู่ กรุณาส่งรหัสอีกครั้งค่ะ`,
                  'booking_code_stale_reply_failed'
                );
              }
              continue;
            }

            const ackMsg = bookingCode
              ? `รับรหัสจอง ${bookingCode} แล้วค่ะ กำลังตรวจสอบให้ทันที`
              : 'รับรหัสจองแล้วค่ะ กำลังตรวจสอบให้ทันที';
            await replyOrPushText(env, replyToken, chatId, ackMsg, 'booking_code_ack_failed');
            console.log('booking_code_immediate_ack', {
              bookingCode,
              chatId,
              userId,
              webhookEventId: ev?.webhookEventId || ''
            });

            const reservationForwardPromise = (async () => {
              try {
                console.log('reservation_text_forward_to_gas', {
                  bookingCode,
                  chatId,
                  userId,
                  resvUrl
                });
                const gasResult = await forwardToSpecificGasResult(
                  env,
                  resvUrl,
                  buildReservationForwardPayload(canonicalEvent, reservationFlow)
                );
                if (gasResult.ok) {
                  const gasAck = getReservationFlowAck(gasResult.data);
                  const validAck = !!(
                    gasAck && !gasAck.terminal &&
                    gasAck.flowId && gasAck.version &&
                    gasAck.flowId === String(reservationFlow?.flowId || '') &&
                    (!gasAck.code || gasAck.code === bookingCode)
                  );
                  if (!validAck) {
                    if (reservationFlow) {
                      await clearActiveFlowIfCurrent(env, userId, reservationFlow);
                    }
                    if (chatId) {
                      await safeLinePushText(
                        env.LINE_ACCESS_TOKEN,
                        chatId,
                        `ระบบยังไม่ยืนยันรหัสจอง ${bookingCode} กรุณาตรวจสอบรหัสหรือติดต่อแอดมินค่ะ`,
                        'booking_code_invalid_ack_push_failed'
                      );
                    }
                    return;
                  }
                  const synced = await syncReservationFlowFromGasAck(
                    env,
                    userId,
                    reservationFlow,
                    gasResult.data
                  );
                  if (!synced) {
                    console.log('booking_code_ack_stale_ignored', { bookingCode, userId });
                  }
                } else {
                  console.error('booking_code_forward_rejected', {
                    bookingCode,
                    userId,
                    chatId
                  });
                  if (reservationFlow) {
                    await clearActiveFlowIfCurrent(env, userId, reservationFlow);
                  }
                  if (chatId) {
                    await linePushText(
                      env.LINE_ACCESS_TOKEN,
                      chatId,
                      `รับรหัสจอง ${bookingCode} แล้ว แต่ระบบตรวจสอบการจองขัดข้อง กรุณาลองส่งรหัสอีกครั้งหรือติดต่อแอดมินค่ะ`
                    ).catch((pushErr) => console.error('booking_code_forward_failure_push_failed', pushErr));
                  }
                }
              } catch (err) {
                console.error('booking_code_forward_failed', {
                  bookingCode,
                  userId,
                  chatId,
                  error: String(err?.message || err)
                });
              }
            })();

            // State ownership is durable before acknowledgement. GAS remains
            // asynchronous so LINE receives its edge acknowledgement quickly.
            ctx.waitUntil(Promise.allSettled([
              reservationFlow?.cleanupPromise || Promise.resolve(),
              reservationForwardPromise
            ]));
            continue;
          }

          const priorityKeyForgot = parseKeyKeyword(textIn);
          if (priorityKeyForgot) {
            let resolveKeyForgotStateReady = () => {};
            const keyForgotStateReady = new Promise((resolve) => {
              resolveKeyForgotStateReady = resolve;
            });
            const keyForgotTask = handleKeyForgotTextCommand(
              env,
              ev,
              replyToken,
              textIn,
              priorityKeyForgot,
              resolveKeyForgotStateReady
            ).catch(async (err) => {
              resolveKeyForgotStateReady(false);
              console.error('key forgot text command failed', {
                userId,
                chatId,
                text: textIn,
                error: String(err?.message || err)
              });
              if (chatId) {
                await safeLinePushText(
                  env.LINE_ACCESS_TOKEN,
                  chatId,
                  'รับคำสั่งลืมกุญแจแล้ว แต่ระบบขัดข้อง กรุณาพิมพ์คำสั่งเดิมอีกครั้งค่ะ',
                  'key_forgot_command_failure_push_failed'
                );
              }
            });
            ctx.waitUntil(keyForgotTask);
            await keyForgotStateReady;
            continue;
          }

          const precomputedFastReply = await quickKeywordReply(textIn, env, userId);
          const commandRoute = classifyTextCommand(textIn, {
            fastReply: precomputedFastReply,
            isOwnerGroup: isOwnerGroupChat(env, chatId)
          });
          let clearedForCommand = [];
          let commandOwner = null;
          if (commandRoute?.statePolicy === TEXT_COMMAND_REPLACE_FLOW) {
            try {
              commandOwner = userId ? await setActiveFlow(env, userId, {
                flowType: commandRoute.kind,
                kind: commandRoute.kind,
                phase: 'starting',
                event: ev,
                scopeType: String(ev?.source?.type || '').trim() || 'user',
                scopeId: String(ev?.source?.groupId || ev?.source?.roomId || '').trim(),
                ttlSeconds: PENALTY_FLOW_TTL_SECONDS
              }) : null;
            } catch (err) {
              console.error('text_command_owner_failed', {
                kind: commandRoute.kind,
                userId,
                chatId,
                webhookEventId: ev?.webhookEventId || '',
                error: String(err?.message || err)
              });
              await replyOrPushText(
                env,
                replyToken,
                chatId,
                'รับคำสั่งแล้ว แต่ระบบเริ่มขั้นตอนไม่สำเร็จ กรุณาพิมพ์คำสั่งเดิมอีกครั้งค่ะ',
                'text_command_owner_failure_reply_failed'
              );
              continue;
            }
            if (userId && !commandOwner) {
              console.log('stale_text_command_ignored', {
                kind: commandRoute.kind,
                userId,
                webhookEventId: ev?.webhookEventId || ''
              });
              if (ev?.deliveryContext?.isRedelivery !== true) {
                await replyOrPushText(
                  env,
                  replyToken,
                  chatId,
                  'รับคำสั่งแล้ว แต่มีขั้นตอนใหม่กว่ากำลังทำงานอยู่ กรุณาพิมพ์คำสั่งเดิมอีกครั้งค่ะ',
                  'stale_text_command_reply_failed'
                );
              }
              continue;
            }
            clearedForCommand = await clearUserWorkflowStatesForEvent(
              env,
              ev,
              `text_command:${commandRoute.kind}`,
              { preserveActiveFlow: true }
            );
          }
          if (commandRoute) {
            console.log('text_command_classified', {
              kind: commandRoute.kind,
              statePolicy: commandRoute.statePolicy,
              userId,
              chatId,
              clearedStateCount: clearedForCommand.length,
              webhookEventId: ev?.webhookEventId || ''
            });
          }
          let deferredStatePrompt = '';

          // Checkout transfer commands are high-priority state transitions.
          // Handle them before any older registration/payment state can consume
          // the text, and fall back to a group push if LINE rejects replyToken.
          const priorityCheckoutPayment = parseCheckoutPaymentText(textIn);
          if (priorityCheckoutPayment) {
            const armed = await armCheckoutTransferSlipFlow(env, ev, priorityCheckoutPayment);
            const reasonLabel = paymentReasonLabel(priorityCheckoutPayment.reason);
            const roomLabel = priorityCheckoutPayment.roomId ? ` ห้อง ${priorityCheckoutPayment.roomId}` : '';
            const askSlip = `บันทึกรายการ${reasonLabel}${roomLabel}แล้ว โปรดส่งสลิปได้เลยค่ะ`;
            console.log('checkout_transfer_text_armed', {
              reason: priorityCheckoutPayment.reason,
              roomId: priorityCheckoutPayment.roomId || '',
              chatId,
              userId,
              penaltyKey: armed?.penaltyKey || '',
              groupKey: armed?.groupKey || ''
            });
            await replyOrPushText(env, replyToken, chatId, askSlip, 'checkout_transfer_text_ack_failed');
            continue;
          }

          const checkoutCashFlowKey = getCheckoutCashFlowKey(ev);
          const checkoutCashFlow = await kvGet(env, checkoutCashFlowKey);
          if (isCheckoutCashFlowActive(checkoutCashFlow, CHECKOUT_CASH_WAIT_AMOUNT)) {
            if (shouldTextStateConsumeInput(TEXT_STATE_CHECKOUT_AMOUNT, textIn, commandRoute)) {
              const amount = parseCheckoutCashAmount(textIn);
              const nextFlow = buildCheckoutCashAmountState(checkoutCashFlow, amount);
              await kvPut(env, checkoutCashFlowKey, nextFlow, CHECKOUT_CASH_FLOW_TTL_SECONDS);

              const askImage = buildCheckoutCashImagePrompt(nextFlow);
              await replyOrPushText(
                env,
                replyToken,
                chatId,
                askImage,
                'checkout_cash_amount_ack_failed'
              );
              continue;
            }
            deferredStatePrompt = 'ยอดเงินสดไม่ถูกต้อง กรุณาพิมพ์เฉพาะตัวเลข เช่น 1500 หรือ 1,500';
          }

          if (isCheckoutCashFlowActive(checkoutCashFlow, CHECKOUT_CASH_WAIT_IMAGE)) {
            deferredStatePrompt = 'โปรดส่งรูปหลักฐานเงินสดเป็นรูปภาพในแชทนี้ค่ะ';
          }

          const checkinRoomCode = parseCheckinCommand(textIn);
          if (checkinRoomCode) {
            await startCheckinFlow(env, ctx, ev, replyToken, textIn, checkinRoomCode, commandOwner);
            continue;
          }

          const parkingPhoneStateKey = parkingOutsiderPhoneFlowKey(userId);
          const parkingPhoneState = parkingPhoneStateKey ? await kvGet(env, parkingPhoneStateKey) : null;
          if (parkingPhoneState?.state === PARKING_OUTSIDER_PHONE_STATE) {
            if (shouldTextStateConsumeInput(TEXT_STATE_PARKING_PHONE, textIn, commandRoute)) {
              if (await handleParkingOutsiderPhoneText(env, ctx, ev, replyToken, textIn)) {
                continue;
              }
            } else {
              deferredStatePrompt = 'กรุณาส่งเบอร์โทรศัพท์ให้ถูกต้อง เช่น 0812345678 ภายใน 2 นาทีครับ';
            }
          }

          const cleaningCommand = parseCleaningCommand(textIn);
          if (cleaningCommand) {
            if (cleaningCommand.act === 'management' && !isCleaningManagementAllowedLineUserId(userId)) {
              console.log('cleaning_management_unauthorized', { userId, text: textIn.slice(0, 80) });
              await replyOrPushText(
                env,
                replyToken,
                chatId,
                'คำสั่งจัดการงานทำความสะอาดใช้ได้เฉพาะเจ้าหน้าที่ที่ได้รับอนุญาตค่ะ',
                'cleaning_management_unauthorized_reply_failed'
              );
              continue;
            }

            if (cleaningCommand.act === 'tenant') {
              const confirmFlex = buildCleaningTenantConfirmFlex();
              await replyOrPushMessages(env, replyToken, chatId, [confirmFlex], 'cleaning_tenant_reply_failed');
              continue;
            }

            const cleaningPayload = {
              source: 'line_message',
              intent: 'cleaning_request',
              act: cleaningCommand.act,
              roomId: cleaningCommand.roomId,
              text: textIn,
              lineUserId: userId || '',
              chatId: chatId || '',
              sourceType: ev?.source?.type || '',
              replyToken: replyToken || '',
              messageId: m?.id || '',
              webhookEventId: ev?.webhookEventId || '',
              receivedAt: new Date().toISOString()
            };

            ctx.waitUntil(
              notifyN8nCleaning(env, cleaningPayload).catch((err) => console.error('cleaning webhook failed', err))
            );

            const ackText = buildCleaningManagementAckText(cleaningCommand.roomId);
            await replyOrPushText(env, replyToken, chatId, ackText, 'cleaning_management_ack_failed');
            continue;
          }

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
            await replyOrPushMessages(env, replyToken, chatId, [msg], 'screening_config_reply_failed');
            continue;
          }

          const coAdminShortcut = parseCoAdminShortcut(textIn);
          if (coAdminShortcut) {
            if (isCheckoutStartShortcut(coAdminShortcut)) {
              await handleCheckoutStart(env, {
                roomId: coAdminShortcut.roomId,
                text: textIn,
                event: ev,
                replyToken
              });
              continue;
            }

            if (requiresCoAdminShortcutPermission(coAdminShortcut) && !isCoAdminAllowedLineUserId(userId)) {
              console.log('co_admin_unauthorized', { userId, text: textIn.slice(0, 80) });
              await replyOrPushText(
                env,
                replyToken,
                chatId,
                'คำสั่งนี้ใช้ได้เฉพาะเจ้าหน้าที่ที่ได้รับอนุญาตค่ะ',
                'co_admin_unauthorized_reply_failed'
              );
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

            await replyOrPushText(env, replyToken, chatId, ackText, 'co_admin_ack_failed');
            continue;
          }

          // --- Registration Flow State ---
          const regKey = userId ? 'reg_id:' + userId : '';
          const regState = userId ? await kvGet(env, regKey) : null;
          if (
            regState &&
            regState.action === 'ask_roomid' &&
            shouldTextStateConsumeInput(TEXT_STATE_REGISTRATION_ROOM, textIn, commandRoute)
          ) {
            // Allow cancel
            if (textIn === 'ยกเลิก' || textIn.toLowerCase() === 'cancel') {
              await kvDel(env, regKey);
              await replyOrPushText(env, replyToken, chatId, 'ยกเลิกการลงทะเบียนแล้วค่ะ', 'registration_cancel_ack_failed');
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
              await replyOrPushText(
                env,
                replyToken,
                chatId,
                `ลงทะเบียนห้อง ${normalized} เรียบร้อยแล้วค่ะ`,
                'registration_room_ack_failed'
              );
              continue;
            }
          }
          if (regState && regState.action === 'ask_roomid') {
            deferredStatePrompt = 'รูปแบบไม่ถูกต้อง กรุณาพิมพ์เลขห้องของคุณ เช่น A102 หรือ B514 (หรือพิมพ์ "ยกเลิก")';
          }

          const changeLineKey = userId ? TENANT_CHANGE_KEY_PREFIX + userId : '';
          const changeLineState = userId ? await kvGet(env, changeLineKey) : null;
          const fridgeIntent = detectFridgeIntent(textIn);
          const parkingServiceKeyword = isParkingIntent(textIn);
          const isPaymentMenuBypass = /^\s*จ่าย\s*เงิน\s*มามา\s*แมนชั่น\s*$/i.test(textIn);
          const isPaymentMenu = isPaymentMenuBypass;
          const checkoutPaymentShortcut = parseCheckoutPaymentText(textIn);
          const presetOtherPaymentReason = detectPresetOtherPaymentReason(textIn, checkoutPaymentShortcut);
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
          const armOtherPaymentSlipFlow = async (reasonText, options = {}) => {
            const normalizedReason = normalizePenaltyReason(reasonText || '');
            const roomId = String(options?.roomId || '').trim().toUpperCase();
            const penaltyContext = {
              ts: Date.now(),
              chatId,
              userId,
              type: 'Others_payment',
              reason: normalizedReason || reasonText || 'ค่าอื่นๆ',
              ...((normalizedReason === 'CHECKOUT' || normalizedReason === 'CHECKOUT2')
                ? { categories: normalizedReason }
                : {}),
              ...(roomId ? { roomId, room: roomId } : {}),
              ...(options?.building ? { building: String(options.building).trim().toUpperCase() } : {}),
              ...(options?.amount != null ? { amount: Number(options.amount) } : {})
            };
            const activeFlow = (normalizedReason === 'KEY_FORGOT' && userId)
              ? (commandOwner
                ? await updateActiveFlowIfCurrent(env, userId, commandOwner, {
                  flowType: 'key_forgot',
                  kind: 'key_forgot',
                  phase: 'await_slip',
                  context: { penaltyFlow: penaltyContext },
                  preserveVersion: true,
                  ttlSeconds: PENALTY_FLOW_TTL_SECONDS
                })
                : await setActiveFlow(env, userId, {
                  flowType: 'key_forgot',
                  kind: 'key_forgot',
                  phase: 'await_slip',
                  event: ev,
                  scopeType: String(ev?.source?.type || '').trim() || 'user',
                  scopeId: String(ev?.source?.groupId || ev?.source?.roomId || '').trim(),
                  ttlSeconds: PENALTY_FLOW_TTL_SECONDS,
                  context: { penaltyFlow: penaltyContext }
                }))
              : null;
            const flow = {
              ...penaltyContext,
              ...(activeFlow ? {
                flowId: activeFlow.flowId,
                version: activeFlow.version,
                flowVersion: activeFlow.version
              } : {})
            };
            const checkout2GroupKey = (normalizedReason === 'CHECKOUT' || normalizedReason === 'CHECKOUT2')
              ? getCheckout2GroupWaitingSlipKey(ev)
              : '';
            const mirrorKeys = [penaltyKey, checkout2GroupKey].filter(Boolean);
            if (normalizedReason === 'KEY_FORGOT' && activeFlow) {
              const mirrorResults = await Promise.allSettled(
                mirrorKeys.map((key) => kvPutStrict(env, key, flow, PENALTY_FLOW_TTL_SECONDS))
              );
              const failedMirrors = mirrorResults.flatMap((result, index) => (
                result.status === 'rejected'
                  ? [{ key: mirrorKeys[index], error: String(result.reason?.message || result.reason) }]
                  : []
              ));
              if (failedMirrors.length) {
                console.warn('key_forgot_kv_mirror_partial_failure', {
                  userId,
                  chatId,
                  flowId: activeFlow.flowId,
                  failedMirrors
                });
              }
            } else {
              await Promise.all(
                mirrorKeys.map((key) => kvPut(env, key, flow, PENALTY_FLOW_TTL_SECONDS))
              );
            }
            return { flow, activeFlow, penaltyKey, checkout2GroupKey };
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
            await clearPaymentStatesForEvent(env, ev);
            await kvPut(env, keyRentFlowKey, flow, KEY_RENT_FLOW_TTL_SECONDS);

            const paymentMsg = buildKeyRentPaymentMessage(flow.keyRent);
            await replyOrPushMessages(env, replyToken, chatId, [paymentMsg], 'key_rent_payment_prompt_failed');
          };
          // Payment menu entry point should bypass any stale payment state.
          if (isPaymentMenu) {
            const flex = buildPaymentOptionsFlex();
            const fallbackText = [
              'เลือกประเภทการชำระเงิน',
              '',
              'ชำระบิลทั่วไป',
              '- ชำระค่าเช่าห้อง',
              '- ลืม/ทำกุญแจหาย',
              '',
              'บริการเพิ่มเติม / เช่าเพิ่ม',
              '- ชำระค่าทำความสะอาด',
              '- ชำระค่าเช่าที่จอดรถ',
              '- เช่ากุญแจเพิ่ม'
            ].join('\n');

            try {
              if (replyToken) {
                await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [flex]);
              } else if (chatId) {
                await linePush(env.LINE_ACCESS_TOKEN, chatId, [flex]);
              }
            } catch (err) {
              console.error('payment_menu_send_failed', err);
              if (chatId) {
                ctx.waitUntil(linePushText(env.LINE_ACCESS_TOKEN, chatId, fallbackText).catch((pushErr) => console.error('payment_menu_fallback_failed', pushErr)));
              }
            }
            continue;
          }

          // While waiting for penalty reason, treat the next text as reason first.
          if (
            penaltyReasonNeeded &&
            shouldTextStateConsumeInput(TEXT_STATE_PENALTY_REASON, textIn, commandRoute)
          ) {
            const reason = (textIn || '').trim();
            const updated = {
              ...penaltyFlow,
              reason: normalizePenaltyFlowReason(reason),
              categories: reason,
              ts: Date.now(),
              chatId,
              userId
            };
            ctx.waitUntil(kvPut(env, penaltyKey, updated, PENALTY_FLOW_TTL_SECONDS));

            const typeLabel = (penaltyFlow?.type || '') === 'Others_payment' ? 'ค่าอื่นๆ' : 'ค่าปรับ';
            const askSlip = `บันทึก${typeLabel}แล้ว โปรดส่งสลิปได้เลยค่ะ`;
            await replyOrPushText(env, replyToken, chatId, askSlip, 'penalty_reason_ack_failed');
            continue;
          }
          if (penaltyReasonNeeded && !commandRoute) {
            deferredStatePrompt = (penaltyFlow?.type || '') === 'Others_payment'
              ? 'โปรดระบุว่าเป็นค่าอะไร เช่น ค่าคีย์การ์ด, ค่าน้ำดื่ม ฯลฯ'
              : 'โปรดระบุว่าค่าปรับเรื่องอะไร เช่น เสียงดัง, จอดรถ, สูบบุหรี่ ฯลฯ';
          }

          if (presetOtherPaymentReason) {
            if (presetOtherPaymentReason !== 'KEY_FORGOT') {
              await clearPaymentStatesForEvent(env, ev);
            }
            await armOtherPaymentSlipFlow(presetOtherPaymentReason, {
              roomId: checkoutPaymentShortcut?.roomId || ''
            });
            const presetReasonLabel = paymentReasonLabel(presetOtherPaymentReason);
            const presetRoomLabel = checkoutPaymentShortcut?.roomId ? ` ห้อง ${checkoutPaymentShortcut.roomId}` : '';
            const askSlip = `บันทึกรายการ${presetReasonLabel}${presetRoomLabel}แล้ว โปรดส่งสลิปได้เลยค่ะ`;
            await replyOrPushText(env, replyToken, chatId, askSlip, 'preset_payment_ack_failed');
            continue;
          }

          if (/^\s*(?:ขอ)?เช่าชุดกุญแจ\s*$/i.test(textIn)) {
            const messages = [
              { type: 'text', text: buildKeyRentStartInstructionText(env) },
              buildKeyRentStartOptionsMessage()
            ];
            await replyOrPushMessages(env, replyToken, chatId, messages, 'key_rent_start_reply_failed');
            continue;
          }

          const keyRent = parseKeyRent(textIn);

          if (keyRent) {
            if (keyRent.error === 'MISSING_ROOM') {
              const askRoomText = 'พิมพ์เช่น “เช่าชุดกุญแจ A101” หรือ “เช่าคีย์การ์ด A101 โอน”';
              await replyOrPushText(env, replyToken, chatId, askRoomText, 'key_rent_room_prompt_failed');
              continue;
            }

            const paymentMethodFromText = normalizeKeyRentPaymentMethod(keyRent.paymentMethod || '');
            if (paymentMethodFromText) {
              const keyRentResolved = {
                ...keyRent,
                rawText: textIn || keyRent.rawText || ''
              };
              const eventId = String(ev?.webhookEventId || ev?.replyToken || m?.id || '');
              const idempotencyKey = eventId
                ? `line:${eventId}`
                : `line:keyrent:text:${stateKey}:${paymentMethodFromText}:${Date.now()}`;
              const payload = {
                type: 'KEY_RENT',
                intent: 'key_rent_payment',
                room: keyRentResolved.room,
                mode: keyRentResolved.mode || null,
                items: keyRentResolved.items,
                amount: keyRentResolved.amount,
                userId: userId || null,
                chatId: chatId || null,
                sourceType: ev?.source?.type || null,
                messageId: m?.id || null,
                receivedAt: new Date().toISOString(),
                paymentMethod: paymentMethodFromText,
                eventId,
                idempotencyKey
              };

              const messages = [{ type: 'text', text: buildKeyRentAckText(keyRentResolved) }];
              if (paymentMethodFromText === 'MOBILE_BANKING') {
                messages.push({ type: 'text', text: KEY_RENT_MOBILE_BANKING_TEXT });
                messages.push({ type: 'text', text: buildKeyRentSlipPrompt(keyRentResolved) });
              }
              await replyOrPushMessages(env, replyToken, chatId, messages, 'key_rent_ack_failed');

              ctx.waitUntil(
                notifyN8nKeyWebhook(env, payload).catch((err) => console.error('key webhook failed', err))
              );

              await clearPaymentStatesForEvent(env, ev);
              if (paymentMethodFromText === 'MOBILE_BANKING') {
                ctx.waitUntil(
                  kvPut(
                    env,
                    penaltyKey,
                    {
                      ts: Date.now(),
                      chatId: chatId || null,
                      userId: userId || null,
                      type: 'Others_payment',
                      reason: normalizePenaltyReason(keyRentResolved.rawText || 'ค่าเช่ากุญแจ')
                    },
                    PENALTY_FLOW_TTL_SECONDS
                  )
                );
              } else {
                ctx.waitUntil(kvDel(env, penaltyKey));
              }
              continue;
            }

            await startKeyRentPayment(keyRent, textIn);
            continue;
          }

          if (/^\s*เปลี่ยนไอดีผู้เช่า\s*$/i.test(textIn)) {
            if (userId) {
              await kvPut(env, changeLineKey, { state: WAIT_ROOM_STATE, ts: Date.now(), chatId, userId });
            }
            notifyTenantChange('tenant_id_change_request');
            await replyOrPushText(
              env,
              replyToken,
              chatId,
              'ได้รับคำขอเปลี่ยนไอดีผู้เช่าแล้ว กำลังส่งเรื่องให้เจ้าหน้าที่ค่ะ',
              'tenant_change_start_ack_failed'
            );
            continue;
          }

          if (textIn === 'ลงทะเบียนไอดี') {
            // Set state to wait for Room ID
            if (userId) {
              await kvPut(env, 'reg_id:' + userId, { action: 'ask_roomid', ts: Date.now() }, 600); // 10 min TTL
            }

            await replyOrPushText(
              env,
              replyToken,
              chatId,
              '✅ รับทราบครับ\nกรุณาพิมพ์เลขห้องของคุณ เช่น A102 หรือ B514',
              'registration_start_ack_failed'
            );
            continue;
          }


          // (A) Magic link (แจ้งออก) → forward to GAS to issue token + send link
          if (/^\s*(แจ้งออก)\s*$/i.test(textIn)) {
            // quick acknowledge so user sees immediate response
            await replyOrPushText(
              env,
              replyToken,
              chatId,
              'กำลังสร้างลิงก์แจ้งออกให้คุณ… กรุณารอสักครู่',
              'moveout_start_ack_failed'
            );

            // forward the original LINE event to GAS
            // (your GAS doPost will detect text === แจ้งออก and call _issueAndSendMoveOutMagicLink_)
            await forwardToGas(env, { events: [ev] });

            continue;
          }

          // (B) While inside move-out flow (รวม confirm)
          const handled = await moveoutTextGate(env, stateKey, textIn, replyToken);
          if (handled) continue;

          // (C) Rent payment trigger
          if (/^\s*(ส่งสลิปค่าเช่า|ชำระค่าเช่า|ชำระค่าเช่าห้อง|จ่ายค่าเช่า|จ่ายค่าเช่าห้อง|send\s*rent\s*slip|pay\s*rent)\s*$/i.test(textIn)) {
            if (chatId) {
              ctx.waitUntil(lineStartLoading(env.LINE_ACCESS_TOKEN, chatId, 7));
            }

            await clearPaymentStatesForEvent(env, ev, [payRentKey]);
            await kvPut(env, payRentKey, { ts: Date.now(), chatId, userId }, 15 * 60);

            const notifyMsg = { type: 'text', text: PAY_RENT_SLIP_PROMPT };
            await replyOrPushMessages(env, replyToken, chatId, [notifyMsg], 'pay_rent_start_ack_failed');
            continue;
          }

          // (C.2) Penalty payment trigger
          if (isPenaltyPayment) {
            if (chatId) {
              ctx.waitUntil(lineStartLoading(env.LINE_ACCESS_TOKEN, chatId, 7));
            }

            const genericPenalty = (penaltyType || 'penalty') === 'penalty';
            const replyText = genericPenalty
              ? 'โปรดส่งสลิปได้เลยค่ะ'
              : 'เป็นค่าอะไรคะ เช่น ค่าคีย์การ์ด, ค่าน้ำดื่ม, ค่าผ้า ฯลฯ';
            await replyOrPushText(env, replyToken, chatId, replyText, 'penalty_start_ack_failed');

            await clearPaymentStatesForEvent(env, ev);
            ctx.waitUntil(
              kvPut(
                env,
                penaltyKey,
                {
                  ts: Date.now(),
                  chatId,
                  userId,
                  type: penaltyType || 'penalty',
                  reason: genericPenalty ? 'OTHERS' : null,
                  categories: genericPenalty ? 'OTHERS' : '',
                  webhookTarget: genericPenalty ? 'warn_payment' : ''
                },
                PENALTY_FLOW_TTL_SECONDS
              )
            );
            continue;
          }

          if (payRentActive && !isPaymentMenuBypass) {
            // This state is waiting for an image. Text must continue through
            // the command router instead of extending or trapping the state.
            deferredStatePrompt = 'โปรดส่งสลิปเป็นรูปภาพได้เลยค่ะ';
          }

          if (penaltyActive && !penaltyMatch && !isPaymentMenuBypass && !penaltyReasonNeeded) {
            deferredStatePrompt = 'โปรดส่งสลิปเป็นรูปภาพได้เลยค่ะ';
          }

          // (C.1) Fridge service button → link to n8n automation
          if (fridgeIntent.matches) {
            if (fridgeIntent.isCancel && !fridgeIntent.isAdd) {
              const cancelAck = 'ได้รับคำขอยกเลิกตู้เย็นแล้ว เจ้าหน้าที่จะแจ้งกลับโดยเร็วที่สุดนะคะ';
              await replyOrPushText(env, replyToken, chatId, cancelAck, 'fridge_cancel_ack_failed');

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
            await replyOrPushMessages(env, replyToken, chatId, replies, 'fridge_info_reply_failed');
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
            await replyOrPushMessages(env, replyToken, chatId, replies, 'parking_info_reply_failed');
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

          const returnKeyRoomId = parseReturnKeyTrigger(textIn);
          if (returnKeyRoomId) {
            const handled = await handleReturnKeyStart(env, {
              roomId: returnKeyRoomId,
              text: textIn,
              event: ev,
              replyToken
            });
            if (handled) continue;
          }

          if (
            changeLineState?.state === WAIT_ROOM_STATE &&
            shouldTextStateConsumeInput(TEXT_STATE_TENANT_CHANGE_ROOM, textIn, commandRoute)
          ) {
            notifyTenantChange('tenant_id_change_room');
            await replyOrPushText(
              env,
              replyToken,
              chatId,
              'รับรหัสห้องแล้วค่ะ เจ้าหน้าที่แจ้งกลับให้เร็วที่สุด',
              'tenant_change_room_ack_failed'
            );
            continue;
          }
          if (changeLineState?.state === WAIT_ROOM_STATE) {
            deferredStatePrompt = 'กรุณาพิมพ์เลขห้อง เช่น A102 หรือ B514 ค่ะ';
          }

          if (OWNER_APPROVAL_KEYWORD_RE.test(textIn)) {
            const intent = textIn.trim().startsWith('ไม่') ? 'tenant_id_change_reject' : 'tenant_id_change_approve';
            notifyTenantChange(intent);
            await replyOrPushText(
              env,
              replyToken,
              chatId,
              'ส่งสถานะไปยังเจ้าหน้าที่เรียบร้อยแล้วค่ะ',
              'tenant_change_approval_ack_failed'
            );
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
            await replyOrPushText(
              env,
              replyToken,
              chatId,
              'ได้รับคำขอเปลี่ยนไอดีผู้เช่าแล้วค่ะ เจ้าหน้าที่จะติดต่อกลับโดยเร็วที่สุด',
              'tenant_change_notify_ack_failed'
            );
            continue;
          }

          // (D) Quick keyword replies
          const fast = precomputedFastReply;
          if (fast) {
            ctx.waitUntil(
              replyOrPushMessages(env, replyToken, chatId, fast, 'quick_keyword_reply_failed')
            );
            continue;
          }

          if (isCheckinChangeIntent(textIn)) {
            const notifyMsg = 'กำลังส่งปุ่มเลือกวัน–เวลาเช็คอินให้ค่ะ รอสักครู่…';
            await replyOrPushText(env, replyToken, chatId, notifyMsg, 'checkin_change_ack_failed');
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
          if (/^#?\s*PB\d{3,}$/i.test(textIn)) {
            const prebookCode = extractPrebookCode(textIn);
            const prebookBinding = {
              code: prebookCode,
              userId: userId || '',
              chatId: chatId || '',
              sourceType: ev?.source?.type || '',
              boundAt: Date.now(),
              lastSeenAt: Date.now()
            };

            if (userId) {
              ctx.waitUntil(kvPut(env, buildPrebookUserKey(userId), prebookBinding, PREBOOK_BIND_TTL_SECONDS));
            }
            if (prebookCode) {
              ctx.waitUntil(kvPut(env, buildPrebookCodeKey(prebookCode), prebookBinding, PREBOOK_BIND_TTL_SECONDS));
            }
            ctx.waitUntil(notifyN8nPrebookWebhook(env, {
              ...prebookBinding,
              text: textIn,
              webhookEventId: ev?.webhookEventId || '',
              replyToken: ev?.replyToken || '',
              timestamp: ev?.timestamp || null
            }).catch((err) => console.error('prebook webhook failed', err)));

            const ackText = [
              `รับรหัสฝากห้อง ${prebookCode} แล้วค่ะ`,
              'หากมีห้องว่างหรือมีห้องตรงเงื่อนไข ทีมงานจะติดต่อกลับทาง LINE นี้'
            ].join('\n');

            await replyOrPushText(env, replyToken, chatId, ackText, 'prebook_code_ack_failed');
            continue;
          }

          if (parseBookingCodeCommand(textIn)) {
            const resvUrl = getReservationGas(env);
            const bookingCode = extractBookingCode(textIn);
            if (!resvUrl) {
              await errorReplyOrPush(env, replyToken, chatId, 'Reservation system is not configured. Please contact admin.');
              continue;
            }
            if (userId) {
              await replaceWithReservationFlow(env, ev, {
                phase: 'await_confirm',
                code: bookingCode || '',
                ttlSeconds: BOOKING_SLIP_TTL_SECONDS
              });
            }
            const ackMsg = bookingCode
              ? `รับรหัสจอง ${bookingCode} แล้วค่ะ กำลังตรวจสอบให้ทันที`
              : 'รับรหัสจองแล้วค่ะ กำลังตรวจสอบให้ทันที';
            await replyOrPushText(env, replyToken, chatId, ackMsg, 'booking_code_ack_failed');
            console.log('reservation_text_forward_to_gas', {
              bookingCode,
              chatId,
              userId,
              resvUrl
            });
            ctx.waitUntil(forwardToSpecificGas(env, resvUrl, { events: [ev] }));
            continue;
          }

          // (E) Label → act mapping
          const mappedAct =
            ROOM_LABEL_MAP[textIn] ? ROOM_LABEL_MAP[textIn] :
              FIX_LABEL_MAP[textIn] ? FIX_LABEL_MAP[textIn] :
                null;


          // Reservation slip/ID confirmations are owned by reservation GAS.
          // Keep the legacy worker block below disabled so stale KV cannot
          // revive worker-side reservation state.
          const bookingFlowKey = '';
          const bookingFlow: any = null;

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
          if (parseBookingCodeCommand(textIn)) {
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

          if (deferredStatePrompt && !commandRoute) {
            await replyOrPushText(
              env,
              replyToken,
              chatId,
              deferredStatePrompt,
              'deferred_state_prompt_failed'
            );
            continue;
          }

          // (H) Forward everything else to GAS
          ctx.waitUntil(forwardToGas(env, { events: [ev] }));
          continue;
        }

        // === IMAGE ===
        if (m.type === 'image') {
          const chatId = getChatId(ev);
          const imageUserId = String(ev?.source?.userId || '').trim();
          const canonicalActiveFlow = earlyCanonicalActiveFlow || (imageUserId ? await getActiveFlow(env, imageUserId, ev) : null);

          // A recognized latest command is authoritative. Claimed images go to
          // exactly one backend and never reach AUTO_IMG or a stale legacy flow.
          if (
            canonicalActiveFlow &&
            isReservationFlowScopeMatchEvent(canonicalActiveFlow, ev)
          ) {
            const activeKind = String(
              canonicalActiveFlow.kind || canonicalActiveFlow.flowType || ''
            ).trim().toLowerCase();

            if (activeKind === 'reservation' && isReservationActiveFlowPhase(canonicalActiveFlow.phase)) {
              const resvUrl = getReservationGas(env);
              if (!resvUrl) {
                await errorReplyOrPush(env, replyToken, chatId, 'Reservation image receiver is not configured. Please contact admin.');
                continue;
              }

              await replyOrPushText(
                env,
                replyToken,
                chatId,
                'รับไฟล์แล้ว กำลังตรวจสอบ…',
                'reservation_image_ack_failed'
              );
              ctx.waitUntil((async () => {
                const gasResult = await forwardToSpecificGasResult(
                  env,
                  resvUrl,
                  buildReservationForwardPayload(ev, canonicalActiveFlow)
                );
                if (gasResult.ok) {
                  const gasAck = getReservationFlowAck(gasResult.data);
                  const sameAckIdentity = !!(
                    gasAck?.flowId && gasAck?.version &&
                    gasAck.flowId === String(canonicalActiveFlow.flowId || '') &&
                    (!gasAck.code || !canonicalActiveFlow.code || gasAck.code === String(canonicalActiveFlow.code).trim().toUpperCase())
                  );
                  if (gasAck?.clearActiveFlow && sameAckIdentity) {
                    await clearActiveFlowIfCurrent(env, imageUserId, canonicalActiveFlow);
                    return;
                  }
                  const validAck = !!(
                    gasAck && !gasAck.terminal && sameAckIdentity
                  );
                  const synced = validAck ? await syncReservationFlowFromGasAck(
                    env,
                    imageUserId,
                    canonicalActiveFlow,
                    gasResult.data
                  ) : null;
                  if (!synced && chatId) {
                    await safeLinePushText(
                      env.LINE_ACCESS_TOKEN,
                      chatId,
                      'รับไฟล์แล้ว แต่ระบบยังไม่ยืนยันขั้นตอน กรุณาส่งไฟล์อีกครั้งค่ะ',
                      'reservation_image_invalid_ack_push_failed'
                    );
                  }
                } else if (chatId) {
                  await safeLinePushText(
                    env.LINE_ACCESS_TOKEN,
                    chatId,
                    'รับไฟล์แล้ว แต่ระบบการจองยังไม่ตอบ กรุณาส่งไฟล์อีกครั้งค่ะ',
                    'reservation_image_forward_failure_push_failed'
                  );
                }
              })());
              continue;
            }

            if (activeKind === 'key_forgot' && canonicalActiveFlow.phase === 'await_slip') {
              const penaltyKey = `${getStateKey(ev)}:penalty_flow`;
              const contextPenaltyFlow = canonicalActiveFlow?.context?.penaltyFlow || {};
              const penaltyFlow = {
                ts: Date.now(),
                chatId,
                userId: imageUserId,
                type: 'Others_payment',
                reason: 'KEY_FORGOT',
                ...contextPenaltyFlow,
                flowId: canonicalActiveFlow.flowId,
                version: canonicalActiveFlow.version,
                flowVersion: canonicalActiveFlow.version
              };
              await handlePenaltyPaymentImage(env, ctx, {
                event: ev,
                replyToken,
                chatId,
                penaltyFlow,
                penaltyStateKeys: [penaltyKey],
                activeFlow: canonicalActiveFlow
              });
              continue;
            }
          }

          const checkoutCashFlowKey = getCheckoutCashFlowKey(ev);
          const checkoutCashFlow = await kvGet(env, checkoutCashFlowKey);
          if (isCheckoutCashFlowActive(checkoutCashFlow, CHECKOUT_CASH_WAIT_IMAGE)) {
            const cashPayload = buildCheckoutCashImagePayload(ev, checkoutCashFlow);
            const ok = await notifyN8nCheckoutCash(env, cashPayload);

            if (ok) {
              ctx.waitUntil(kvDel(env, checkoutCashFlowKey));
            }

            const amountText = checkoutCashFlow.amountText || formatCheckoutCashAmount(checkoutCashFlow.amount);
            const roomText = checkoutCashFlow.roomId ? `ห้อง ${checkoutCashFlow.roomId} ` : '';
            const ackText = ok
              ? `รับรูปหลักฐานเงินสด${roomText}${amountText ? `${amountText} บาท` : ''}แล้ว กำลังส่งต่อให้เจ้าหน้าที่ตรวจสอบค่ะ`
              : 'รับรูปแล้ว แต่ส่งเข้าระบบไม่สำเร็จ กรุณาลองส่งรูปอีกครั้งค่ะ';

            if (replyToken) {
              await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [{ type: 'text', text: ackText }]).catch(console.error);
            } else if (chatId) {
              ctx.waitUntil(linePushText(env.LINE_ACCESS_TOKEN, chatId, ackText).catch(console.error));
            }

            if (!ok) {
              ctx.waitUntil(kvPut(env, checkoutCashFlowKey, { ...checkoutCashFlow, ts: Date.now() }, CHECKOUT_CASH_FLOW_TTL_SECONDS));
            }
            continue;
          }

          const billManualState = imageUserId ? await getActiveBillManualPaymentState(env, imageUserId) : null;
          if (billManualState) {
            const slipPayload = buildBillManualSlipPayload(ev, billManualState);
            ctx.waitUntil(
              (async () => {
                const ok = await notifyN8nBillManual(env, slipPayload);
                if (ok) {
                  await kvDel(env, getBillManualPaymentStateKey(imageUserId));
                }
              })().catch((err) => console.error('bill_manual_slip_forward_failed', err))
            );

            const ackText = billManualState.billId
              ? `รับสลิปสำหรับเลขอ้างอิง ${billManualState.billId} แล้วค่ะ กำลังส่งต่อให้ระบบตรวจสอบ`
              : 'รับสลิปแล้วค่ะ กำลังส่งต่อให้ระบบตรวจสอบ';
            if (replyToken) {
              await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [{ type: 'text', text: ackText }]).catch(console.error);
            } else if (chatId) {
              ctx.waitUntil(linePushText(env.LINE_ACCESS_TOKEN, chatId, ackText).catch(console.error));
            }
            continue;
          }

          const checkinFlowKey = buildCheckinFlowKey(ev?.source?.userId, chatId);
          const checkinFlowState = await kvGet(env, checkinFlowKey);
          const checkinActive = isCheckinFlowStateActive(checkinFlowState);
          console.log('checkinFlowState', {
            key: checkinFlowKey,
            active: checkinActive,
            state: checkinFlowState
          });

          // An explicit "check in room" command owns the sender's next image.
          // Handle it before reservation and keycard fallbacks can consume it.
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
              (async () => {
                const ok = await notifyN8nCheckinFlow(env, slipPayload);
                if (ok) {
                  await kvDel(env, checkinFlowKey);
                  return;
                }
                console.error('checkin slip webhook failed; retaining waiting state', {
                  key: checkinFlowKey,
                  roomId: checkinFlowState.roomId
                });
              })().catch((err) => console.error('checkin slip notify failed', err))
            );

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

          const stateKey = getStateKey(ev);
          const penaltyKey = stateKey + ':penalty_flow';
          const checkout2GroupKey = getCheckout2GroupWaitingSlipKey(ev);
          const directPenaltyFlow = await kvGet(env, penaltyKey);
          const checkout2GroupFlow = checkout2GroupKey ? await kvGet(env, checkout2GroupKey) : null;
          const penaltySelection = selectPenaltyFlowForImage(
            directPenaltyFlow,
            checkout2GroupFlow,
            chatId
          );
          const penaltyFlow = penaltySelection.flow;
          const penaltyActive = penaltySelection.active;
          const penaltyFlowOwnerKey = isCheckoutTransferSlipFlow(penaltyFlow) && penaltyFlow?.chatId && penaltyFlow?.userId
            ? `${penaltyFlow.chatId}:${penaltyFlow.userId}:penalty_flow`
            : '';
          const penaltyStateKeys = Array.from(new Set([
            penaltyKey,
            isCheckoutTransferSlipFlow(penaltyFlow) ? checkout2GroupKey : '',
            penaltyFlowOwnerKey
          ].filter(Boolean)));

          // An explicitly armed payment flow owns the next image. Handle it
          // before slower keycard-state retries or generic reservation routes.
          if (penaltyActive) {
            await handlePenaltyPaymentImage(env, ctx, {
              event: ev,
              replyToken,
              chatId,
              penaltyFlow,
              penaltyStateKeys
            });
            continue;
          }

          const sourceType = String(ev?.source?.type || '');
          const groupId = String(ev?.source?.groupId || '');
          const managerUserId = String(ev?.source?.userId || '');
          const checkinKeycardStateUserKey = (sourceType === 'group' && groupId && managerUserId)
            ? getCheckinKeycardWaitingPhotoKey(groupId, managerUserId)
            : '';
          const checkinKeycardStateGroupKey = (sourceType === 'group' && groupId)
            ? getCheckinKeycardWaitingPhotoGroupKey(groupId)
            : '';
          const checkinKeycardStateUserOnlyKey = managerUserId
            ? getCheckinKeycardWaitingPhotoUserKey(managerUserId)
            : '';
          const checkinKeycardStateResult = sourceType === 'group'
            ? await getCheckinKeycardWaitingPhotoState(
              env,
              checkinKeycardStateUserKey,
              checkinKeycardStateGroupKey,
              checkinKeycardStateUserOnlyKey,
              groupId,
              managerUserId
            )
            : {
              stateFromUser: null,
              stateFromGroup: null,
              stateFromUserOnly: null,
              stateFromMemory: null,
              state: null
            };
          const checkinKeycardStateFromUser = checkinKeycardStateResult.stateFromUser;
          const checkinKeycardStateFromGroup = checkinKeycardStateResult.stateFromGroup;
          const checkinKeycardState = checkinKeycardStateResult.state || null;
          const checkinKeycardActive = !!(
            checkinKeycardState &&
            checkinKeycardState.mode === 'WAITING_CHECKIN_KEYCARD_PHOTO' &&
            checkinKeycardState.ts &&
            (Date.now() - checkinKeycardState.ts < CHECKIN_KEYCARD_PHOTO_TTL_MS)
          );
          console.log('checkin_keycard_image_state', {
            sourceType,
            groupId,
            managerUserId,
            userKey: checkinKeycardStateUserKey,
            groupKey: checkinKeycardStateGroupKey,
            userOnlyKey: checkinKeycardStateUserOnlyKey,
            hasUserState: !!checkinKeycardStateFromUser,
            hasGroupState: !!checkinKeycardStateFromGroup,
            hasUserOnlyState: !!checkinKeycardStateResult.stateFromUserOnly,
            hasMemoryState: !!checkinKeycardStateResult.stateFromMemory,
            active: checkinKeycardActive,
            retryDelayMs: checkinKeycardStateResult.retryDelayMs || 0,
            stateRoomId: checkinKeycardState?.roomId || '',
            stateFlowId: checkinKeycardState?.flowId || ''
          });
          if (checkinKeycardActive) {
            const flowId = String(checkinKeycardState.flowId || '').trim();
            const roomIdFromState = String(checkinKeycardState.roomId || '').trim();
            const roomIdFromFlow = extractRoomId(flowId);
            const finalRoomId = roomIdFromState || roomIdFromFlow || '';
            const keycardPayload = {
              source: 'line_message',
              intent: 'checkin_keycard_photo',
              channel: 'checkin',
              event: ev,
              flowId,
              roomId: finalRoomId,
              room: finalRoomId,
              roomCode: finalRoomId,
              managerUserId,
              groupId,
              chatId,
              imageMessageId: ev?.message?.id || null,
              receivedAt: new Date().toISOString()
            };

            ctx.waitUntil(
              (async () => {
                await replyOrPushText(
                  env,
                  replyToken,
                  chatId,
                  'รับไฟล์แล้ว กำลังตรวจสอบ…',
                  'checkin_keycard_received_ack_failed'
                );

                await handleCheckinKeycardPhotoForward(env, {
                  state: checkinKeycardState,
                  payload: keycardPayload,
                  chatId,
                  groupId,
                  managerUserId,
                  userKey: checkinKeycardStateUserKey,
                  groupKey: checkinKeycardStateGroupKey,
                  userOnlyKey: checkinKeycardStateUserOnlyKey
                });
              })().catch((err) => {
                console.error('checkin keycard photo forward failed', err);
                return notifyCheckinKeycardPhotoStatus(env, chatId, {
                  ok: false,
                  roomId: finalRoomId,
                  reason: 'worker_exception',
                  detail: String(err?.message || err)
                });
              })
            );

            continue;
          }

          if (checkinKeycardState && !checkinKeycardActive) {
            const ageMs = checkinKeycardState.ts ? Date.now() - checkinKeycardState.ts : 0;
            const reason = checkinKeycardState.mode !== 'WAITING_CHECKIN_KEYCARD_PHOTO'
              ? `wrong_state_mode:${checkinKeycardState.mode || 'missing'}`
              : (ageMs >= CHECKIN_KEYCARD_PHOTO_TTL_MS ? 'waiting_state_expired' : 'waiting_state_invalid');
            ctx.waitUntil(
              notifyCheckinKeycardPhotoStatus(env, chatId, {
                ok: false,
                roomId: checkinKeycardState.roomId || extractRoomId(checkinKeycardState.flowId || ''),
                reason,
                detail: `ageMs=${ageMs}; userKey=${checkinKeycardStateUserKey || '-'}; groupKey=${checkinKeycardStateGroupKey || '-'}; userOnlyKey=${checkinKeycardStateUserOnlyKey || '-'}`
              }).catch(console.error)
            );
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
              const rentUrl = getN8nPayRentUrl(env);
              if (rentUrl) {
                const payload = {
                  events: [ev],
                  roomId: payRentFlow?.roomId || payRentFlow?.room || payRentFlow?.roomHint || 'UNKNOWN',
                  userId: ev?.source?.userId || '',
                  chatId
                };
                ctx.waitUntil(forwardToSpecificGas(env, rentUrl, payload));
              } else {
                console.warn('payrent image: missing N8N_PAYRENT_URL');
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

          // No legacy handler claimed the image. A canonical command in a
          // different phase must block generic OCR; it must never leak a slip
          // or ID card to AUTO_IMG or Reservation GAS.
          if (canonicalActiveFlow) {
            await replyOrPushText(
              env,
              replyToken,
              chatId,
              'รูปนี้ไม่ตรงกับขั้นตอนล่าสุด กรุณาทำตามข้อความล่าสุดในแชตค่ะ',
              'active_flow_unexpected_image_reply_failed'
            );
            continue;
          }

          const autoImgUrl = getAutoImgGas(env);
          if (autoImgUrl) {
            await replyOrPushText(
              env,
              replyToken,
              chatId,
              'รับไฟล์แล้ว กำลังตรวจสอบ…',
              'generic_image_ack_failed'
            );
            ctx.waitUntil(forwardToSpecificGas(env, autoImgUrl, { events: [ev] }));
            continue;
          }

          await replyOrPushText(
            env,
            replyToken,
            chatId,
            'ตอนนี้ยังไม่ได้อยู่ในขั้นตอนรับรูป หากเป็นการจองกรุณาพิมพ์รหัส เช่น #MM123 ก่อนค่ะ',
            'unclaimed_image_prompt_failed'
          );
          continue;

        }

      }
    }

    return new Response('OK', { status: 200 });
  }
};

export default worker;

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
  const cleaningPaymentPatterns = [
    'ค่าทำความสะอาด',
    'จ่ายค่าทำความสะอาด',
    'ชำระค่าทำความสะอาด',
    'cleaningpayment',
    'cleaningfee'
  ];
  const isCleaningPaymentReason = cleaningPaymentPatterns.some((pattern) => compact.includes(pattern));

  if (isRentKeyReason) return 'KEY_RENT';
  if (isCleaningPaymentReason) return 'CLEANING_PAYMENT';
  return text;
}

function normalizePenaltyFlowReason(reason) {
  return normalizePenaltyReason(reason);
}

function paymentReasonLabel(reason) {
  const normalized = normalizePenaltyReason(reason || '');
  const labels = {
    KEY_RENT: 'ค่าเช่ากุญแจ/คีย์การ์ดเพิ่ม',
    KEY_FORGOT: 'ค่าลืม/ทำกุญแจหาย',
    CLEANING_PAYMENT: 'ค่าทำความสะอาด',
    CAR: 'ค่าเช่าที่จอดรถ',
    CHECKOUT: 'ค่าเช็คเอาท์',
    CHECKOUT2: 'ค่าเช็คเอาท์สอง',
    OTHERS: 'ค่าปรับ/ค่าอื่นๆ'
  };
  return labels[normalized] || String(reason || '').trim() || 'รายการนี้';
}

function penaltyFlowPaymentLabel(flow) {
  const type = String(flow?.type || '').trim();
  if (type === 'penalty') return 'ค่าปรับ';
  return paymentReasonLabel(flow?.reason || flow?.categories || 'ค่าอื่นๆ');
}

function normalizePenaltySlipType(type) {
  const normalized = String(type || '').trim();
  return normalized === 'penalty' ? 'OTHERS' : (normalized || 'penalty');
}

function normalizePenaltySlipReason(type, reason) {
  if (String(type || '').trim() === 'penalty') return 'OTHERS';
  return normalizePenaltyFlowReason(reason);
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
ตู้เย็น 250 บาท/เดือน`,
    ROOM_RENT: `[ค่าเช่า]
• Standard (เฟอร์ครบ): 4,000 บ./ด.
• Corner Plus (เฟอร์ครบ): 4,500 บ./ด.
• Starter (ไม่มีเฟอร์): 3,800 บ./ด.`,
    ROOM_UTIL: `[ค่าน้ำ-ไฟ/เน็ต]
น้ำ 18 | ไฟ 8 
🛜เน็ต: ฟรี`,
    ROOM_RENT_IMG: `[เรทราคา + ภาพ]`,   // 👈 new entry
    ROOM_DEPOSIT: `[เงินประกัน/สัญญา]
สัญญาเช่า 1 ปี`,
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
      '• มอเตอร์ไซค์รับจ้าง ~15 นาที (ประมาณ 60 บาท, ขึ้นคิวหน้าหอหรือปากซอย)',
      '• รถสองแถวสีแดงเส้นลาดกระบัง — ลงหน้ามหาวิทยาลัย',
      '• รถเมล์สาย 552 (ปรับอากาศ) ขึ้นริมถนนฉลองกรุง',
      '',
      'Tip: ช่วงเร่งด่วนควรเผื่อเวลาเล็กน้อยก่อนเข้าเรียน',
      '',
      `🔗 คู่มือการเดินทางเพิ่มเติม: ${KMITL_TRAVEL_GUIDE_URL}`
    ].join('\n');
    return [{ type: 'text', text: kmitlText }];
  }

  if (key === 'RES_CONTACT_BIKE') {
    const motoText = [
      '🛵 เบอร์พี่วินมอเตอร์ไซค์ (หน้าปากซอย) สะดวก รวดเร็ว โทรเรียกเข้ามารับที่ตึกได้เลยครับ',
      '💸 ไป KMITL โดยทั่วไปประมาณ 60 บาท',
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

function getReturnKeyDecisionWebhookUrl(env) {
  return env.N8N_RETURN_KEY_DECISION_WEBHOOK_URL || DEFAULT_N8N_RETURN_KEY_DECISION_WEBHOOK_URL;
}

function isReturnKeyDecisionAction(action) {
  const a = String(action || '').trim().toLowerCase();
  if (!a) return false;
  if (!(a.includes('decision') || a.includes('desicion') || a.includes('approve') || a.includes('reject'))) {
    return false;
  }
  if (a.includes('return_key') || a.includes('returnkey') || a.includes('key_return')) {
    return true;
  }
  return false;
}

function normalizeReturnKeyDecision(data) {
  const rawDecision = String(
    data?.decision || data?.status || data?.result || data?.choice || data?.answer || data?.ans || ''
  ).trim();
  const rawItem = String(
    data?.item || data?.option || data?.selection || data?.selectedItem || data?.assetType || ''
  ).trim();
  const merged = `${rawDecision}|${rawItem}`.toLowerCase().replace(/\s+/g, '');

  if (/all|both|ทั้งหมด|คืนทั้งหมด/.test(merged)) return 'all';
  if (/keycard_only|keycardonly|คีย์การ์ด/.test(merged)) return 'keycard_only';
  if (/key_only|keyonly|กุญแจ/.test(merged)) return 'key_only';

  return rawDecision || rawItem || '';
}

function hasReturnKeyDecisionHints(data, rawPostback = '') {
  const pick = (...keys) => {
    for (const key of keys) {
      const val = String(data?.[key] || '').trim();
      if (val) return val;
    }
    return '';
  };

  const action = String(
    pick('act', 'action', 'type', 'eventType', 'postbackType', 'intent', 'scope')
  ).toLowerCase();
  const decision = String(
    pick('decision', 'status', 'result', 'choice', 'answer', 'ans')
  ).toLowerCase();
  const marker = String(
    pick('flow', 'module', 'topic', 'channel', 'context', 'feature', 'kind')
  ).toLowerCase();
  const raw = String(rawPostback || '').toLowerCase();
  const flat = `${action}|${decision}|${marker}|${raw}`;

  const hasDecisionWord =
    /(approve|approved|reject|rejected|decision|desicion|yes|no|y|n|ok|deny|decline|accept|pass|fail|key_only|keycard_only|all|both|อนุมัติ|ปฏิเสธ|คืนทั้งหมด)/i.test(flat);
  const hasReturnKeyWord =
    /(return[_\s-]*key|key[_\s-]*return|คืนกุญแจ|คืนคีย์การ์ด|กุญแจ|rented[_\s-]*key|rent[_\s-]*key)/i.test(flat);

  return hasDecisionWord && hasReturnKeyWord;
}

async function notifyN8nReturnKeyDecision(env, payload) {
  const url = getReturnKeyDecisionWebhookUrl(env);
  if (!url) {
    console.warn('notifyN8nReturnKeyDecision: missing webhook URL');
    return false;
  }

  const headers = { 'Content-Type': 'application/json' };
  const secret = String(env.WORKER_SECRET || env.MM_WORKER_SECRET || '').trim();
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
      console.error('notifyN8nReturnKeyDecision non-200', res.status, text.slice(0, 200));
    }
    return res.ok;
  } catch (err) {
    console.error('notifyN8nReturnKeyDecision error', err);
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

function parseQueryString(qs = '') {
  const raw = String(qs || '').trim();
  if (!raw) return {};
  const parsed = parseKv(raw.startsWith('?') ? raw.slice(1) : raw);
  const out = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!key) continue;
    out[key] = Array.isArray(value) ? String(value[value.length - 1] || '') : String(value ?? '');
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

function getBillManualPaymentStateKey(lineUserId) {
  const userId = String(lineUserId || '').trim();
  return userId ? `${BILL_MANUAL_PAYMENT_KEY_PREFIX}${userId}` : '';
}

function isBillManualPayClick(parsed) {
  return String(parsed?.action || '').trim() === BILL_MANUAL_PAY_CLICK_ACTION;
}

function buildBillManualPaymentState(event, parsed, postbackData, nowMs = Date.now()) {
  const source = event?.source || {};
  const lineUserId = String(source?.userId || '').trim();
  const clickedAt = new Date(nowMs).toISOString();
  return {
    source: 'LINE_WORKER',
    stateType: 'bill_manual_payment',
    action: BILL_MANUAL_PAY_CLICK_ACTION,
    lineUserId,
    chatId: getChatId(event),
    sourceType: String(source?.type || ''),
    replyToken: String(event?.replyToken || ''),
    postbackData: String(postbackData || ''),
    billId: String(parsed?.billId || ''),
    room: String(parsed?.room || parsed?.roomId || ''),
    timestamp: event?.timestamp || nowMs,
    clickedAt,
    expiresAt: new Date(nowMs + BILL_MANUAL_PAYMENT_TTL_SECONDS * 1000).toISOString(),
    webhookEventId: String(event?.webhookEventId || '')
  };
}

function buildBillManualSlipPayload(event, state, receivedAt = new Date().toISOString()) {
  const source = event?.source || {};
  const message = event?.message || {};
  return {
    source: 'LINE_WORKER',
    eventType: 'image',
    action: 'BILL_SLIP_RECEIVED',
    lineUserId: String(source?.userId || ''),
    chatId: getChatId(event),
    sourceType: String(source?.type || ''),
    replyToken: String(event?.replyToken || ''),
    imageMessageId: String(message?.id || ''),
    timestamp: event?.timestamp || Date.now(),
    receivedAt,
    billId: String(state?.billId || ''),
    room: String(state?.room || ''),
    clickedAt: String(state?.clickedAt || ''),
    expiresAt: String(state?.expiresAt || ''),
    postbackData: String(state?.postbackData || ''),
    event,
    state
  };
}

async function getActiveBillManualPaymentState(env, lineUserId) {
  const key = getBillManualPaymentStateKey(lineUserId);
  if (!key) return null;

  const state = await kvGet(env, key);
  if (!state) return null;

  const expiresAtMs = Date.parse(String(state?.expiresAt || ''));
  if (Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now()) {
    await kvDel(env, key);
    return null;
  }

  return state;
}

function buildCleaningBillingPostbackPayload(event, parsed, postbackData, receivedAt = new Date().toISOString()) {
  const source = event?.source || {};
  return {
    source: 'line_postback',
    intent: 'cleaning_billing',
    act: 'Billing',
    billingAction: String(parsed?.act || ''),
    requestId: String(parsed?.requestId || ''),
    roomId: String(parsed?.roomId || ''),
    price: String(parsed?.price || ''),
    tenantLineUserId: String(parsed?.tenantLineUserId || ''),
    cleaningSource: String(parsed?.source || ''),
    lineUserId: String(source?.userId || ''),
    chatId: getChatId(event),
    sourceType: String(source?.type || ''),
    replyToken: String(event?.replyToken || ''),
    postbackData: String(postbackData || ''),
    webhookEventId: String(event?.webhookEventId || ''),
    receivedAt
  };
}

function buildCleaningBillingAckText(parsed) {
  const roomId = String(parsed?.roomId || '').trim();
  const price = String(parsed?.price || '').trim();
  const details = [
    roomId ? `room ${roomId}` : '',
    price ? `${price} THB` : ''
  ].filter(Boolean).join(', ');
  return details
    ? `Cleaning price selected (${details}). Sending the tenant bill now.`
    : 'Cleaning price selected. Sending the tenant bill now.';
}

function buildCleaningPaymentMethodPostbackPayload(event, parsed, postbackData, receivedAt = new Date().toISOString()) {
  const source = event?.source || {};
  return {
    source: 'line_postback',
    intent: 'cleaning_payment_method',
    act: 'CleaningPaymentMethod',
    paymentAction: String(parsed?.act || ''),
    cleaningId: String(parsed?.cleaningId || ''),
    requestId: String(parsed?.requestId || ''),
    billId: String(parsed?.billId || ''),
    roomId: String(parsed?.roomId || ''),
    price: String(parsed?.price || ''),
    paymentMethod: String(parsed?.paymentMethod || ''),
    lineUserId: String(source?.userId || ''),
    chatId: getChatId(event),
    sourceType: String(source?.type || ''),
    replyToken: String(event?.replyToken || ''),
    postbackData: String(postbackData || ''),
    webhookEventId: String(event?.webhookEventId || ''),
    receivedAt
  };
}

function buildCleaningPaymentMethodAckText(parsed) {
  const method = String(parsed?.paymentMethod || '').trim();
  const roomId = String(parsed?.roomId || '').trim();
  const price = String(parsed?.price || '').trim();
  const details = [
    method ? `method ${method}` : '',
    roomId ? `room ${roomId}` : '',
    price ? `${price} THB` : ''
  ].filter(Boolean).join(', ');
  return details
    ? `Payment selection completed (${details}). Thank you.`
    : 'Payment selection completed. Thank you.';
}

function buildCleaningCashConfirmPostbackPayload(event, parsed, postbackData, receivedAt = new Date().toISOString()) {
  const source = event?.source || {};
  return {
    source: 'line_postback',
    intent: 'cleaning_cash_confirm',
    act: 'CleaningCashConfirm',
    cashAction: String(parsed?.act || ''),
    cleaningId: String(parsed?.cleaningId || ''),
    requestId: String(parsed?.requestId || ''),
    billId: String(parsed?.billId || ''),
    roomId: String(parsed?.roomId || ''),
    price: String(parsed?.price || ''),
    tenantLineUserId: String(parsed?.tenantLineUserId || ''),
    lineUserId: String(source?.userId || ''),
    chatId: getChatId(event),
    sourceType: String(source?.type || ''),
    replyToken: String(event?.replyToken || ''),
    postbackData: String(postbackData || ''),
    webhookEventId: String(event?.webhookEventId || ''),
    receivedAt
  };
}

function buildCleaningCashConfirmAckText(parsed) {
  const roomId = String(parsed?.roomId || '').trim();
  const price = String(parsed?.price || '').trim();
  const details = [
    roomId ? `room ${roomId}` : '',
    price ? `${price} THB` : ''
  ].filter(Boolean).join(', ');
  return details
    ? `Cash payment confirmed (${details}). Sending confirmation now.`
    : 'Cash payment confirmed. Sending confirmation now.';
}

function normalizeManagerDecision(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (!normalized) return '';
  if (['APPROVE', 'APPROVED', 'YES', 'Y', 'ALLOW', 'OK'].includes(normalized)) return 'APPROVE';
  if (['REJECT', 'REJECTED', 'NO', 'N', 'DENY', 'DECLINE'].includes(normalized)) return 'REJECT';
  if (['HOLD', 'WAIT', 'PENDING', 'UNDECIDED'].includes(normalized)) return 'HOLD';
  return normalized;
}

function buildMarkPaidForwardPayload(data, ev, receivedAt = new Date().toISOString()) {
  const originalData = (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
  const reservationId = String(
    originalData.resId ||
    originalData.reservationId ||
    originalData.ReservationID ||
    originalData.reservation_id ||
    originalData.code ||
    ''
  ).trim();
  const row = String(originalData.row || originalData.Row || originalData.rowNumber || '').trim();
  const compatibleData = { ...originalData };

  if (reservationId) {
    compatibleData.resId = compatibleData.resId || reservationId;
    compatibleData.reservationId = compatibleData.reservationId || reservationId;
    compatibleData.ReservationID = compatibleData.ReservationID || reservationId;
    compatibleData.code = compatibleData.code || reservationId;
  }
  if (row) {
    compatibleData.row = compatibleData.row || row;
  }

  const payload = {
    source: 'line_postback',
    channel: 'mark_paid',
    event: ev,
    data: compatibleData,
    receivedAt
  };

  if (reservationId) {
    payload.reservationId = reservationId;
    payload.ReservationID = reservationId;
    payload.code = reservationId;
  }
  if (row) {
    payload.row = row;
  }

  return payload;
}

const DEFAULT_N8N_PAY_REVIEW_ACCEPT_URL = 'https://n8n.srv1112305.hstgr.cloud/webhook/approve-review-queue';

function getPayReviewAcceptWebhookUrl(env) {
  return env.N8N_PAY_REVIEW_ACCEPT_URL || DEFAULT_N8N_PAY_REVIEW_ACCEPT_URL;
}

async function notifyN8nPayReviewAccept(env, payload) {
  const url = getPayReviewAcceptWebhookUrl(env);
  if (!url) {
    console.warn('notifyN8nPayReviewAccept: missing webhook URL');
    return { ok: false, status: 0, error: 'missing_webhook_url' };
  }

  const headers = { 'Content-Type': 'application/json' };
  const secret = env.WORKER_SECRET || env.MM_WORKER_SECRET || '';
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
      console.error('notifyN8nPayReviewAccept: non-200 response', {
        url,
        status: res.status,
        body: text.slice(0, 500),
        reviewId: payload?.reviewId || '',
        billId: payload?.billId || '',
        room: payload?.room || ''
      });
    } else {
      console.log('notifyN8nPayReviewAccept: accepted', {
        url,
        status: res.status,
        reviewId: payload?.reviewId || '',
        billId: payload?.billId || '',
        room: payload?.room || ''
      });
    }
    return { ok: res.ok, status: res.status, body: text };
  } catch (err) {
    const error = String(err?.message || err);
    console.error('notifyN8nPayReviewAccept error', {
      url,
      error,
      reviewId: payload?.reviewId || '',
      billId: payload?.billId || '',
      room: payload?.room || ''
    });
    return { ok: false, status: 0, error };
  }
}

function buildPayReviewAcceptForwardPayload(data, ev, postbackData = '', receivedAt = new Date().toISOString()) {
  const originalData = (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
  const source = ev?.source || {};
  const action = 'PAY_REVIEW_ACCEPT';
  const reviewId = String(originalData.reviewId || originalData.reviewID || originalData.review_id || '').trim();
  const billId = String(originalData.billId || originalData.billID || originalData.bill_id || '').trim();
  const room = String(originalData.room || originalData.roomId || originalData.roomID || '').trim();
  const lineUserId = String(originalData.lineUserId || originalData.userId || originalData.uid || '').trim();
  const clickedByUserId = String(source?.userId || '').trim();
  const compatibleData = { ...originalData };

  compatibleData.act = compatibleData.act || action;
  compatibleData.action = compatibleData.action || action;
  if (reviewId) compatibleData.reviewId = compatibleData.reviewId || reviewId;
  if (billId) compatibleData.billId = compatibleData.billId || billId;
  if (room) compatibleData.room = compatibleData.room || room;
  if (lineUserId) compatibleData.lineUserId = compatibleData.lineUserId || lineUserId;

  return {
    source: 'line_postback',
    channel: 'payment_review',
    intent: 'pay_review_accept',
    action,
    act: action,
    reviewId,
    billId,
    room,
    lineUserId,
    clickedByUserId,
    chatId: getChatId(ev),
    sourceType: String(source?.type || ''),
    groupId: String(source?.groupId || ''),
    roomId: String(source?.roomId || ''),
    postbackData: String(postbackData || ''),
    data: compatibleData,
    parsed: compatibleData,
    event: ev,
    events: [ev],
    receivedAt
  };
}

function buildRenewalPostbackMeta(data, ev, act = '') {
  const pickFirst = (value) => Array.isArray(value) ? value[0] : value;
  const normalize = (value) => {
    if (value === undefined || value === null) return '';
    return String(pickFirst(value) || '').trim();
  };

  const room = normalize(data.room || data.roomId || data.RoomID || data.roomID || data.r);
  const end = normalize(
    data.contractEnd ||
    data.ContractEndDateISO ||
    data.contractEndIso ||
    data.ContractEndDate ||
    data.end ||
    data.endDate ||
    data.checkout
  );
  const inq = normalize(
    data.inq ||
    data.inquiry ||
    data.inquiryId ||
    data.InquiryId ||
    data.InquiryID ||
    data.renewalId ||
    data.renewalRecordId
  );
  const leaseId = normalize(
    data.leaseId ||
    data.LeaseID ||
    data.leaseID ||
    data.lease ||
    data.contractLeaseId
  );
  const actionField = normalize(data.action || data.Action || data.ACTION);
  const actionFieldLower = actionField.toLowerCase();
  const actField = normalize(data.act || data.Act || data.ACT);
  const actFieldLower = actField.toLowerCase();
  const renewalActionFieldIsEventType =
    actionFieldLower === 'renewal_reply' ||
    actionFieldLower === 'renewal_followup' ||
    actionFieldLower === 'renewal_admin' ||
    actFieldLower === 'renewal_reply' ||
    actFieldLower === 'renewal_followup' ||
    actFieldLower === 'renewal_admin';
  const renewalEventType = normalize(
    data.eventType ||
    data.postbackType ||
    (renewalActionFieldIsEventType ? (actionField || actField) : '')
  ).toLowerCase();
  const isRenewalPipeEvent =
    renewalEventType === 'renewal_reply' ||
    renewalEventType === 'renewal_followup';
  const isRenewalAdminEvent = renewalEventType === 'renewal_admin';
  const isManagerDecisionEvent =
    actionFieldLower === 'manager_renewal_decision' ||
    actFieldLower === 'manager_renewal_decision' ||
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
        (isRenewalAliasPayload ? (renewalAnswer || actField) : actField)
      )
  );
  const action = normalizeRenewalAction(actionRaw);
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
      action === 'RENEWAL_SIGN_SLOT_CONFIRM' ||
      action === 'RENEWAL_SIGN_SLOT_CHANGE' ||
      action === 'RENEWAL_ADMIN_PICK_SIGNING' ||
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
    leaseId,
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
      text: 'รบกวนสอบถามได้ไหมครับว่าตอนนี้ทำอาชีพอะไรอยู่ และต้องการเข้าอยู่เมื่อไหร่',
      quickReply: {
        items: [
          mk('นักศึกษา', 'status', 'STUDENT'),
          mk('พนักงานโรงงาน', 'status', 'FACTORY'),
          mk('พนักงานออฟฟิศ', 'status', 'OFFICE'),
          mk('อื่น ๆ', 'status', 'OTHER')
        ]
      }
    };
  }
  if (step === 2) {
    return {
      type: 'text',
      text: 'ต้องการเข้าอยู่เมื่อไหร่ครับ?',
      quickReply: {
        items: [
          mk('ภายใน 7 วัน', 'movein', 'IN7'),
          mk('ภายในเดือนนี้', 'movein', 'IN30'),
          {
            type: 'action',
            action: {
              type: 'datetimepicker',
              label: 'เลือกวันที่',
              data: 'act=LEAD_A&q=movein&v=DATE',
              mode: 'date'
            }
          },
          mk('ยังไม่แน่ใจ', 'movein', 'UNSURE')
        ]
      }
    };
  }
  return null;
}

function normalizeLeadAnswer(q, value, postbackParams = {}) {
  const answerKey = String(q || '').trim();
  const rawValue = String(value || '').trim();
  if (answerKey === 'movein' && rawValue === 'DATE') {
    const selectedDate = String(postbackParams?.date || '').trim();
    return selectedDate ? `DATE:${selectedDate}` : '';
  }
  return rawValue;
}

function getPrebookUrl(env) {
  const explicit = String(env?.PREBOOK_URL || '').trim();
  if (explicit) return explicit;

  const bookingUrl = String(env?.BOOKING_URL || '').trim();
  if (bookingUrl) {
    try {
      const url = new URL(bookingUrl);
      url.hash = '';
      url.search = '';
      url.pathname = '/prebook.html';
      return url.toString();
    } catch (_) {
      // ignore and use fallback
    }
  }

  return 'https://mm-v2.pages.dev/prebook.html';
}

function buildPrebookPromptMessages(env, reason = 'prebook') {
  const prebookUrl = getPrebookUrl(env);
  const introText = reason === 'availability'
    ? 'ตอนนี้ห้องเต็มแต่มีคนออกเรื่อยๆ คุณลูกค้าสนใจลงชื่อไว้ไหมครับ ถ้าห้องว่างเราจะติดต่อกลับครับ (เราจะติดต่อ ตามคิว ลงก่อน ได้ก่อน)'
    : 'ตอนนี้ห้องเต็มแต่มีคนออกเรื่อยๆ คุณลูกค้าสนใจลงชื่อไว้ไหมครับ ถ้าห้องว่างเราจะติดต่อกลับครับ (เราจะติดต่อ ตามคิว ลงก่อน ได้ก่อน)';

  return [
    {
      type: 'text',
      text: [
        introText,
        `กรอกแบบฟอร์มได้ที่: ${prebookUrl}`,
        '',
        'หลังส่งฟอร์ม ระบบจะออกรหัส #PBxxx',
        'จากนั้นกดปุ่มส่งรหัสกลับเข้า LINE เพื่อให้ทีมงานค้นหาและติดต่อคุณได้เร็วขึ้น'
      ].join('\n'),
      quickReply: {
        items: [
          {
            type: 'action',
            action: {
              type: 'uri',
              label: 'ฝากข้อมูลรับห้องว่าง',
              uri: prebookUrl
            }
          }
        ]
      }
    }
  ];
}

function buildRoomRentQuickReply() {
  return {
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
}

async function quickKeywordReply(text, env, userId) {
  const normalized = (text || '').trim();
  if (!normalized) return null;

  if (isRoomVisitIntent(normalized)) {
    return [{ type: 'text', text: ROOM_VISIT_REPLY_TEXT }];
  }
  if (isKmitlTravelGuideIntent(normalized)) {
    return resDetailByKey('RES_COMMUTE_KMITL');
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
      }
    ];
  }

  const isAvailabilityExcluded =
    AVAILABILITY_EXCLUDE_KEYWORDS.some((kw) => normalized.includes(kw)) ||
    AVAILABILITY_EXCLUDE_REGEXES.some((re) => re.test(normalized) || re.test(lower));
  const isAvailabilityAsk = AVAILABILITY_REGEXES.some((re) => re.test(normalized));
  const isRoomRentAsk = isRoomRentInquiry(normalized);
  if (isAvailabilityAsk && isRoomRentAsk) {
    return [
      {
        type: 'text',
        text: roomDetailByKey('ROOM_RENT'),
        quickReply: buildRoomRentQuickReply()
      },
      ...buildPrebookPromptMessages(env, 'availability')
    ];
  }

  if (isAvailabilityAsk && !isAvailabilityExcluded) {
    return buildPrebookPromptMessages(env, 'availability');
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

  const utilityReplyQuickActions = buildRoomRentQuickReply();

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

  const asksCommonFee =
    normalized.includes('ค่าส่วนกลาง') ||
    normalized.includes('ส่วนกลาง') ||
    normalized.includes('มีค่าส่วนกลาง') ||
    normalized.includes('ค่าส่วนกลางไหม') ||
    normalized.includes('ค่าส่วนกลางมั้ย');
  if (asksCommonFee) {
    return [{ type: 'text', text: 'ค่าส่วนกลาง 200 บาท/เดือนค่ะ' }];
  }

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
    return [
      {
        type: 'text',
        text: 'รบกวนสอบถามได้ไหมครับว่าตอนนี้ทำอาชีพอะไรอยู่ และต้องการเข้าอยู่เมื่อไหร่'
      }
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
  const itemCard = ({ title, description, text, stripeColor, badgeText, badgeBackground, badgeColor, ctaColor }) => ({
    type: 'box',
    layout: 'horizontal',
    spacing: 'none',
    cornerRadius: '10px',
    backgroundColor: '#F1F5F9',
    borderWidth: '1px',
    borderColor: '#E2E8F0',
    margin: 'sm',
    action: { type: 'message', label: title, text },
    contents: [
      {
        type: 'box',
        layout: 'vertical',
        width: '5px',
        backgroundColor: stripeColor,
        cornerRadius: '10px',
        contents: []
      },
      {
        type: 'box',
        layout: 'vertical',
        spacing: 'xs',
        paddingAll: '10px',
        contents: [
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: title, weight: 'bold', size: 'lg', color: '#0F172A', flex: 5, wrap: true },
              {
                type: 'box',
                layout: 'vertical',
                backgroundColor: badgeBackground,
                cornerRadius: '16px',
                paddingStart: '10px',
                paddingEnd: '10px',
                paddingTop: '4px',
                paddingBottom: '4px',
                flex: 2,
                contents: [
                  { type: 'text', text: badgeText, align: 'center', size: 'sm', weight: 'bold', color: badgeColor }
                ]
              }
            ]
          },
          {
            type: 'text',
            text: description,
            wrap: true,
            size: 'md',
            color: '#64748B'
          },
          {
            type: 'text',
            text: 'แตะเพื่อเริ่ม',
            size: 'sm',
            weight: 'bold',
            color: ctaColor
          }
        ]
      }
    ]
  });
  const sectionBlock = (title, cards) => ({
    type: 'box',
    layout: 'vertical',
    spacing: 'xs',
    margin: 'md',
    contents: [
      { type: 'text', text: title, size: 'xl', weight: 'bold', color: '#1E293B' },
      ...cards.map((card) => itemCard(card))
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
                color: '#111827'
              },
              {
                type: 'text',
                text: 'แตะเลือกรายการให้ตรงกับบิล เพื่อลดการส่งผิดประเภท',
                wrap: true,
                size: 'sm',
                color: '#64748B'
              }
            ]
          },
          sectionBlock(
            'ชำระบิลทั่วไป',
            [
              {
                title: 'ชำระค่าเช่าห้อง',
                description: 'ค่าเช่าห้องรายเดือน',
                text: 'ชำระค่าเช่า',
                stripeColor: '#0B63E5',
                badgeText: 'รายเดือน',
                badgeBackground: '#DBEAFE',
                badgeColor: '#0B63E5',
                ctaColor: '#0B63E5'
              },
              {
                title: 'ลืม/ทำกุญแจหาย',
                description: 'ค่าปรับกรณีลืมกุญแจ ลืมคีย์การ์ด หรือทำหาย',
                text: 'ชำระค่าลืมกุญแจ',
                stripeColor: '#DC2626',
                badgeText: 'ค่าปรับ',
                badgeBackground: '#FEE2E2',
                badgeColor: '#B91C1C',
                ctaColor: '#DC2626'
              }
            ]
          ),
          sectionBlock(
            'บริการเพิ่มเติม / เช่าเพิ่ม',
            [
              {
                title: 'จ่ายค่าทำความสะอาด',
                description: 'ค่าบริการทำความสะอาดห้อง 300-500 บาท',
                text: 'ชำระค่าทำความสะอาด',
                stripeColor: '#0CA54A',
                badgeText: 'บริการ',
                badgeBackground: '#D7F4E1',
                badgeColor: '#0CA54A',
                ctaColor: '#0CA54A'
              },
              {
                title: 'ชำระค่าเช่าที่จอดรถ',
                description: 'ค่าเช่าที่จอดรถรายเดือน',
                text: 'ชำระค่าเช่าที่จอดรถ',
                stripeColor: '#0CA54A',
                badgeText: 'ที่จอดรถ',
                badgeBackground: '#D7F4E1',
                badgeColor: '#0CA54A',
                ctaColor: '#0CA54A'
              },
              {
                title: 'เช่ากุญแจเพิ่ม',
                description: 'ต้องการกุญแจ คีย์การ์ด หรือชุดกุญแจเพิ่ม',
                text: 'เช่ากุญแจเพิ่ม',
                stripeColor: '#2563EB',
                badgeText: 'เช่าเพิ่ม',
                badgeBackground: '#DBEAFE',
                badgeColor: '#1D4ED8',
                ctaColor: '#2563EB'
              }
            ]
          )
        ]
      }
    }
  };
}

const PARKING_CUSTOMER_SEGMENTS = {
  outsider: { key: 'outsider', label: 'บุคคลภายนอก', pricePerMonth: 1000 }
};
const PARKING_OUTSIDER_PHONE_TTL_SECONDS = 2 * 60;
const PARKING_OUTSIDER_PHONE_STATE = 'WAITING_PARKING_OUTSIDER_PHONE';

function parkingOutsiderPhoneFlowKey(userId) {
  const id = String(userId || '').trim();
  return id ? `parking:outsider-phone:${id}` : '';
}

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

function buildParkingOutsiderPhoneState(options = {}) {
  return {
    state: PARKING_OUTSIDER_PHONE_STATE,
    type: 'parking',
    plan: 'parking',
    customerType: 'outsider',
    customerLabel: PARKING_CUSTOMER_SEGMENTS.outsider.label,
    pricePerMonth: PARKING_CUSTOMER_SEGMENTS.outsider.pricePerMonth,
    lineUserId: options.lineUserId || null,
    chatId: options.chatId || null,
    requestData: options.requestData || null,
    ts: Date.now()
  };
}

function normalizeParkingPhone(text) {
  const cleaned = String(text || '').trim().replace(/[^\d+]/g, '');
  if (!cleaned) return '';
  if (cleaned.startsWith('+')) {
    return `+${cleaned.slice(1).replace(/\+/g, '')}`;
  }
  return cleaned.replace(/\+/g, '');
}

function isValidParkingPhone(phone) {
  const normalized = normalizeParkingPhone(phone);
  return /^0\d{8,9}$/.test(normalized) || /^\+66\d{8,9}$/.test(normalized);
}

function buildParkingOutsiderPhonePayload(event, phone, flowState = {}, rawText = '') {
  const lineUserId = event?.source?.userId || flowState.lineUserId || null;
  const chatId = getChatId(event) || flowState.chatId || null;
  return {
    source: 'line_message',
    channel: 'parking',
    event,
    data: {
      act: 'parking_outsider_phone_received',
      type: 'parking',
      plan: 'parking',
      customerType: 'outsider',
      customerLabel: PARKING_CUSTOMER_SEGMENTS.outsider.label,
      pricePerMonth: PARKING_CUSTOMER_SEGMENTS.outsider.pricePerMonth,
      lineUserId,
      chatId,
      phone,
      rawPhoneText: rawText
    },
    receivedAt: new Date().toISOString()
  };
}

async function handleParkingOutsiderPhoneText(env, ctx, event, replyToken, textIn) {
  const userId = event?.source?.userId || '';
  const key = parkingOutsiderPhoneFlowKey(userId);
  if (!key) return false;

  const flowState = await kvGet(env, key);
  if (!flowState || flowState.state !== PARKING_OUTSIDER_PHONE_STATE) return false;

  const phone = normalizeParkingPhone(textIn);
  if (!isValidParkingPhone(phone)) {
    if (replyToken) {
      await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [
        { type: 'text', text: 'กรุณาส่งเบอร์โทรศัพท์ให้ถูกต้อง เช่น 0812345678 ภายใน 2 นาทีครับ' }
      ]).catch(console.error);
    }
    return true;
  }

  const parkingPayload = buildParkingOutsiderPhonePayload(event, phone, flowState, textIn);
  await kvDel(env, key);

  if (replyToken) {
    await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [
      { type: 'text', text: 'ได้รับเบอร์โทรศัพท์แล้วครับ เจ้าหน้าที่จะติดต่อกลับเพื่อตรวจสอบที่จอดรถให้ครับ' }
    ]).catch(console.error);
  }

  ctx.waitUntil(
    notifyN8nParking(env, parkingPayload).catch((err) => console.error('parking phone notify failed', err))
  );
  ctx.waitUntil(
    forwardToGas(env, { events: [event], parking: parkingPayload }).catch((err) => console.error('parking phone gas forward failed', err))
  );

  return true;
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

function getN8nCheckinKeycardPhotoWebhook(env) {
  return env.N8N_CHECKIN_KEYCARD_PHOTO_URL || DEFAULT_N8N_CHECKIN_KEYCARD_PHOTO_WEBHOOK_URL;
}

async function enrichCheckinKeycardPhotoPayload(env, payload) {
  const messageId = String(payload?.imageMessageId || payload?.event?.message?.id || '').trim();
  if (!messageId) {
    return payload;
  }

  try {
    const imageDataUrl = await fetchLineImageAsDataUrl(env.LINE_ACCESS_TOKEN, messageId);
    const match = /^data:([^;,]+);base64,/.exec(imageDataUrl);
    const imageContentType = match?.[1] || '';
    return {
      ...payload,
      imageMessageId: messageId,
      imageDataUrl,
      imageContentType,
      image: {
        messageId,
        contentType: imageContentType,
        dataUrlField: 'imageDataUrl'
      }
    };
  } catch (err) {
    const error = String(err?.message || err);
    console.error('checkin keycard image content fetch failed', { messageId, error });
    return {
      ...payload,
      imageMessageId: messageId,
      imageFetchError: error,
      image: {
        messageId,
        fetchError: error
      }
    };
  }
}

async function notifyCheckinKeycardPhotoStatus(env, chatId, status) {
  if (!chatId) return false;
  const room = status?.roomId ? `ห้อง ${status.roomId}` : 'ห้องที่ระบุ';
  const reason = String(status?.reason || '').trim();
  const detail = String(status?.detail || '').trim();
  const suffix = detail ? `\nรายละเอียด: ${detail.slice(0, 300)}` : '';

  if (status?.ok) {
    return safeLinePushText(
      env.LINE_ACCESS_TOKEN,
      chatId,
      `บันทึกรูปคีย์การ์ดแล้ว ✅ ${room}\nส่งรูปเข้า webhook แล้ว (${status.webhookStatus || 'accepted'})`,
      'checkin_keycard_status_push_failed'
    );
  }

  return safeLinePushText(
    env.LINE_ACCESS_TOKEN,
    chatId,
    `ส่งรูปคีย์การ์ดไม่สำเร็จ ⚠️ ${room}\nสาเหตุ: ${reason || 'unknown'}${suffix}\nกรุณาส่งรูปอีกครั้ง หรือเปิด n8n execution ล่าสุดเพื่อตรวจสอบ`,
    'checkin_keycard_failure_push_failed'
  );
}

async function handleCheckinKeycardPhotoForward(env, opts) {
  const state = opts?.state || {};
  const payload = opts?.payload || {};
  const chatId = opts?.chatId || '';
  const groupId = opts?.groupId || '';
  const managerUserId = opts?.managerUserId || '';
  const userKey = opts?.userKey || '';
  const groupKey = opts?.groupKey || '';
  const userOnlyKey = opts?.userOnlyKey || '';
  const roomId = payload?.roomId || state?.roomId || '';

  const result = await notifyN8nCheckinKeycardPhoto(env, payload);
  console.log('checkin_keycard_photo_forward_result', {
    roomId,
    flowId: payload?.flowId || '',
    ok: !!result?.ok,
    status: result?.status || 0,
    reason: result?.reason || '',
    hasImageData: !!result?.hasImageData,
    imageFetchError: result?.imageFetchError || ''
  });

  if (result?.ok) {
    if (userKey) await kvDel(env, userKey);
    if (groupKey) await kvDel(env, groupKey);
    if (userOnlyKey) await kvDel(env, userOnlyKey);
    forgetCheckinKeycardWaitingPhotoState(groupId, managerUserId);
    await notifyCheckinKeycardPhotoStatus(env, chatId, {
      ok: true,
      roomId,
      webhookStatus: result.status ? `HTTP ${result.status}` : 'accepted'
    });
    return true;
  }

  await kvPut(env, groupKey, { ...state, ts: Date.now(), lastError: result }, CHECKIN_KEYCARD_PHOTO_TTL_SECONDS);
  if (userKey) {
    await kvPut(env, userKey, { ...state, ts: Date.now(), lastError: result }, CHECKIN_KEYCARD_PHOTO_TTL_SECONDS);
  }
  if (userOnlyKey) {
    await kvPut(env, userOnlyKey, { ...state, ts: Date.now(), lastError: result }, CHECKIN_KEYCARD_PHOTO_TTL_SECONDS);
  }
  rememberCheckinKeycardWaitingPhotoState(groupId, managerUserId, { ...state, ts: Date.now(), lastError: result });

  const reasonParts = [
    result?.reason || 'webhook_failed',
    result?.imageFetchError ? `imageFetchError=${result.imageFetchError}` : '',
    result?.status ? `HTTP ${result.status}` : ''
  ].filter(Boolean);
  await notifyCheckinKeycardPhotoStatus(env, chatId, {
    ok: false,
    roomId,
    reason: reasonParts.join(', '),
    detail: result?.bodyPreview || result?.error || ''
  });
  return false;
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

async function notifyN8nCheckinKeycardPhoto(env, payload) {
  const url = getN8nCheckinKeycardPhotoWebhook(env);
  if (!url) {
    console.warn('notifyN8nCheckinKeycardPhoto: missing webhook URL');
    return { ok: false, reason: 'missing_webhook_url', status: 0 };
  }

  const headers = { 'Content-Type': 'application/json' };
  const secret = getWorkerForwardSecret(env);
  if (secret) {
    headers['x-worker-secret'] = secret;
  } else {
    console.warn('notifyN8nCheckinKeycardPhoto: missing WORKER_SECRET');
  }

  try {
    const enrichedPayload = await enrichCheckinKeycardPhotoPayload(env, payload);
    const body = JSON.stringify(enrichedPayload);
    console.log('notifyN8nCheckinKeycardPhoto send', {
      url,
      intent: enrichedPayload?.intent || '',
      flowId: enrichedPayload?.flowId || '',
      roomId: enrichedPayload?.roomId || '',
      hasImage: !!enrichedPayload?.imageMessageId,
      hasImageData: !!enrichedPayload?.imageDataUrl,
      imageContentType: enrichedPayload?.imageContentType || '',
      imageFetchError: enrichedPayload?.imageFetchError || ''
    });
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      console.error('notifyN8nCheckinKeycardPhoto: non-200 response', res.status, text.slice(0, 200));
    } else {
      console.log('notifyN8nCheckinKeycardPhoto ok', { status: res.status, text: text.slice(0, 200) });
    }
    return {
      ok: res.ok,
      reason: res.ok ? '' : 'webhook_non_200',
      status: res.status,
      bodyPreview: text.slice(0, 300),
      hasImageData: !!enrichedPayload?.imageDataUrl,
      imageFetchError: enrichedPayload?.imageFetchError || ''
    };
  } catch (err) {
    console.error('notifyN8nCheckinKeycardPhoto error', err);
    return {
      ok: false,
      reason: 'webhook_fetch_error',
      status: 0,
      error: String(err?.message || err)
    };
  }
}

function getCheckoutWebhook(env) {
  return env.N8N_CHECKOUT_START_WEBHOOK || env.N8N_CHECKOUT_FLOW_URL || DEFAULT_N8N_CHECKOUT_START_WEBHOOK;
}

function getReturnKeyWebhook(env) {
  return env.N8N_RETURN_KEY_WEBHOOK_URL || DEFAULT_N8N_RETURN_KEY_WEBHOOK_URL;
}

async function notifyN8nReturnKey(env, payload) {
  const url = getReturnKeyWebhook(env);
  if (!url) throw new Error('missing return key webhook URL');

  const headers = { 'Content-Type': 'application/json', 'accept': 'application/json' };
  const secret = env.WORKER_SECRET || env.MM_WORKER_SECRET || '';
  if (secret) headers['x-mm-secret'] = secret;

  console.log('return_key_webhook_req', { url, roomId: payload?.roomId || '', hasSecret: !!secret });

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000)
  });
  const text = await res.text().catch(() => '');
  console.log('return_key_webhook_res', {
    status: res.status,
    ok: res.ok,
    bodyPreview: text.slice(0, 300)
  });

  if (!res.ok) {
    throw new Error(`return key webhook error ${res.status} ${text.slice(0, 200)}`);
  }
  return true;
}

async function handleReturnKeyStart(env, opts) {
  const roomId = (opts?.roomId || '').toUpperCase();
  const text = opts?.text || '';
  const ev = opts?.event || {};
  const replyToken = opts?.replyToken || '';
  const userId = ev?.source?.userId || '';
  const ts = ev?.timestamp || Date.now();
  const chatId = getChatId(ev);
  const targetChatId = chatId || getChatId(ev) || '';

  console.log('return_key_trigger', { roomId, text: text.slice(0, 80), userId });

  if (!isReturnKeyAllowedLineUserId(userId)) {
    const denyText = 'คำสั่งคืนกุญแจใช้ได้เฉพาะผู้ได้รับสิทธิ์เท่านั้น';
    if (replyToken) {
      await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [{ type: 'text', text: denyText }]).catch(console.error);
    } else if (targetChatId) {
      await linePushText(env.LINE_ACCESS_TOKEN, targetChatId, denyText).catch(console.error);
    }
    return true;
  }

  const ack = `รับคำขอคืนกุญแจห้อง ${roomId} แล้ว กำลังส่งให้เจ้าหน้าที่ตรวจสอบค่ะ`;
  if (replyToken) {
    try {
      await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [{ type: 'text', text: ack }]);
    } catch (e) {
      console.error('return_key_ack_fail', e);
      if (targetChatId) {
        try { await linePushText(env.LINE_ACCESS_TOKEN, targetChatId, ack); } catch (e2) { console.error('return_key_ack_push_fail', e2); }
      }
    }
  } else if (chatId) {
    try { await linePushText(env.LINE_ACCESS_TOKEN, chatId, ack); }
    catch (e3) { console.error('return_key_ack_push_fail', e3); }
  }

  try {
    const payload = {
      source: 'LINE_TEXT',
      intent: 'return_key',
      roomId,
      lineUserId: userId,
      chatId: targetChatId || null,
      text,
      timestamp: ts
    };
    await notifyN8nReturnKey(env, payload);
    const finalText = `✅ ส่งคำขอคืนกุญแจห้อง ${roomId} เรียบร้อยแล้ว`;
    if (targetChatId) {
      await linePushText(env.LINE_ACCESS_TOKEN, targetChatId, finalText).catch((err) => console.error('return_key_final_push_fail', err));
    } else if (replyToken) {
      await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [{ type: 'text', text: finalText }]).catch((err) => console.error('return_key_final_reply_fail', err));
    }
  } catch (err) {
    const errMsg = String(err && err.message ? err.message : err);
    console.error('return_key_start_failed', { roomId, err: errMsg });
    const failText = `ระบบมีปัญหา กรุณาลองใหม่ (return-key: ${errMsg.slice(0, 80)})`;
    if (targetChatId) {
      await linePushText(env.LINE_ACCESS_TOKEN, targetChatId, failText).catch(console.error);
    } else if (replyToken) {
      await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [{ type: 'text', text: failText }]).catch(console.error);
    }
  }

  return true;
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
    if (opts?.shortcutType) {
      payload.intent = 'co_admin_shortcut';
      payload.shortcutType = opts.shortcutType;
      payload.outcome = opts?.outcome || null;
      payload.command = opts?.command || '';
    }
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
  const secret = getWorkerForwardSecret(env);
  if (secret) {
    headers['x-worker-secret'] = secret;
  } else {
    console.warn('notifyN8nKeyForgotWebhook: missing worker forward secret');
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

function getPrebookWebhookUrl(env) {
  return env.N8N_PREBOOK_WEBHOOK_URL || DEFAULT_N8N_PREBOOK_WEBHOOK_URL;
}

async function notifyN8nPrebookWebhook(env, payload) {
  const url = getPrebookWebhookUrl(env);
  if (!url) {
    console.warn('notifyN8nPrebookWebhook: missing webhook URL');
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
      console.error('notifyN8nPrebookWebhook: non-200 response', res.status, text.slice(0, 200));
    }
    return res.ok;
  } catch (err) {
    console.error('notifyN8nPrebookWebhook error', err);
    return false;
  }
}

function getPenaltyWebhook(env) {
  return env.PENALTY_WEBHOOK_URL || '';
}

const PENALTY_WEBHOOK_TIMEOUT_MS = 10 * 1000;

const DEFAULT_N8N_CHECKOUT_CASH2_WEBHOOK_URL = 'https://n8n.srv1112305.hstgr.cloud/webhook/co-admin-cash-receiver';

function getCheckoutCashWebhook(env, payload = {}) {
  const action = String(payload?.action || payload?.act || '').trim().toUpperCase();
  if (action === CHECKOUT_CASH2_ACTION) {
    return env.N8N_CHECKOUT_CASH2_WEBHOOK_URL || DEFAULT_N8N_CHECKOUT_CASH2_WEBHOOK_URL;
  }
  return env.N8N_CHECKOUT_CASH_WEBHOOK_URL || env.N8N_CHECKOUT_CASH_PAYMENT_WEBHOOK_URL || env.PENALTY_WEBHOOK_URL || '';
}

const DEFAULT_WARN_PAYMENT_WEBHOOK_URL = 'https://n8n.srv1112305.hstgr.cloud/webhook/warn-payment';

function getWarnPaymentWebhook(env) {
  return env.N8N_WARN_PAYMENT_WEBHOOK_URL || DEFAULT_WARN_PAYMENT_WEBHOOK_URL;
}

async function Penalty_webhook(env, payload, options = {}) {
  const target = String(options?.target || '').trim();
  const url = target === 'warn_payment'
    ? getWarnPaymentWebhook(env)
    : getPenaltyWebhook(env);
  if (!url) {
    console.warn('Penalty_webhook: missing webhook URL');
    return false;
  }

  const headers = { 'Content-Type': 'application/json' };
  const secret = getWorkerForwardSecret(env);
  if (secret) {
    headers['x-worker-secret'] = secret;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort('penalty_webhook_timeout'), PENALTY_WEBHOOK_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      console.error('Penalty_webhook: non-200 response', res.status, text.slice(0, 200));
    }
    return res.ok;
  } catch (err) {
    console.error('Penalty_webhook error', err);
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function notifyN8nCheckoutCash(env, payload) {
  const url = getCheckoutCashWebhook(env, payload);
  if (!url) {
    console.warn('notifyN8nCheckoutCash: missing webhook URL');
    return false;
  }

  const headers = { 'Content-Type': 'application/json' };
  const secret = env.WORKER_SECRET || env.MM_WORKER_SECRET || '';
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
      console.error('notifyN8nCheckoutCash: non-200 response', res.status, text.slice(0, 200));
    }
    return res.ok;
  } catch (err) {
    console.error('notifyN8nCheckoutCash error', err);
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

async function notifyN8nCleaning(env, payload) {
  const url = env.N8N_CLEANING_WEBHOOK_URL || DEFAULT_N8N_CLEANING_WEBHOOK_URL;
  if (!url) {
    console.warn('notifyN8nCleaning: missing webhook URL');
    return false;
  }

  const headers = { 'Content-Type': 'application/json' };
  const secret = String(env.WORKER_SECRET || '').trim();
  if (!secret) {
    console.warn('notifyN8nCleaning: missing WORKER_SECRET');
    return false;
  }
  headers['x-worker-secret'] = secret;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      console.error('notifyN8nCleaning: non-200 response', res.status, text.slice(0, 200));
    }
    return res.ok;
  } catch (err) {
    console.error('notifyN8nCleaning error', err);
    return false;
  }
}

function getN8nBillManualWebhookUrl(env) {
  return env.N8N_BILL_MANUAL_WEBHOOK_URL || env.N8N_BILL_LINE_RECEIVER_URL || DEFAULT_N8N_BILL_MANUAL_WEBHOOK_URL;
}

async function notifyN8nBillManual(env, payload) {
  const url = getN8nBillManualWebhookUrl(env);
  if (!url) {
    console.warn('notifyN8nBillManual: missing webhook URL');
    return false;
  }

  const headers = { 'Content-Type': 'application/json' };
  const secret = String(env.N8N_RECEIVER_SECRET || env.WORKER_SECRET || env.MM_WORKER_SECRET || '').trim();
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
      console.error('notifyN8nBillManual: non-200 response', res.status, text.slice(0, 200));
    }
    return res.ok;
  } catch (err) {
    console.error('notifyN8nBillManual error', err);
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

async function notifyN8nChatLog(env, payload) {
  const url = env.N8N_CHAT_LOG_URL || 'https://n8n.srv1112305.hstgr.cloud/webhook/MM_LOG';
  if (!url) {
    console.warn('notifyN8nChatLog: missing webhook URL');
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
      console.error('notifyN8nChatLog: non-200 response', res.status, text.slice(0, 200));
    }
    return res.ok;
  } catch (err) {
    console.error('notifyN8nChatLog error', err);
    return false;
  }
}

export const __testables = {
  parseQueryString,
  parsePostbackData,
  buildCleaningBillingPostbackPayload,
  buildCleaningBillingAckText,
  buildCleaningPaymentMethodPostbackPayload,
  buildCleaningPaymentMethodAckText,
  buildCleaningCashConfirmPostbackPayload,
  buildCleaningCashConfirmAckText,
  BILL_MANUAL_PAYMENT_TTL_SECONDS,
  getBillManualPaymentStateKey,
  isBillManualPayClick,
  buildBillManualPaymentState,
  buildBillManualSlipPayload,
  getN8nBillManualWebhookUrl,
  parseKeyRent,
  parseKeyKeyword,
  normalizeCommandText,
  parseBookingCodeCommand,
  withCanonicalTextEvent,
  forwardToSpecificGas,
  forwardToGas,
  classifyTextCommand,
  shouldTextStateConsumeInput,
  TEXT_COMMAND_REPLACE_FLOW,
  TEXT_COMMAND_BYPASS_FLOW,
  TEXT_STATE_CHECKOUT_AMOUNT,
  TEXT_STATE_CHECKOUT_IMAGE,
  TEXT_STATE_PARKING_PHONE,
  TEXT_STATE_REGISTRATION_ROOM,
  TEXT_STATE_TENANT_CHANGE_ROOM,
  TEXT_STATE_PENALTY_REASON,
  TEXT_STATE_PAYMENT_IMAGE,
  parseCheckinCommand,
  isCheckinFlowStateActive,
  ACTIVE_FLOW_CONTRACT_VERSION,
  BOOKING_PAYMENT_FLOW_TTL_SECONDS,
  getReservationFlowTtlSecondsByPhase,
  setActiveFlow,
  getActiveFlow,
  updateActiveFlowIfCurrent,
  clearActiveFlowIfCurrent,
  isSameActiveFlow,
  buildReservationForwardPayload,
  getReservationFlowAck,
  syncReservationFlowFromGasAck,
  replaceWithReservationFlow,
  clearUserWorkflowStatesForEvent,
  clearUserWorkflowStatesForCheckin,
  isCheckout2PaymentPostback,
  buildCheckout2PaymentFlowState,
  getCheckout2GroupWaitingSlipKey,
  isCheckout2SlipFlow,
  isCheckoutTransferSlipFlow,
  selectPenaltyFlowForImage,
  parseCheckoutPaymentText,
  armCheckoutTransferSlipFlow,
  detectPresetOtherPaymentReason,
  isCheckoutCashPaymentPostback,
  buildCheckoutCashFlowState,
  parseCheckoutCashAmount,
  buildCheckoutCashAmountState,
  buildCheckoutCashImagePayload,
  getCheckoutCashWebhook,
  parseCleaningCommand,
  isCleaningManagementAllowedLineUserId,
  buildCleaningManagementAckText,
  buildCleaningTenantConfirmFlex,
  parseCoAdminShortcut,
  isCheckoutStartShortcut,
  requiresCoAdminShortcutPermission,
  isCoAdminAllowedLineUserId,
  getCheckoutWebhook,
  normalizeManagerDecision,
  buildRenewalPostbackMeta,
  isContinueTermReplyAction,
  getRenewalPostbackWebhookUrl,
  buildMarkPaidForwardPayload,
  getWorkerForwardSecret,
  getPayReviewAcceptWebhookUrl,
  buildPayReviewAcceptForwardPayload,
  getN8nPayRentUrl,
  PAY_RENT_SLIP_PROMPT,
  getPrebookWebhookUrl,
  getPenaltyWebhook,
  isRoomRentInquiry,
  quickKeywordReply,
  leadQuestion,
  normalizeLeadAnswer,
  isKeyRentWaitingPhotoStateForUser,
  isCheckinKeycardWaitingPhotoStateForEvent,
  getCheckinKeycardWaitingPhotoState,
  handlePenaltyPaymentImage,
  normalizePenaltyReason,
  paymentReasonLabel,
  penaltyFlowPaymentLabel,
  getPaymentStateKeys,
  buildPaymentOptionsFlex,
  buildParkingPostbackPayload,
  PARKING_OUTSIDER_PHONE_TTL_SECONDS,
  PARKING_OUTSIDER_PHONE_STATE,
  parkingOutsiderPhoneFlowKey,
  buildParkingOutsiderPhoneState,
  normalizeParkingPhone,
  isValidParkingPhone,
  buildParkingOutsiderPhonePayload,
  normalizePenaltyFlowReason,
  normalizePenaltySlipType,
  normalizePenaltySlipReason
};

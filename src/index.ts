
var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.ts
function isIsoDate(str) {
  return /^\d{4}-\d{2}-\d{2}$/.test(str);
}
__name(isIsoDate, "isIsoDate");
function getChatId(ev) {
  return ev?.source?.groupId || ev?.source?.roomId || ev?.source?.userId || "";
}
__name(getChatId, "getChatId");
function getStateKey(ev) {
  const chat = getChatId(ev) || "unknown";
  const uid = ev?.source?.userId || "anon";
  return `${chat}:${uid}`;
}
__name(getStateKey, "getStateKey");
function formatDateBangkok(date = /* @__PURE__ */ new Date()) {
  const inBkk = new Date(date.toLocaleString("en-US", { timeZone: "Asia/Bangkok" }));
  const y = inBkk.getFullYear();
  const m = String(inBkk.getMonth() + 1).padStart(2, "0");
  const d = String(inBkk.getDate()).padStart(2, "0");
  return `${d}/${m}/${y}`;
}
__name(formatDateBangkok, "formatDateBangkok");
var PHONE_RE = /^0\d{9}$/;
var maskPhone = /* @__PURE__ */ __name((p) => (p || "").replace(/^(\d{3})\d{4}(\d{3})$/, "$1\u2022\u2022\u2022\u2022$2"), "maskPhone");
var QUESTION_WORD_RE = /(ไหม|มั้ย|มั๊ย|หรือไม่|หรือเปล่า|รึเปล่า|ปะ|ป่ะ|\?)/i;
var PARKING_KEYWORD_RE = /(ที่จอด|ลานจอด|จอดรถ|ค่าจอด|โรงจอด|ซองจอด)/i;
var PARKING_INTENT_RE = /(บริการ|อยาก|ต้องการ|สนใจ|รายละเอียด|เช่า|ขอ|หา|สอบถาม|ข้อมูล|ราคา|กี่บาท|เท่าไหร่|ว่าง|เต็ม|เอารถมา|นำรถมา)/i;
var PARKING_AVAILABILITY_RE = /(มี|พอมี|เหลือ|ว่าง|เต็ม|มั้ย|ไหม)/i;
var URGENT_CONTACT_RE = /(ด่วน|ฉุกเฉิน|ช่วยด้วย|ไฟไหม้|ตำรวจ|ขโมย|urgent|emergency|help|sos|call|phone|เบอร์|แอดมิน|admin|manager|ผู้จัดการ|นิติ|เจ้าหน้าที่|staff|human)/i;
var FRIDGE_KEYWORD_RE = /(ตู้เย็น|fridge|refrigerator)/i;
var FRIDGE_INTENT_RE = /(บริการ|อยาก(?:ได้)?|ต้องการ|สนใจ|รายละเอียด|เช่า|ขอ|หา|สอบถาม|ข้อมูล|ราคา|มี|ให้)/i;
var UTILITY_THAI_KEYWORDS = [
  "\u0E04\u0E48\u0E32\u0E19\u0E49\u0E33",
  "\u0E04\u0E48\u0E32\u0E44\u0E1F",
  "\u0E04\u0E48\u0E32\u0E19\u0E49\u0E33-\u0E44\u0E1F",
  "\u0E04\u0E48\u0E32\u0E19\u0E49\u0E33\u0E04\u0E48\u0E32\u0E44\u0E1F",
  "\u0E04\u0E48\u0E32\u0E19\u0E49\u0E33\u0E44\u0E1F",
  "\u0E19\u0E49\u0E33\u0E44\u0E1F",
  "\u0E04\u0E48\u0E32\u0E44\u0E1F\u0E1F\u0E49\u0E32",
  "\u0E04\u0E48\u0E32\u0E19\u0E49\u0E33\u0E1B\u0E23\u0E30\u0E1B\u0E32"
];
var UTILITY_EN_KEYWORDS = [
  "utility bill",
  "utility fee",
  "utilities",
  "utility",
  "water bill",
  "electric bill",
  "electricity bill",
  "water & electric",
  "water/electric"
];
var CHECKIN_CHANGE_KEYWORDS = [
  "\u0E40\u0E1B\u0E25\u0E35\u0E48\u0E22\u0E19\u0E27\u0E31\u0E19\u0E40\u0E0A\u0E47\u0E04\u0E2D\u0E34\u0E19",
  "\u0E40\u0E1B\u0E25\u0E35\u0E48\u0E22\u0E19\u0E27\u0E31\u0E19\u0E17\u0E35\u0E48\u0E40\u0E0A\u0E47\u0E04\u0E2D\u0E34\u0E19",
  "\u0E40\u0E1B\u0E25\u0E35\u0E48\u0E22\u0E19\u0E27\u0E31\u0E19\u0E17\u0E35\u0E40\u0E0A\u0E47\u0E04\u0E2D\u0E34\u0E19",
  "\u0E40\u0E1B\u0E25\u0E35\u0E48\u0E22\u0E19\u0E27\u0E31\u0E19\u0E40\u0E0A\u0E04\u0E2D\u0E34\u0E19",
  "\u0E40\u0E1B\u0E25\u0E35\u0E48\u0E22\u0E19\u0E40\u0E27\u0E25\u0E32\u0E40\u0E0A\u0E47\u0E04\u0E2D\u0E34\u0E19",
  "\u0E40\u0E1B\u0E25\u0E35\u0E48\u0E22\u0E19\u0E40\u0E27\u0E25\u0E32\u0E40\u0E0A\u0E04\u0E2D\u0E34\u0E19",
  "changecheckindate",
  "changecheckintime"
];
var RESERVE_FLOW_WINDOW_MS = 2 * 60 * 60 * 1e3;
var AVAILABILITY_REGEXES = [
  /(ห้อง|ตึก)[\s\S]{0,10}(ยัง)?ว่าง/i,
  /(ยัง)?มีห้อง/i,
  /เหลือห้อง/i,
  /ห้องเต็มไหม/i,
  /เช็ค.*ห้อง/i,
  /ว่างวันไหน/i,
  /ห้อง(วันนี้|พรุ่งนี้)/i
];
var AVAILABILITY_EXCLUDE_KEYWORDS = [
  "\u0E2B\u0E49\u0E2D\u0E07\u0E01\u0E35\u0E48\u0E04\u0E37\u0E19",
  "\u0E23\u0E32\u0E04\u0E32",
  "\u0E40\u0E23\u0E17",
  "\u0E2B\u0E49\u0E2D\u0E07\u0E40\u0E14\u0E35\u0E48\u0E22\u0E27",
  "\u0E40\u0E15\u0E35\u0E22\u0E07\u0E04\u0E39\u0E48",
  "\u0E2A\u0E39\u0E17",
  "\u0E40\u0E0A\u0E47\u0E04\u0E2D\u0E34\u0E19",
  "\u0E40\u0E0A\u0E47\u0E04\u0E40\u0E2D\u0E32\u0E17\u0E4C",
  "\u0E08\u0E2D\u0E07\u0E40\u0E25\u0E22",
  "\u0E02\u0E2D\u0E40\u0E1A\u0E2D\u0E23\u0E4C\u0E08\u0E2D\u0E07"
];
var AVAILABILITY_EXCLUDE_REGEXES = [
  /room\s*available/i,
  /\bavailability\b/i,
  /book\s*room/i,
  /room\s*(tonight|tomorrow)/i
];
function isParkingIntent(text) {
  const normalized = (text || "").trim();
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
__name(isParkingIntent, "isParkingIntent");
function isFridgeIntent(text) {
  const normalized = (text || "").trim();
  if (!normalized) return false;
  if (/^\s*บริการ\s*ตู้เย็น\s*$/i.test(normalized)) return true;
  if (!FRIDGE_KEYWORD_RE.test(normalized)) return false;
  if (FRIDGE_INTENT_RE.test(normalized)) return true;
  return QUESTION_WORD_RE.test(normalized);
}
__name(isFridgeIntent, "isFridgeIntent");
function isUtilityInquiry(text) {
  const normalized = (text || "").trim();
  if (!normalized) return false;
  const lower = normalized.toLowerCase();
  const collapsed = lower.replace(/\s+/g, "");
  if (UTILITY_THAI_KEYWORDS.some((kw) => lower.includes(kw))) return true;
  const joinedThaiHints = ["\u0E04\u0E48\u0E32\u0E19\u0E49\u0E33\u0E04\u0E48\u0E32\u0E44\u0E1F", "\u0E04\u0E48\u0E32\u0E19\u0E49\u0E33\u0E44\u0E1F", "\u0E19\u0E49\u0E33\u0E04\u0E48\u0E32\u0E44\u0E1F", "\u0E19\u0E49\u0E33\u0E44\u0E1F"];
  if (joinedThaiHints.some((kw) => collapsed.includes(kw))) return true;
  if (UTILITY_EN_KEYWORDS.some((kw) => lower.includes(kw))) return true;
  const englishPair = lower.includes("water") && (lower.includes("electric") || lower.includes("electricity"));
  return englishPair;
}
__name(isUtilityInquiry, "isUtilityInquiry");
function isCheckinChangeIntent(text) {
  const normalized = (text || "").toLowerCase().replace(/\s+/g, "");
  if (!normalized) return false;
  return CHECKIN_CHANGE_KEYWORDS.some((keyword) => normalized.includes(keyword));
}
__name(isCheckinChangeIntent, "isCheckinChangeIntent");
function hasKV(env) {
  return !!(env && env.KV && typeof env.KV.get === "function");
}
__name(hasKV, "hasKV");
async function kvGet(env, k) {
  try {
    if (!hasKV(env)) return null;
    return await env.KV.get(k, "json");
  } catch (_) {
    return null;
  }
}
__name(kvGet, "kvGet");
async function kvPut(env, k, v) {
  try {
    if (!hasKV(env)) return;
    await env.KV.put(k, JSON.stringify(v), { expirationTtl: 7200 });
  } catch (_) {
  }
}
__name(kvPut, "kvPut");
async function kvDel(env, k) {
  try {
    if (!hasKV(env)) return;
    await env.KV.delete(k);
  } catch (_) {
  }
}
__name(kvDel, "kvDel");
async function lineStartLoading(token, chatId, seconds = 7) {
  if (!chatId) return;
  const secs = Math.max(5, Math.min(seconds, 60));
  await fetch("https://api.line.me/v2/bot/chat/loading/start", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
    body: JSON.stringify({ chatId, loadingSeconds: secs })
  }).catch(console.error);
}
__name(lineStartLoading, "lineStartLoading");
async function linePushText(channelToken, to, text) {
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${channelToken}`
    },
    body: JSON.stringify({
      to,
      // userId, groupId, or roomId
      messages: [{ type: "text", text }]
    })
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LINE push failed ${res.status} ${res.statusText}: ${body}`);
  }
}
__name(linePushText, "linePushText");
async function fetchWithRedirect(url, init, bodyString, maxRedirects = 3) {
  let currentUrl = url;
  let options = { ...init };
  if (bodyString !== void 0) {
    options.body = bodyString;
  }
  for (let i = 0; i <= maxRedirects; i += 1) {
    const res = await fetch(currentUrl, options);
    if (![301, 302, 303, 307, 308].includes(res.status)) {
      return res;
    }
    const location = res.headers.get("location");
    if (!location) {
      return res;
    }
    currentUrl = new URL(location, currentUrl).toString();
    options = { ...options };
    if (bodyString !== void 0) {
      options.body = bodyString;
    }
  }
  return fetch(currentUrl, options);
}
__name(fetchWithRedirect, "fetchWithRedirect");
function getWebhookGas(env) {
  return env.MM_WEBHOOK_URL || env.MM_GAS_WEBHOOK_URL || env.APPS_SCRIPT_URL || "";
}
__name(getWebhookGas, "getWebhookGas");
function getMoveoutGas(env) {
  return env.MOVEOUT_GAS_URL || "";
}
__name(getMoveoutGas, "getMoveoutGas");
function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Vary": "Origin"
  };
}
__name(corsHeaders, "corsHeaders");
function getPayRentGas(env) {
  return env.PAYRENT_GAS_URL || "";
}
__name(getPayRentGas, "getPayRentGas");
function getAutoImgGas(env) {
  return env.AUTO_IMG_URL || env.AUTO_IMG_GAS_URL || env.SLIP_SCAN_GAS_URL || env.SLIPSCAN_GAS_URL || env.SLIP_SCAN_URL || "";
}
__name(getAutoImgGas, "getAutoImgGas");
async function forwardToSpecificGas(env, gasUrl, body) {
  const secret = env.WORKER_SECRET || "";
  const payload = { ...body, workerSecret: secret };
  if (!gasUrl || !secret) {
    console.error("forwardToSpecificGas: missing config", { hasUrl: !!gasUrl, hasSecret: !!secret });
    return false;
  }
  let ok = false, status = 0, text = "";
  try {
    const bodyString = JSON.stringify(payload);
    const res = await fetchWithRedirect(gasUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Worker-Secret": secret
      },
      body: bodyString
    }, bodyString);
    status = res.status;
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (ct.includes("application/json")) {
      const j = await res.json().catch(() => ({}));
      ok = !!j.ok || res.ok;
      text = JSON.stringify(j);
    } else {
      text = await res.text();
      ok = res.ok && text.trim() === "OK";
    }
  } catch (e) {
    console.error("forwardToSpecificGas error", String(e));
  }
  console.log("forwardToSpecificGas result", { url: new URL(gasUrl).host, status, ok, text: ("" + text).slice(0, 200) });
  return ok;
}
__name(forwardToSpecificGas, "forwardToSpecificGas");
async function forwardToGas(env, body) {
  const gasUrl = getWebhookGas(env);
  const secret = env.WORKER_SECRET || "";
  const payload = { ...body, workerSecret: secret };
  if (!gasUrl || !secret) {
    console.error("forwardToGas: missing config", { hasUrl: !!gasUrl, hasSecret: !!secret });
    return false;
  }
  let ok = false, status = 0, text = "";
  try {
    const bodyString = JSON.stringify(payload);
    const res = await fetchWithRedirect(gasUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Worker-Secret": secret
        // header secret for forwarded LINE events
      },
      body: bodyString
    }, bodyString);
    status = res.status;
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (ct.includes("application/json")) {
      const j = await res.json().catch(() => ({}));
      ok = !!j.ok;
      text = JSON.stringify(j);
    } else {
      text = await res.text();
      ok = res.ok && text.trim() === "OK";
    }
  } catch (e) {
    console.error("forwardToGas fetch error", String(e));
  }
  console.log("forwardToGas result", { status, ok, text: ("" + text).slice(0, 200) });
  return ok;
}
__name(forwardToGas, "forwardToGas");
async function handleMoveoutPostback(env, event, data) {
  const chatId = getChatId(event);
  const replyToken = event?.replyToken || "";
  const stateKey = getStateKey(event);
  const send = /* @__PURE__ */ __name(async (messages) => {
    if (!replyToken) {
      console.error("NO_REPLYTOKEN moveout; skip push");
      return;
    }
    try {
      await lineReply(env.LINE_ACCESS_TOKEN, replyToken, messages);
    } catch (e) {
      console.error("LINE_REPLY_FAIL", String(e));
    }
  }, "send");
  if (data.act === "moveout_cancel") {
    try {
      await kvDel(env, stateKey + ":moveout_flow");
    } catch {
    }
    await send([{ type: "text", text: "\u0E22\u0E01\u0E40\u0E25\u0E34\u0E01\u0E02\u0E31\u0E49\u0E19\u0E15\u0E2D\u0E19\u0E41\u0E08\u0E49\u0E07\u0E2D\u0E2D\u0E01\u0E41\u0E25\u0E49\u0E27\u0E04\u0E48\u0E30" }]);
    return true;
  }
  if (data.act === "moveout_yes") {
    const flow = await kvGet(env, stateKey + ":moveout_flow");
    const room = String(flow?.room || "").toUpperCase().trim();
    const iso = String(flow?.dateISO || "").trim();
    const phone = String(flow?.phone || "").trim();
    if (!room || !isIsoDate(iso) || !PHONE_RE.test(phone)) {
      console.error("moveout_yes: invalid or missing KV state", { hasRoom: !!room, hasDate: isIsoDate(iso), hasPhone: PHONE_RE.test(phone) });
      await send([{ type: "text", text: "\u0E44\u0E21\u0E48\u0E2A\u0E32\u0E21\u0E32\u0E23\u0E16\u0E22\u0E37\u0E19\u0E22\u0E31\u0E19\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E44\u0E14\u0E49 \u0E01\u0E23\u0E38\u0E13\u0E32\u0E40\u0E23\u0E34\u0E48\u0E21\u0E02\u0E31\u0E49\u0E19\u0E15\u0E2D\u0E19\u0E43\u0E2B\u0E21\u0E48\u0E2D\u0E35\u0E01\u0E04\u0E23\u0E31\u0E49\u0E07\u0E04\u0E48\u0E30" }]);
      try {
        await kvDel(env, stateKey + ":moveout_flow");
      } catch {
      }
      return true;
    }
    await lineStartLoading(env.LINE_ACCESS_TOKEN, chatId, 15);
    const ok = await forwardToGas(env, { act: "moveout", roomId: room, dateISO: iso, phone, lineUserId: event?.source?.userId || "" });
    try {
      await kvDel(env, stateKey + ":moveout_flow");
    } catch {
    }
    const finalMsg = ok ? `\u2705 \u0E23\u0E31\u0E1A\u0E41\u0E08\u0E49\u0E07\u0E2D\u0E2D\u0E01\u0E41\u0E25\u0E49\u0E27
\u0E2B\u0E49\u0E2D\u0E07 ${room} \u0E08\u0E30\u0E27\u0E48\u0E32\u0E07\u0E15\u0E31\u0E49\u0E07\u0E41\u0E15\u0E48 ${iso.split("-").reverse().join("/")}
\u0E40\u0E1A\u0E2D\u0E23\u0E4C\u0E15\u0E34\u0E14\u0E15\u0E48\u0E2D: ${maskPhone(phone)}` : "\u2757\u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01\u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08 \u0E42\u0E1B\u0E23\u0E14\u0E25\u0E2D\u0E07\u0E43\u0E2B\u0E21\u0E48\u0E2B\u0E23\u0E37\u0E2D\u0E15\u0E34\u0E14\u0E15\u0E48\u0E2D\u0E1C\u0E39\u0E49\u0E14\u0E39\u0E41\u0E25\u0E04\u0E48\u0E30";
    await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [{ type: "text", text: finalMsg }]);
    return true;
  }
  return false;
}
__name(handleMoveoutPostback, "handleMoveoutPostback");
var index_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(env.ALLOWED_ORIGIN) });
    }
    if (url.pathname.startsWith("/api/moveout")) {
      const base = new URL(getMoveoutGas(env));
      const t = new URL(base);
      t.search = url.search;
      const ws = env.WORKER_SECRET || "";
      if (ws) t.searchParams.set("ws", ws);
      const init = { method: request.method, headers: {} };
      if (request.method !== "GET" && request.method !== "HEAD") {
        const raw = await request.text();
        let body = {};
        try {
          body = JSON.parse(raw || "{}");
        } catch (_) {
        }
        if (ws) body.workerSecret = ws;
        init.headers["Content-Type"] = "application/json";
        init.body = JSON.stringify(body);
      }
      const res = await fetch(t.toString(), init);
      const bodyText2 = await res.text();
      const ct = res.headers.get("content-type") || "application/json";
      return new Response(bodyText2, {
        status: res.status,
        headers: { ...corsHeaders(env.ALLOWED_ORIGIN), "Content-Type": ct }
      });
    }
    if (request.method !== "POST") return new Response("OK", { status: 200 });
    const bodyText = await request.text();
    const sig = request.headers.get("x-line-signature") || "";
    if (!await verifySig(bodyText, sig, env.LINE_CHANNEL_SECRET)) {
      return new Response("Unauthorized", { status: 401 });
    }
    const payload = JSON.parse(bodyText || "{}");
    const events = Array.isArray(payload.events) ? payload.events : [];
    if (events.length > 0 && env.N8N_POSTBACK_URL) {
      const firstEvent = events[0];
      if (firstEvent?.type === "postback" && firstEvent?.postback?.data) {
        let fridgePostback = null;
        try {
          fridgePostback = JSON.parse(firstEvent.postback.data);
        } catch (_) {
          fridgePostback = null;
        }
        if (fridgePostback?.type === "fridge" && fridgePostback?.action === "not_ready") {
          ctx.waitUntil(
            fetch(env.N8N_POSTBACK_URL, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(payload)
            }).catch((err) => console.error("forward fridge not_ready failed", err))
          );
        }
      }
    }
    for (const ev of events) {
      const replyToken = ev?.replyToken;
      if (ev.type === "postback") {
        const data = parsePostbackData(ev.postback?.data || "");
        if (data.act === "moveout_yes" || data.act === "moveout_cancel") {
          const handled = await handleMoveoutPostback(env, ev, data);
          if (handled) continue;
        }
        if (data.act === "mgr_approve" || data.act === "mgr_reject") {
          const txt = data.act === "mgr_approve" ? "\u0E23\u0E31\u0E1A\u0E17\u0E23\u0E32\u0E1A \u2713 \u0E01\u0E33\u0E25\u0E31\u0E07\u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01\u0E41\u0E25\u0E30\u0E41\u0E08\u0E49\u0E07\u0E1C\u0E39\u0E49\u0E08\u0E31\u0E14\u0E01\u0E32\u0E23\u2026" : "\u0E23\u0E31\u0E1A\u0E17\u0E23\u0E32\u0E1A \u2713 \u0E2A\u0E48\u0E07\u0E40\u0E02\u0E49\u0E32 Review Queue \u0E41\u0E25\u0E49\u0E27\u2026";
          ctx.waitUntil(lineReply(env.LINE_ACCESS_TOKEN, replyToken, [{ type: "text", text: txt }]).catch(console.error));
          ctx.waitUntil(forwardToGas(env, { events: [ev] }));
          continue;
        }
        if (data.act === "pay_rent") {
          ctx.waitUntil(forwardToGas(env, { events: [ev] }));
          continue;
        }
        if (data.act === "rent_cancel") {
          ctx.waitUntil(lineReply(env.LINE_ACCESS_TOKEN, replyToken, [
            { type: "text", text: "\u274C \u0E22\u0E01\u0E40\u0E25\u0E34\u0E01\u0E02\u0E31\u0E49\u0E19\u0E15\u0E2D\u0E19\u0E0A\u0E33\u0E23\u0E30\u0E04\u0E48\u0E32\u0E40\u0E0A\u0E48\u0E32\u0E41\u0E25\u0E49\u0E27\u0E04\u0E23\u0E31\u0E1A/\u0E04\u0E48\u0E30" }
          ]).catch(console.error));
          ctx.waitUntil(forwardToGas(env, { events: [ev] }));
          continue;
        }
        if (data.act === "fridge_rent_request") {
          const sanitizedData = {
            ...data,
            lineUserId: ev?.source?.userId || data.lineUserId || null,
            chatId: getChatId(ev) || data.chatId || null
          };
          const fridgePayload = {
            source: "line_postback",
            channel: "fridge",
            event: ev,
            data: sanitizedData,
            receivedAt: (/* @__PURE__ */ new Date()).toISOString()
          };
          ctx.waitUntil(
            notifyN8nFridge(env, fridgePayload).catch((err) => console.error("fridge notify failed", err))
          );
          if (replyToken) {
            await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [
              { type: "text", text: "\u0E23\u0E31\u0E1A\u0E04\u0E33\u0E02\u0E2D\u0E40\u0E0A\u0E48\u0E32\u0E15\u0E39\u0E49\u0E40\u0E22\u0E47\u0E19\u0E41\u0E25\u0E49\u0E27\u0E04\u0E48\u0E30 \u0E01\u0E33\u0E25\u0E31\u0E07\u0E41\u0E08\u0E49\u0E07\u0E40\u0E08\u0E49\u0E32\u0E2B\u0E19\u0E49\u0E32\u0E17\u0E35\u0E48\u0E15\u0E48\u0E2D\u0E43\u0E2B\u0E49\u0E17\u0E31\u0E19\u0E17\u0E35" }
            ]).catch(console.error);
          }
          continue;
        }
        if (data.act === "parking_rent_request") {
          const sanitizedParking = {
            ...data,
            type: "parking",
            plan: data.plan === "roofed" ? "roofed" : "open",
            lineUserId: ev?.source?.userId || data.lineUserId || null,
            chatId: getChatId(ev) || data.chatId || null
          };
          const parkingPayload = {
            source: "line_postback",
            channel: "parking",
            event: ev,
            data: sanitizedParking,
            receivedAt: (/* @__PURE__ */ new Date()).toISOString()
          };
          if (replyToken) {
            await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [
              { type: "text", text: "\u0E23\u0E31\u0E1A\u0E04\u0E33\u0E02\u0E2D\u0E17\u0E35\u0E48\u0E08\u0E2D\u0E14\u0E23\u0E16\u0E41\u0E25\u0E49\u0E27\u0E04\u0E23\u0E31\u0E1A \u0E01\u0E33\u0E25\u0E31\u0E07\u0E15\u0E23\u0E27\u0E08\u0E2A\u0E2D\u0E1A\u0E04\u0E27\u0E32\u0E21\u0E27\u0E48\u0E32\u0E07\u0E43\u0E2B\u0E49\u0E17\u0E31\u0E19\u0E17\u0E35" }
            ]).catch(console.error);
          }
          ctx.waitUntil(
            notifyN8nParking(env, parkingPayload).catch((err) => console.error("parking notify failed", err))
          );
          ctx.waitUntil(
            forwardToGas(env, { events: [ev], parking: parkingPayload })
          );
          continue;
        }
        if (isRoomAct(data.act)) {
          const text = roomDetailByKey(data.act);
          if (data.act === "ROOM_RENT_IMG") {
            const out = [
              { type: "text", text: text || "[\u0E23\u0E32\u0E04\u0E32 + \u0E20\u0E32\u0E1E]" },
              {
                type: "image",
                originalContentUrl: "https://drive.google.com/uc?export=view&id=1JhPEZkaGXMrpW3csld5UfzTkKpRXBiht",
                previewImageUrl: "https://drive.google.com/uc?export=view&id=1JhPEZkaGXMrpW3csld5UfzTkKpRXBiht"
              },
              {
                type: "image",
                originalContentUrl: "https://drive.google.com/uc?export=view&id=1tc4ru8gKYB22W3nmw72lgKi1u17V6S5r",
                previewImageUrl: "https://drive.google.com/uc?export=view&id=1tc4ru8gKYB22W3nmw72lgKi1u17V6S5r"
              },
              {
                type: "image",
                originalContentUrl: "https://drive.google.com/uc?export=view&id=1_Ic_e61aOaOdrcTtl9pJQoJSF1C8ch5o",
                previewImageUrl: "https://drive.google.com/uc?export=view&id=1_Ic_e61aOaOdrcTtl9pJQoJSF1C8ch5o"
              }
            ];
            ctx.waitUntil(
              lineReply(env.LINE_ACCESS_TOKEN, replyToken, out).catch(console.error)
            );
            continue;
          }
          ctx.waitUntil(
            lineReply(env.LINE_ACCESS_TOKEN, replyToken, [{ type: "text", text }]).catch(console.error)
          );
          continue;
        }
        if (isFixAct(data.act)) {
          const text = fixDetailByKey(data.act);
          ctx.waitUntil(lineReply(env.LINE_ACCESS_TOKEN, replyToken, [{ type: "text", text }]).catch(console.error));
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
        if (data.scope === "payrent" || ["pick_month", "quick_month", "upload", "status", "faq", "howto"].includes(data.act)) {
          const chatId = getChatId(ev);
          const rentUrl = getPayRentGas(env);
          try {
            await linePushText(env.LINE_ACCESS_TOKEN, chatId, "\u0E42\u0E1B\u0E23\u0E14\u0E23\u0E2D\u0E2A\u0E31\u0E01\u0E04\u0E23\u0E39\u0E48\u2026");
          } catch (e) {
            console.error("push wait msg failed", e);
          }
          try {
            await lineStartLoading(env.LINE_ACCESS_TOKEN, chatId, 6);
          } catch (e) {
            console.warn("lineStartLoading failed", e);
          }
          await forwardToSpecificGas(env, rentUrl, { events: [ev] });
          continue;
        }
        ctx.waitUntil(lineReply(env.LINE_ACCESS_TOKEN, replyToken, [
          { type: "text", text: "\u0E01\u0E33\u0E25\u0E31\u0E07\u0E15\u0E23\u0E27\u0E08\u0E2A\u0E2D\u0E1A\u2026" }
        ]).catch(console.error));
        ctx.waitUntil(forwardToGas(env, { events: [ev] }));
        continue;
      }
      if (ev.type === "message") {
        const m = ev.message || {};
        if (m.type === "text") {
          const textIn = (m.text || "").trim();
          const chatId = getChatId(ev);
          const stateKey = getStateKey(ev);
          const userId = ev?.source?.userId || "";
          const fridgeServiceKeyword = isFridgeIntent(textIn);
          const parkingServiceKeyword = isParkingIntent(textIn);
          const payRentKey = stateKey + ":payrent_flow";
          const payRentFlow = await kvGet(env, payRentKey);
          const payRentActive = !!(payRentFlow && payRentFlow.ts && Date.now() - payRentFlow.ts < 15 * 60 * 1e3);
          const reserveKey = stateKey + ":reserve_flow";
          const reserveFlow = await kvGet(env, reserveKey);
          const reserveActive = !!(reserveFlow && reserveFlow.ts && Date.now() - reserveFlow.ts < RESERVE_FLOW_WINDOW_MS);
          const forwardPayRent = /* @__PURE__ */ __name(() => {
            const rentUrl = getPayRentGas(env);
            if (rentUrl) return forwardToSpecificGas(env, rentUrl, { events: [ev] });
            console.warn("pay rent flow active but PAYRENT_GAS_URL missing, falling back to main GAS");
            return forwardToGas(env, { events: [ev] });
          }, "forwardPayRent");
          if (payRentActive) {
            ctx.waitUntil(kvPut(env, payRentKey, { ...payRentFlow, ts: Date.now(), chatId, userId }));
            ctx.waitUntil(forwardPayRent());
            continue;
          }
          if (/^\s*(แจ้งออก)\s*$/i.test(textIn)) {
            await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [
              { type: "text", text: "\u0E01\u0E33\u0E25\u0E31\u0E07\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E25\u0E34\u0E07\u0E01\u0E4C\u0E41\u0E08\u0E49\u0E07\u0E2D\u0E2D\u0E01\u0E43\u0E2B\u0E49\u0E04\u0E38\u0E13\u2026 \u0E01\u0E23\u0E38\u0E13\u0E32\u0E23\u0E2D\u0E2A\u0E31\u0E01\u0E04\u0E23\u0E39\u0E48" }
            ]).catch(console.error);
            await forwardToGas(env, { events: [ev] });
            continue;
          }
          const handled = await moveoutTextGate(env, stateKey, textIn, replyToken);
          if (handled) continue;
          if (/^\s*(ส่งสลิปค่าเช่า|ชำระค่าเช่า|จ่ายค่าเช่า|send\s*rent\s*slip|pay\s*rent)\s*$/i.test(textIn)) {
            if (chatId) {
              ctx.waitUntil(lineStartLoading(env.LINE_ACCESS_TOKEN, chatId, 7));
            }
            const notifyMsg = { type: "text", text: "\u0E01\u0E33\u0E25\u0E31\u0E07\u0E40\u0E1B\u0E34\u0E14\u0E02\u0E31\u0E49\u0E19\u0E15\u0E2D\u0E19\u0E0A\u0E33\u0E23\u0E30\u0E04\u0E48\u0E32\u0E40\u0E0A\u0E48\u0E32\u0E43\u0E2B\u0E49\u0E04\u0E48\u0E30 \u0E23\u0E2D\u0E2A\u0E31\u0E01\u0E04\u0E23\u0E39\u0E48\u2026" };
            if (replyToken) {
              await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [notifyMsg]).catch(console.error);
            } else if (chatId) {
              ctx.waitUntil(linePushText(env.LINE_ACCESS_TOKEN, chatId, notifyMsg.text).catch(console.error));
            }
            ctx.waitUntil(kvPut(env, payRentKey, { ts: Date.now(), chatId, userId }));
            ctx.waitUntil(forwardPayRent());
            continue;
          }
          if (fridgeServiceKeyword) {
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
              parkingButtonsMessage(
                buildParkingPostbackPayload("open", commonOptions),
                buildParkingPostbackPayload("roofed", commonOptions)
              )
            ];
            await lineReply(env.LINE_ACCESS_TOKEN, replyToken, replies).catch(console.error);
            continue;
          }
          const fast = quickKeywordReply(textIn, env);
          if (fast) {
            ctx.waitUntil(lineReply(env.LINE_ACCESS_TOKEN, replyToken, fast).catch(console.error));
            continue;
          }
          if (isCheckinChangeIntent(textIn)) {
            const notifyMsg = "\u0E01\u0E33\u0E25\u0E31\u0E07\u0E2A\u0E48\u0E07\u0E1B\u0E38\u0E48\u0E21\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E27\u0E31\u0E19\u2013\u0E40\u0E27\u0E25\u0E32\u0E40\u0E0A\u0E47\u0E04\u0E2D\u0E34\u0E19\u0E43\u0E2B\u0E49\u0E04\u0E48\u0E30 \u0E23\u0E2D\u0E2A\u0E31\u0E01\u0E04\u0E23\u0E39\u0E48\u2026";
            if (replyToken) {
              await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [
                { type: "text", text: notifyMsg }
              ]).catch(console.error);
            } else if (chatId) {
              ctx.waitUntil(linePushText(env.LINE_ACCESS_TOKEN, chatId, notifyMsg).catch(console.error));
            }
            ctx.waitUntil(forwardToGas(env, { events: [ev] }));
            continue;
          }
          const mappedAct = ROOM_LABEL_MAP[textIn] ? ROOM_LABEL_MAP[textIn] : FIX_LABEL_MAP[textIn] ? FIX_LABEL_MAP[textIn] : null;
          const bookingMatch = textIn.match(/#?\s*MM\d{3,}/i);
          if (bookingMatch) {
            const bookingCode = bookingMatch[0].replace(/#/g, "").replace(/\s+/g, "").toUpperCase();
            ctx.waitUntil(kvPut(env, reserveKey, { ts: Date.now(), chatId, userId, code: bookingCode }));
            const ack = { type: "text", text: "\u0E01\u0E33\u0E25\u0E31\u0E07\u0E15\u0E23\u0E27\u0E08\u0E2A\u0E2D\u0E1A\u0E23\u0E2B\u0E31\u0E2A\u0E08\u0E2D\u0E07\u2026" };
            if (replyToken) {
              ctx.waitUntil(lineReply(env.LINE_ACCESS_TOKEN, replyToken, [ack]).catch(console.error));
            } else if (chatId) {
              ctx.waitUntil(linePushText(env.LINE_ACCESS_TOKEN, chatId, ack.text).catch(console.error));
            }
            ctx.waitUntil(forwardToGas(env, { events: [ev] }));
            continue;
          }
          const looksLikeRoom = /^[A-Z]?\d{3,4}$/i.test(textIn);
          if (looksLikeRoom) {
            const key = stateKey + ":moveout_flow";
            const flow = await kvGet(env, key);
            if (flow && flow.step) {
              const h = await moveoutTextGate(env, stateKey, textIn, replyToken);
              if (h) continue;
            }
          }
          ctx.waitUntil(forwardToGas(env, { events: [ev] }));
          continue;
        }
        if (m.type === "image") {
          ctx.waitUntil(lineReply(env.LINE_ACCESS_TOKEN, replyToken, [
            { type: "text", text: "\u0E23\u0E31\u0E1A\u0E44\u0E1F\u0E25\u0E4C\u0E41\u0E25\u0E49\u0E27 \u0E01\u0E33\u0E25\u0E31\u0E07\u0E15\u0E23\u0E27\u0E08\u0E2A\u0E2D\u0E1A\u2026" }
          ]).catch(console.error));
          const autoImgUrl = getAutoImgGas(env);
          if (autoImgUrl) {
            ctx.waitUntil(forwardToSpecificGas(env, autoImgUrl, { events: [ev], source: "image_scan" }));
          }
          const stateKey = getStateKey(ev);
          const flow = await kvGet(env, stateKey + ":payrent_flow");
          const active = !!(flow && flow.ts && Date.now() - flow.ts < 15 * 60 * 1e3);
          const reserveFlow = await kvGet(env, stateKey + ":reserve_flow");
          const reserveActive = !!(reserveFlow && reserveFlow.ts && Date.now() - reserveFlow.ts < RESERVE_FLOW_WINDOW_MS);
          if (active) {
            const rentUrl = getPayRentGas(env);
            ctx.waitUntil(forwardToSpecificGas(env, rentUrl, { events: [ev] }));
            ctx.waitUntil(kvDel(env, stateKey + ":payrent_flow"));
          } else if (reserveActive) {
            ctx.waitUntil(kvPut(env, stateKey + ":reserve_flow", { ...reserveFlow, ts: Date.now(), chatId: getChatId(ev), userId: ev?.source?.userId || "" }));
            ctx.waitUntil(forwardToGas(env, {
              events: [ev],
              reservationFlow: true,
              reserve: {
                code: reserveFlow?.code || null,
                chatId: getChatId(ev) || null,
                userId: ev?.source?.userId || null
              }
            }));
          } else {
            ctx.waitUntil(forwardToGas(env, { events: [ev] }));
          }
          continue;
        }
      }
    }
    return new Response("OK", { status: 200 });
  }
};
var ROOM_LABEL_MAP = {
  "\u0E02\u0E19\u0E32\u0E14/\u0E40\u0E25\u0E22\u0E4C\u0E40\u0E2D\u0E32\u0E15\u0E4C": "ROOM_SIZE",
  "\u0E40\u0E1F\u0E2D\u0E23\u0E4C\u0E19\u0E34\u0E40\u0E08\u0E2D\u0E23\u0E4C": "ROOM_FURNITURE",
  "\u0E40\u0E04\u0E23\u0E37\u0E48\u0E2D\u0E07\u0E43\u0E0A\u0E49\u0E44\u0E1F\u0E1F\u0E49\u0E32": "ROOM_APPLIANCE",
  "\u0E04\u0E48\u0E32\u0E40\u0E0A\u0E48\u0E32": "ROOM_RENT",
  "\u0E04\u0E48\u0E32\u0E19\u0E49\u0E33-\u0E44\u0E1F/\u0E40\u0E19\u0E47\u0E15": "ROOM_UTIL",
  "\u0E40\u0E07\u0E34\u0E19\u0E1B\u0E23\u0E30\u0E01\u0E31\u0E19/\u0E2A\u0E31\u0E0D\u0E0D\u0E32": "ROOM_DEPOSIT",
  "\u0E17\u0E35\u0E48\u0E08\u0E2D\u0E14\u0E23\u0E16": "ROOM_PARKING",
  "\u0E40\u0E02\u0E49\u0E32\u0E2D\u0E22\u0E39\u0E48\u0E40\u0E23\u0E47\u0E27\u0E2A\u0E38\u0E14": "ROOM_EARLIEST"
};
var FIX_LABEL_MAP = {
  "\u0E19\u0E49\u0E33/\u0E17\u0E48\u0E2D\u0E23\u0E31\u0E48\u0E27": "FIX_WATER",
  "\u0E44\u0E1F/\u0E1B\u0E25\u0E31\u0E4A\u0E01/\u0E40\u0E1A\u0E23\u0E01\u0E40\u0E01\u0E2D\u0E23\u0E4C": "FIX_ELECTRIC",
  "\u0E41\u0E2D\u0E23\u0E4C\u0E44\u0E21\u0E48\u0E40\u0E22\u0E47\u0E19/\u0E19\u0E49\u0E33\u0E2B\u0E22\u0E14": "FIX_AC",
  "\u0E2B\u0E49\u0E2D\u0E07\u0E19\u0E49\u0E33/\u0E2A\u0E38\u0E02\u0E20\u0E31\u0E13\u0E11\u0E4C": "FIX_BATH",
  "\u0E1B\u0E23\u0E30\u0E15\u0E39/\u0E01\u0E38\u0E0D\u0E41\u0E08": "FIX_DOOR",
  "\u0E40\u0E1F\u0E2D\u0E23\u0E4C\u0E19\u0E34\u0E40\u0E08\u0E2D\u0E23\u0E4C/\u0E2D\u0E38\u0E1B\u0E01\u0E23\u0E13\u0E4C": "FIX_FURN",
  "\u0E01\u0E25\u0E34\u0E48\u0E19/\u0E40\u0E2A\u0E35\u0E22\u0E07\u0E23\u0E1A\u0E01\u0E27\u0E19": "FIX_SMELL",
  "\u0E2D\u0E37\u0E48\u0E19 \u0E46": "FIX_OTHER"
};
function isRoomAct(a) {
  return typeof a === "string" && a.startsWith("ROOM_");
}
__name(isRoomAct, "isRoomAct");
function isFixAct(a) {
  return typeof a === "string" && a.startsWith("FIX_");
}
__name(isFixAct, "isFixAct");
function isResAct(a) {
  return typeof a === "string" && a.startsWith("RES_");
}
__name(isResAct, "isResAct");
function roomDetailByKey(key) {
  const map = {
    ROOM_SIZE: `[\u0E02\u0E19\u0E32\u0E14/\u0E40\u0E25\u0E22\u0E4C\u0E40\u0E2D\u0E32\u0E15\u0E4C]
\u2022 Standard: ~22 \u0E15\u0E23.\u0E21. \u0E23\u0E30\u0E40\u0E1A\u0E35\u0E22\u0E07
\u2022 Corner Plus: ~23 \u0E15\u0E23.\u0E21. \u0E2B\u0E19\u0E49\u0E32\u0E15\u0E48\u0E32\u0E07\u0E21\u0E38\u0E21 + \u0E23\u0E30\u0E40\u0E1A\u0E35\u0E22\u0E07
\u2022 Starter: ~22 \u0E15\u0E23.\u0E21. \u0E23\u0E30\u0E40\u0E1A\u0E35\u0E22\u0E07`,
    ROOM_FURNITURE: `[\u0E40\u0E1F\u0E2D\u0E23\u0E4C\u0E19\u0E34\u0E40\u0E08\u0E2D\u0E23\u0E4C]
\u{1F6CF}\uFE0F\u0E40\u0E15\u0E35\u0E22\u0E07 5 \u0E1F\u0E38\u0E15 + \u0E17\u0E35\u0E48\u0E19\u0E2D\u0E19
\u{1F6AA}\u0E15\u0E39\u0E49\u0E40\u0E2A\u0E37\u0E49\u0E2D\u0E1C\u0E49\u0E32
\u{1FA91}\u0E42\u0E15\u0E4A\u0E30\u0E17\u0E33\u0E07\u0E32\u0E19 + \u0E40\u0E01\u0E49\u0E32\u0E2D\u0E35\u0E49
\u{1FA9F}\u0E1C\u0E49\u0E32\u0E21\u0E48\u0E32\u0E19`,
    ROOM_APPLIANCE: `[\u0E40\u0E04\u0E23\u0E37\u0E48\u0E2D\u0E07\u0E43\u0E0A\u0E49\u0E44\u0E1F\u0E1F\u0E49\u0E32]
\u2744\uFE0F\u0E41\u0E2D\u0E23\u0E4C, \u0E40\u0E04\u0E23\u0E37\u0E48\u0E2D\u0E07\u0E17\u0E33\u0E19\u0E49\u0E33\u0E2D\u0E38\u0E48\u0E19
\u0E15\u0E39\u0E49\u0E40\u0E22\u0E47\u0E19 200 \u0E1A\u0E32\u0E17/\u0E40\u0E14\u0E37\u0E2D\u0E19`,
    ROOM_RENT: `[\u0E04\u0E48\u0E32\u0E40\u0E0A\u0E48\u0E32]
\u2022 Standard (\u0E40\u0E1F\u0E2D\u0E23\u0E4C\u0E04\u0E23\u0E1A): 3,800\u20134,000 \u0E1A./\u0E14.
\u2022 Corner Plus (\u0E40\u0E1F\u0E2D\u0E23\u0E4C\u0E04\u0E23\u0E1A): 4,100\u20134,300 \u0E1A./\u0E14.
\u2022 Starter (\u0E44\u0E21\u0E48\u0E21\u0E35\u0E40\u0E1F\u0E2D\u0E23\u0E4C): 3,500 \u0E1A./\u0E14.`,
    ROOM_UTIL: `[\u0E04\u0E48\u0E32\u0E19\u0E49\u0E33-\u0E44\u0E1F/\u0E40\u0E19\u0E47\u0E15]
\u0E19\u0E49\u0E33 18 | \u0E44\u0E1F 8 
\u{1F6DC}\u0E40\u0E19\u0E47\u0E15: \u0E1F\u0E23\u0E35`,
    ROOM_RENT_IMG: `[\u0E40\u0E23\u0E17\u0E23\u0E32\u0E04\u0E32 + \u0E20\u0E32\u0E1E]`,
    // 👈 new entry
    ROOM_DEPOSIT: `[\u0E40\u0E07\u0E34\u0E19\u0E1B\u0E23\u0E30\u0E01\u0E31\u0E19/\u0E2A\u0E31\u0E0D\u0E0D\u0E32]
\u0E2A\u0E31\u0E0D\u0E0D\u0E32\u0E02\u0E31\u0E49\u0E19\u0E15\u0E48\u0E33 1 \u0E1B\u0E35
\u0E2B\u0E32\u0E01\u0E15\u0E49\u0E2D\u0E07\u0E01\u0E32\u0E23\u0E40\u0E0A\u0E48\u0E32 6 \u0E40\u0E14\u0E37\u0E2D\u0E19 \u0E40\u0E1E\u0E34\u0E48\u0E21\u0E04\u0E48\u0E32\u0E40\u0E0A\u0E48\u0E32 200 \u0E1A./\u0E40\u0E14\u0E37\u0E2D\u0E19
(\u0E23\u0E32\u0E22\u0E25\u0E30\u0E40\u0E2D\u0E35\u0E22\u0E14\u0E40\u0E07\u0E34\u0E19\u0E1B\u0E23\u0E30\u0E01\u0E31\u0E19/\u0E25\u0E48\u0E27\u0E07\u0E2B\u0E19\u0E49\u0E32 \u0E23\u0E30\u0E1A\u0E38\u0E43\u0E19\u0E27\u0E31\u0E19\u0E17\u0E33\u0E2A\u0E31\u0E0D\u0E0D\u0E32)`,
    ROOM_PARKING: `[\u0E17\u0E35\u0E48\u0E08\u0E2D\u0E14\u0E23\u0E16]
\u{1F697}\u0E21\u0E35\u0E2B\u0E25\u0E31\u0E07\u0E04\u0E32 800/\u0E40\u0E14\u0E37\u0E2D\u0E19
\u{1F697}\u0E44\u0E21\u0E48\u0E21\u0E35\u0E2B\u0E25\u0E31\u0E07\u0E04\u0E32 500/\u0E40\u0E14\u0E37\u0E2D\u0E19
\u{1F3CD}\uFE0F\u0E21\u0E2D\u0E40\u0E15\u0E2D\u0E23\u0E4C\u0E44\u0E0B\u0E15\u0E4C\u0E1F\u0E23\u0E35 (\u0E21\u0E35\u0E2B\u0E25\u0E31\u0E07\u0E04\u0E32)`,
    ROOM_EARLIEST: `[\u0E40\u0E02\u0E49\u0E32\u0E2D\u0E22\u0E39\u0E48\u0E40\u0E23\u0E47\u0E27\u0E2A\u0E38\u0E14]
    \u0E15\u0E36\u0E01 A \u0E1E\u0E23\u0E49\u0E2D\u0E21\u0E40\u0E02\u0E49\u0E32\u0E2D\u0E22\u0E39\u0E48 1 \u0E1E.\u0E22. 
    \u0E15\u0E36\u0E01 B \u0E1E\u0E23\u0E49\u0E2D\u0E21\u0E40\u0E02\u0E49\u0E32\u0E2D\u0E22\u0E39\u0E48 1 \u0E18.\u0E04. 

(\u0E40\u0E0A\u0E47\u0E01\u0E2B\u0E49\u0E2D\u0E07\u0E27\u0E48\u0E32\u0E07\u0E44\u0E14\u0E49\u0E17\u0E35\u0E48 \u201C\u0E27\u0E34\u0E18\u0E35\u0E08\u0E2D\u0E07\u201D)`
  };
  return map[key] || "\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E23\u0E32\u0E22\u0E25\u0E30\u0E40\u0E2D\u0E35\u0E22\u0E14\u0E2B\u0E31\u0E27\u0E02\u0E49\u0E2D\u0E08\u0E32\u0E01 Quick Reply \u0E44\u0E14\u0E49\u0E04\u0E48\u0E30";
}
__name(roomDetailByKey, "roomDetailByKey");
function fixDetailByKey(key) {
  const map = {
    FIX_WATER: "[\u0E19\u0E49\u0E33/\u0E17\u0E48\u0E2D\u0E23\u0E31\u0E48\u0E27]\n\u0E1B\u0E34\u0E14\u0E27\u0E32\u0E25\u0E4C\u0E27\u0E19\u0E49\u0E33\u0E0A\u0E31\u0E48\u0E27\u0E04\u0E23\u0E32\u0E27 (\u0E16\u0E49\u0E32\u0E40\u0E02\u0E49\u0E32\u0E16\u0E36\u0E07\u0E44\u0E14\u0E49) \u0E41\u0E25\u0E30\u0E16\u0E48\u0E32\u0E22\u0E23\u0E39\u0E1B\u0E08\u0E38\u0E14\u0E23\u0E31\u0E48\u0E27 \u0E41\u0E08\u0E49\u0E07\u0E40\u0E25\u0E02\u0E2B\u0E49\u0E2D\u0E07+\u0E40\u0E27\u0E25\u0E32\u0E2A\u0E30\u0E14\u0E27\u0E01 \u0E17\u0E35\u0E21\u0E0A\u0E48\u0E32\u0E07\u0E08\u0E30\u0E19\u0E31\u0E14\u0E40\u0E02\u0E49\u0E32\u0E0B\u0E48\u0E2D\u0E21\u0E04\u0E23\u0E31\u0E1A/\u0E04\u0E48\u0E30",
    FIX_ELECTRIC: "[\u0E44\u0E1F\u0E1F\u0E49\u0E32/\u0E23\u0E30\u0E1A\u0E1A\u0E44\u0E1F]\n\u0E1B\u0E25\u0E31\u0E4A\u0E01\u0E2B\u0E23\u0E37\u0E2D\u0E44\u0E1F\u0E14\u0E31\u0E1A? \u0E41\u0E08\u0E49\u0E07\u0E40\u0E25\u0E02\u0E2B\u0E49\u0E2D\u0E07\u0E1E\u0E23\u0E49\u0E2D\u0E21\u0E2D\u0E18\u0E34\u0E1A\u0E32\u0E22\u0E2D\u0E32\u0E01\u0E32\u0E23\u0E04\u0E23\u0E31\u0E1A/\u0E04\u0E48\u0E30",
    FIX_OTHER: "[\u0E2D\u0E37\u0E48\u0E19 \u0E46]\n\u0E40\u0E1E\u0E34\u0E48\u0E21\u0E40\u0E15\u0E34\u0E21\u0E23\u0E32\u0E22\u0E25\u0E30\u0E40\u0E2D\u0E35\u0E22\u0E14\u0E43\u0E2B\u0E49\u0E40\u0E23\u0E32 \u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E08\u0E31\u0E14\u0E01\u0E32\u0E23\u0E44\u0E14\u0E49\u0E40\u0E23\u0E47\u0E27\u0E02\u0E36\u0E49\u0E19"
  };
  return map[key] || "\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E2B\u0E31\u0E27\u0E02\u0E49\u0E2D\u0E08\u0E32\u0E01 Quick Reply \u0E44\u0E14\u0E49\u0E40\u0E25\u0E22\u0E04\u0E23\u0E31\u0E1A/\u0E04\u0E48\u0E30";
}
__name(fixDetailByKey, "fixDetailByKey");
function resDetailByKey(key) {
  if (key === "RES_COMMUTE_AIRPORT") {
    const airportText = [
      "\u2708\uFE0F \u0E27\u0E34\u0E18\u0E35\u0E40\u0E14\u0E34\u0E19\u0E17\u0E32\u0E07\u0E44\u0E1B\u0E2A\u0E19\u0E32\u0E21\u0E1A\u0E34\u0E19\u0E2A\u0E38\u0E27\u0E23\u0E23\u0E13\u0E20\u0E39\u0E21\u0E34 (\u0E44\u0E21\u0E48\u0E21\u0E35\u0E23\u0E16\u0E2A\u0E48\u0E27\u0E19\u0E15\u0E31\u0E27)",
      "",
      "\u0E02\u0E31\u0E49\u0E19\u0E15\u0E2D\u0E19\u0E17\u0E35\u0E48 1: \u0E2B\u0E2D\u0E1E\u0E31\u0E01 \u279C \u0E41\u0E22\u0E01\u0E2A\u0E38\u0E02\u0E2A\u0E21\u0E32\u0E19",
      "\u2022 \u0E40\u0E14\u0E34\u0E19\u0E2D\u0E2D\u0E01\u0E44\u0E1B\u0E17\u0E35\u0E48\u0E1B\u0E49\u0E32\u0E22\u0E23\u0E16\u0E40\u0E21\u0E25\u0E4C \u0E16\u0E19\u0E19\u0E09\u0E25\u0E2D\u0E07\u0E01\u0E23\u0E38\u0E07",
      "\u2022 \u0E02\u0E36\u0E49\u0E19\u0E23\u0E16\u0E2A\u0E2D\u0E07\u0E41\u0E16\u0E27\u0E2A\u0E35\u0E41\u0E14\u0E07 (\u0E15\u0E25\u0E32\u0E14\u0E2B\u0E31\u0E27\u0E15\u0E30\u0E40\u0E02\u0E49/\u0E25\u0E32\u0E14\u0E01\u0E23\u0E30\u0E1A\u0E31\u0E07) \u0E2B\u0E23\u0E37\u0E2D\u0E23\u0E16\u0E40\u0E21\u0E25\u0E4C\u0E40\u0E25\u0E47\u0E01\u0E2A\u0E32\u0E22 1013",
      "\u2022 \u0E1A\u0E2D\u0E01\u0E25\u0E07\u0E17\u0E35\u0E48 \u201C\u0E41\u0E22\u0E01\u0E2A\u0E38\u0E02\u0E2A\u0E21\u0E32\u0E19\u201D",
      "\u2022 \u0E40\u0E27\u0E25\u0E32\u0E43\u0E2B\u0E49\u0E1A\u0E23\u0E34\u0E01\u0E32\u0E23 ~06:00\u201321:40 \u0E19. \u0E04\u0E27\u0E32\u0E21\u0E16\u0E35\u0E48 10\u201325 \u0E19\u0E32\u0E17\u0E35",
      "",
      "\u0E02\u0E31\u0E49\u0E19\u0E15\u0E2D\u0E19\u0E17\u0E35\u0E48 2: \u0E41\u0E22\u0E01\u0E2A\u0E38\u0E02\u0E2A\u0E21\u0E32\u0E19 \u279C \u0E2A\u0E19\u0E32\u0E21\u0E1A\u0E34\u0E19",
      "\u0E15\u0E31\u0E27\u0E40\u0E25\u0E37\u0E2D\u0E01 A (\u0E41\u0E19\u0E30\u0E19\u0E33): \u0E23\u0E16\u0E15\u0E39\u0E49/\u0E21\u0E34\u0E19\u0E34\u0E1A\u0E31\u0E2A 549 \u2014 \u0E40\u0E02\u0E49\u0E32\u0E16\u0E36\u0E07\u0E2D\u0E32\u0E04\u0E32\u0E23\u0E1C\u0E39\u0E49\u0E42\u0E14\u0E22\u0E2A\u0E32\u0E23\u0E42\u0E14\u0E22\u0E15\u0E23\u0E07 (~12\u201315 \u0E1A\u0E32\u0E17)",
      "\u0E15\u0E31\u0E27\u0E40\u0E25\u0E37\u0E2D\u0E01 B: \u0E23\u0E16\u0E40\u0E21\u0E25\u0E4C S4 (549) \u2014 \u0E25\u0E07\u0E28\u0E39\u0E19\u0E22\u0E4C\u0E02\u0E19\u0E2A\u0E48\u0E07\u0E2A\u0E32\u0E18\u0E32\u0E23\u0E13\u0E30 \u0E15\u0E48\u0E2D Shuttle Bus \u0E1F\u0E23\u0E35",
      "\u0E15\u0E31\u0E27\u0E40\u0E25\u0E37\u0E2D\u0E01 C: \u0E23\u0E16\u0E40\u0E27\u0E35\u0E22\u0E19\u0E2A\u0E32\u0E22 C (\u0E1F\u0E23\u0E35) \u2014 \u0E25\u0E07\u0E28\u0E39\u0E19\u0E22\u0E4C\u0E02\u0E19\u0E2A\u0E48\u0E07\u0E2A\u0E32\u0E18\u0E32\u0E23\u0E13\u0E30 \u0E15\u0E48\u0E2D Shuttle Bus \u0E1F\u0E23\u0E35",
      "",
      "\u2728 \u0E2A\u0E23\u0E38\u0E1B: \u0E2A\u0E2D\u0E07\u0E41\u0E16\u0E27\u0E41\u0E14\u0E07 \u279C \u0E23\u0E16\u0E15\u0E39\u0E49/\u0E21\u0E34\u0E19\u0E34\u0E1A\u0E31\u0E2A 549 \u0E04\u0E37\u0E2D\u0E27\u0E34\u0E18\u0E35\u0E17\u0E35\u0E48\u0E23\u0E27\u0E14\u0E40\u0E23\u0E47\u0E27\u0E41\u0E25\u0E30\u0E2A\u0E30\u0E14\u0E27\u0E01\u0E17\u0E35\u0E48\u0E2A\u0E38\u0E14"
    ].join("\n");
    return [{ type: "text", text: airportText }];
  }
  if (key === "RES_COMMUTE_KMITL") {
    const kmitlText = [
      "\u{1F3EB} \u0E27\u0E34\u0E18\u0E35\u0E40\u0E14\u0E34\u0E19\u0E17\u0E32\u0E07\u0E44\u0E1B KMITL (\u22485.6 \u0E01\u0E21.)",
      "",
      "\u2022 \u0E21\u0E2D\u0E40\u0E15\u0E2D\u0E23\u0E4C\u0E44\u0E0B\u0E04\u0E4C\u0E23\u0E31\u0E1A\u0E08\u0E49\u0E32\u0E07 ~15 \u0E19\u0E32\u0E17\u0E35 (\u0E02\u0E36\u0E49\u0E19\u0E04\u0E34\u0E27\u0E2B\u0E19\u0E49\u0E32\u0E2B\u0E2D\u0E2B\u0E23\u0E37\u0E2D\u0E1B\u0E32\u0E01\u0E0B\u0E2D\u0E22)",
      "\u2022 \u0E23\u0E16\u0E2A\u0E2D\u0E07\u0E41\u0E16\u0E27\u0E2A\u0E35\u0E41\u0E14\u0E07\u0E40\u0E2A\u0E49\u0E19\u0E25\u0E32\u0E14\u0E01\u0E23\u0E30\u0E1A\u0E31\u0E07 \u2014 \u0E25\u0E07\u0E2B\u0E19\u0E49\u0E32\u0E21\u0E2B\u0E32\u0E27\u0E34\u0E17\u0E22\u0E32\u0E25\u0E31\u0E22",
      "\u2022 \u0E23\u0E16\u0E40\u0E21\u0E25\u0E4C\u0E2A\u0E32\u0E22 552 (\u0E1B\u0E23\u0E31\u0E1A\u0E2D\u0E32\u0E01\u0E32\u0E28) \u0E02\u0E36\u0E49\u0E19\u0E23\u0E34\u0E21\u0E16\u0E19\u0E19\u0E09\u0E25\u0E2D\u0E07\u0E01\u0E23\u0E38\u0E07",
      "",
      "Tip: \u0E0A\u0E48\u0E27\u0E07\u0E40\u0E23\u0E48\u0E07\u0E14\u0E48\u0E27\u0E19\u0E04\u0E27\u0E23\u0E40\u0E1C\u0E37\u0E48\u0E2D\u0E40\u0E27\u0E25\u0E32\u0E40\u0E25\u0E47\u0E01\u0E19\u0E49\u0E2D\u0E22\u0E01\u0E48\u0E2D\u0E19\u0E40\u0E02\u0E49\u0E32\u0E40\u0E23\u0E35\u0E22\u0E19"
    ].join("\n");
    return [{ type: "text", text: kmitlText }];
  }
  if (key === "RES_CONTACT_BIKE") {
    const motoText = [
      "\u{1F6F5} \u0E40\u0E1A\u0E2D\u0E23\u0E4C\u0E1E\u0E35\u0E48\u0E27\u0E34\u0E19\u0E21\u0E2D\u0E40\u0E15\u0E2D\u0E23\u0E4C\u0E44\u0E0B\u0E04\u0E4C (\u0E2B\u0E19\u0E49\u0E32\u0E1B\u0E32\u0E01\u0E0B\u0E2D\u0E22) \u0E2A\u0E30\u0E14\u0E27\u0E01 \u0E23\u0E27\u0E14\u0E40\u0E23\u0E47\u0E27 \u0E42\u0E17\u0E23\u0E40\u0E23\u0E35\u0E22\u0E01\u0E40\u0E02\u0E49\u0E32\u0E21\u0E32\u0E23\u0E31\u0E1A\u0E17\u0E35\u0E48\u0E15\u0E36\u0E01\u0E44\u0E14\u0E49\u0E40\u0E25\u0E22\u0E04\u0E23\u0E31\u0E1A",
      "",
      "\u{1F4DE} \u0E23\u0E32\u0E22\u0E0A\u0E37\u0E48\u0E2D\u0E1E\u0E35\u0E48\u0E27\u0E34\u0E19\u0E1B\u0E23\u0E30\u0E08\u0E33\u0E08\u0E38\u0E14",
      "\u0E40\u0E1A\u0E2D\u0E23\u0E4C 18 : 086-113-2734",
      "\u0E40\u0E1A\u0E2D\u0E23\u0E4C 1 : 061-608-2523",
      "\u0E40\u0E1A\u0E2D\u0E23\u0E4C 24 : 094-419-8652",
      "\u0E40\u0E1A\u0E2D\u0E23\u0E4C 38 : 098-636-7991",
      "\u0E40\u0E1A\u0E2D\u0E23\u0E4C 3 : 063-520-6658",
      "\u0E40\u0E1A\u0E2D\u0E23\u0E4C 10 : 083-908-1127",
      "\u0E40\u0E1A\u0E2D\u0E23\u0E4C 34 : 080-063-9128",
      "",
      "\u{1F4A1} \u0E02\u0E49\u0E2D\u0E41\u0E19\u0E30\u0E19\u0E33:",
      '\u0E41\u0E08\u0E49\u0E07\u0E27\u0E48\u0E32 "\u0E21\u0E32\u0E23\u0E31\u0E1A\u0E17\u0E35\u0E48 Mama Mansion"',
      "\u0E2A\u0E2D\u0E1A\u0E16\u0E32\u0E21\u0E23\u0E32\u0E04\u0E32\u0E01\u0E48\u0E2D\u0E19\u0E43\u0E0A\u0E49\u0E1A\u0E23\u0E34\u0E01\u0E32\u0E23\u0E19\u0E30\u0E04\u0E23\u0E31\u0E1A",
      "\u0E01\u0E25\u0E32\u0E07\u0E04\u0E37\u0E19\u0E14\u0E36\u0E01 \u0E46 \u0E2D\u0E32\u0E08\u0E08\u0E30\u0E21\u0E35\u0E23\u0E16\u0E19\u0E49\u0E2D\u0E22\u0E01\u0E27\u0E48\u0E32\u0E1B\u0E01\u0E15\u0E34\u0E19\u0E30\u0E04\u0E23\u0E31\u0E1A",
      "\u{1F3E0} \u0E14\u0E49\u0E27\u0E22\u0E04\u0E27\u0E32\u0E21\u0E2B\u0E48\u0E27\u0E07\u0E43\u0E22\u0E08\u0E32\u0E01 Mama Mansion"
    ].join("\n");
    return [{ type: "text", text: motoText }];
  }
  return null;
}
__name(resDetailByKey, "resDetailByKey");
async function lineReply(channelToken, replyToken, messages) {
  if (!channelToken || !replyToken) {
    throw new Error("lineReply: missing token or replyToken");
  }
  const res = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${channelToken}`
    },
    body: JSON.stringify({ replyToken, messages })
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LINE reply failed ${res.status} ${res.statusText}: ${body}`);
  }
}
__name(lineReply, "lineReply");
async function verifySig(bodyText, signature, channelSecret) {
  if (!channelSecret || !signature) return false;
  const encoder = new TextEncoder();
  const keyData = encoder.encode(channelSecret);
  const bodyData = encoder.encode(bodyText || "");
  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
  let sigBytes;
  try {
    const binary = atob(signature);
    sigBytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch (_) {
    return false;
  }
  const signatureBuffer = await crypto.subtle.sign("HMAC", key, bodyData);
  const expected = new Uint8Array(signatureBuffer);
  if (expected.length !== sigBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= expected[i] ^ sigBytes[i];
  }
  return diff === 0;
}
__name(verifySig, "verifySig");
function parseKv(data) {
  const out = {};
  if (!data) return out;
  const parts = String(data).split("&");
  for (const part of parts) {
    if (!part) continue;
    const [rawKey, rawVal = ""] = part.split("=");
    const key = decodeURIComponent(rawKey || "").trim();
    const val = decodeURIComponent(rawVal || "").trim();
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
__name(parseKv, "parseKv");
function parsePostbackData(raw) {
  const input = (raw || "").trim();
  if (!input) return {};
  if (input.startsWith("{")) {
    try {
      const parsed = JSON.parse(input);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch (err) {
      console.warn("parsePostbackData JSON parse failed", err);
    }
  }
  return parseKv(input);
}
__name(parsePostbackData, "parsePostbackData");
async function moveoutTextGate(env, stateKey, textIn, replyToken) {
  return false;
}
__name(moveoutTextGate, "moveoutTextGate");
function quickKeywordReply(text, env) {
  const normalized = (text || "").trim();
  if (!normalized) return null;
  const lower = normalized.toLowerCase();
  const includesAny = /* @__PURE__ */ __name((haystack, keywords) => keywords.some((kw) => haystack.includes(kw)), "includesAny");
  const isUrgent = URGENT_CONTACT_RE.test(normalized) || normalized.includes("\u0E15\u0E34\u0E14\u0E15\u0E48\u0E2D") && !normalized.includes("\u0E2A\u0E2D\u0E1A\u0E16\u0E32\u0E21");
  if (isUrgent) {
    return [
      { type: "text", text: "\u{1F4DE} \u0E40\u0E1A\u0E2D\u0E23\u0E4C\u0E15\u0E34\u0E14\u0E15\u0E48\u0E2D" },
      {
        type: "template",
        altText: "\u0E40\u0E1A\u0E2D\u0E23\u0E4C\u0E42\u0E17\u0E23\u0E09\u0E38\u0E01\u0E40\u0E09\u0E34\u0E19",
        template: {
          type: "buttons",
          text: "\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E40\u0E08\u0E49\u0E32\u0E2B\u0E19\u0E49\u0E32\u0E17\u0E35\u0E48\u0E17\u0E35\u0E48\u0E15\u0E49\u0E2D\u0E07\u0E01\u0E32\u0E23\u0E15\u0E34\u0E14\u0E15\u0E48\u0E2D",
          actions: [
            { type: "uri", label: "\u{1F4DE} \u0E1C\u0E39\u0E49\u0E08\u0E31\u0E14\u0E01\u0E32\u0E23 (\u0E21\u0E32)", uri: "tel:0827981676" },
            { type: "uri", label: "\u{1F4DE} \u0E41\u0E21\u0E48\u0E1A\u0E49\u0E32\u0E19 \u0E15\u0E36\u0E01 A (\u0E01\u0E49\u0E2D\u0E22)", uri: "tel:0806490441" },
            { type: "uri", label: "\u{1F4DE} \u0E41\u0E21\u0E48\u0E1A\u0E49\u0E32\u0E19 \u0E15\u0E36\u0E01 B (\u0E1E\u0E35\u0E48\u0E22\u0E38)", uri: "tel:0837420760" },
            { type: "postback", label: "\u{1F4DE} \u0E27\u0E34\u0E19\u0E21\u0E2D\u0E40\u0E15\u0E2D\u0E23\u0E4C\u0E44\u0E0B\u0E04\u0E4C (\u0E23\u0E32\u0E22\u0E01\u0E32\u0E23)", data: "act=RES_CONTACT_BIKE", displayText: "\u0E40\u0E1A\u0E2D\u0E23\u0E4C\u0E27\u0E34\u0E19\u0E21\u0E2D\u0E40\u0E15\u0E2D\u0E23\u0E4C\u0E44\u0E0B\u0E04\u0E4C" }
          ]
        }
      }
    ];
  }
  const isAvailabilityExcluded = AVAILABILITY_EXCLUDE_KEYWORDS.some((kw) => normalized.includes(kw)) || AVAILABILITY_EXCLUDE_REGEXES.some((re) => re.test(normalized) || re.test(lower));
  const isAvailabilityAsk = AVAILABILITY_REGEXES.some((re) => re.test(normalized));
  if (isAvailabilityAsk && !isAvailabilityExcluded) {
    const today = formatDateBangkok();
    const bookingUrl = String((env?.BOOKING_URL || "").trim() || "https://mamamansion-ar2.pages.dev/");
    return [
      { type: "text", text: `\u0E2D\u0E31\u0E1B\u0E40\u0E14\u0E15\u0E27\u0E31\u0E19\u0E17\u0E35\u0E48 ${today}` },
      { type: "text", text: `\u0E2A\u0E16\u0E32\u0E19\u0E30\u0E2B\u0E49\u0E2D\u0E07: \u0E15\u0E36\u0E01 A \u0E40\u0E15\u0E47\u0E21\u0E41\u0E25\u0E49\u0E27\u0E04\u0E48\u0E30 \u0E15\u0E36\u0E01 B \u0E22\u0E31\u0E07\u0E21\u0E35\u0E2B\u0E49\u0E2D\u0E07\u0E27\u0E48\u0E32\u0E07\u0E2D\u0E22\u0E39\u0E48 \u0E2B\u0E32\u0E01\u0E2A\u0E19\u0E43\u0E08\u0E08\u0E2D\u0E07\u0E2A\u0E32\u0E21\u0E32\u0E23\u0E16\u0E40\u0E0A\u0E47\u0E01\u0E2B\u0E49\u0E2D\u0E07\u0E27\u0E48\u0E32\u0E07\u0E15\u0E2D\u0E19\u0E19\u0E35\u0E49\u0E41\u0E25\u0E30\u0E08\u0E2D\u0E07\u0E1C\u0E48\u0E32\u0E19\u0E40\u0E27\u0E47\u0E1A\u0E44\u0E0B\u0E15\u0E4C\u0E44\u0E14\u0E49\u0E40\u0E25\u0E22\u0E04\u0E23\u0E31\u0E1A
${bookingUrl}` }
    ];
  }
  const utilityReplyQuickActions = {
    items: [
      {
        type: "action",
        action: {
          type: "postback",
          label: "\u0E04\u0E48\u0E32\u0E40\u0E0A\u0E48\u0E32",
          data: "act=ROOM_RENT",
          displayText: "\u0E04\u0E48\u0E32\u0E40\u0E0A\u0E48\u0E32"
        }
      },
      {
        type: "action",
        action: {
          type: "postback",
          label: "\u0E20\u0E32\u0E1E + \u0E40\u0E23\u0E17\u0E23\u0E32\u0E04\u0E32",
          data: "act=ROOM_RENT_IMG",
          displayText: "\u0E20\u0E32\u0E1E + \u0E40\u0E23\u0E17\u0E23\u0E32\u0E04\u0E32"
        }
      }
    ]
  };
  const contactQuickReply = {
    items: [
      {
        type: "action",
        action: {
          type: "postback",
          label: "\u0E40\u0E1A\u0E2D\u0E23\u0E4C\u0E1E\u0E35\u0E48\u0E27\u0E34\u0E19\u0E2B\u0E19\u0E49\u0E32\u0E1B\u0E32\u0E01\u0E0B\u0E2D\u0E22",
          data: "act=RES_CONTACT_BIKE",
          displayText: "\u0E40\u0E1A\u0E2D\u0E23\u0E4C\u0E1E\u0E35\u0E48\u0E27\u0E34\u0E19"
        }
      }
    ]
  };
  const contactMenu = [
    {
      type: "text",
      text: [
        "\u{1F4DE} \u0E0A\u0E48\u0E2D\u0E07\u0E17\u0E32\u0E07\u0E15\u0E34\u0E14\u0E15\u0E48\u0E2D\u0E2B\u0E25\u0E31\u0E01",
        "\u2022 \u0E41\u0E21\u0E48\u0E1A\u0E49\u0E32\u0E19 (\u0E1E\u0E35\u0E48\u0E01\u0E49\u0E2D\u0E22) 080-649-0441 \u0E15\u0E36\u0E01 A",
        "\u2022 \u0E41\u0E21\u0E48\u0E1A\u0E49\u0E32\u0E19 (\u0E1E\u0E35\u0E48\u0E22\u0E38) 083-742-0760 \u0E15\u0E36\u0E01 B",
        "\u2022 \u0E1C\u0E39\u0E49\u0E08\u0E31\u0E14\u0E01\u0E32\u0E23 (\u0E21\u0E32) 082-798-1676"
      ].join("\n"),
      quickReply: contactQuickReply
    }
  ];
  const maidContact = [
    {
      type: "text",
      text: "\u0E41\u0E21\u0E48\u0E1A\u0E49\u0E32\u0E19 (\u0E1E\u0E35\u0E48\u0E01\u0E49\u0E2D\u0E22) 080-649-0441 \u0E15\u0E36\u0E01 A\n\u0E41\u0E21\u0E48\u0E1A\u0E49\u0E32\u0E19 (\u0E1E\u0E35\u0E48\u0E22\u0E38) 083-742-0760 \u0E15\u0E36\u0E01 B\n\u0E1C\u0E39\u0E49\u0E08\u0E31\u0E14\u0E01\u0E32\u0E23 (\u0E21\u0E32) 082-798-1676\n\u0E42\u0E17\u0E23\u0E44\u0E14\u0E49\u0E17\u0E38\u0E01\u0E27\u0E31\u0E19 08:00-20:00 \u0E19."
    }
  ];
  if (isUtilityInquiry(normalized)) {
    const utilityText = roomDetailByKey("ROOM_UTIL");
    const textMessage = {
      type: "text",
      text: utilityText || "[\u0E04\u0E48\u0E32\u0E19\u0E49\u0E33-\u0E44\u0E1F/\u0E40\u0E19\u0E47\u0E15]\n\u0E19\u0E49\u0E33 18 | \u0E44\u0E1F 8\n\u{1F6DC}\u0E40\u0E19\u0E47\u0E15: \u0E1F\u0E23\u0E35",
      quickReply: utilityReplyQuickActions
    };
    return [textMessage];
  }
  if (normalized.includes("\u0E42\u0E1B\u0E23\u0E42\u0E21\u0E0A\u0E31\u0E48\u0E19") || includesAny(lower, ["promotion", "promo", "promotions", "discount", "special offer"])) {
    return [
      {
        type: "text",
        text: "\u{1F381} \u0E42\u0E1B\u0E23\u0E42\u0E21\u0E0A\u0E31\u0E48\u0E19\u0E1E\u0E34\u0E40\u0E28\u0E29: \u0E1F\u0E23\u0E35\u0E04\u0E48\u0E32\u0E2A\u0E48\u0E27\u0E19\u0E01\u0E25\u0E32\u0E07 \u0E40\u0E21\u0E37\u0E48\u0E2D\u0E08\u0E2D\u0E07\u0E01\u0E48\u0E2D\u0E19 31 \u0E18\u0E31\u0E19\u0E27\u0E32\u0E04\u0E21\u0E19\u0E35\u0E49!"
      }
    ];
  }
  const contactTriggers = ["\u0E40\u0E1A\u0E2D\u0E23\u0E4C\u0E15\u0E34\u0E14\u0E15\u0E48\u0E2D", "\u0E40\u0E1A\u0E2D\u0E23\u0E4C\u0E42\u0E17\u0E23", "\u0E0A\u0E48\u0E2D\u0E07\u0E17\u0E32\u0E07\u0E15\u0E34\u0E14\u0E15\u0E48\u0E2D", "\u0E15\u0E34\u0E14\u0E15\u0E48\u0E2D", "contact", "phone"];
  if (includesAny(lower, contactTriggers) || normalized.includes("\u0E40\u0E1A\u0E2D\u0E23\u0E4C") && normalized.includes("\u0E15\u0E34\u0E14\u0E15\u0E48\u0E2D")) {
    return contactMenu;
  }
  const addressRegex = /(ขอ)?ที่อยู่|ส่ง(ของ|พัสดุ)|จัดส่ง|ส่งมาที่|ส่งหา|shipping|address|deliver|delivery|ส่งไปรษณีย์/i;
  if (addressRegex.test(normalized) || addressRegex.test(lower)) {
    const templateAddress = [
      "\u0E21\u0E32\u0E21\u0E32 \u0E41\u0E21\u0E19\u0E0A\u0E31\u0E48\u0E19 \u0E15\u0E36\u0E01 A/B \u0E2B\u0E49\u0E2D\u0E07 A000",
      "45 \u0E0B\u0E2D\u0E22\u0E09\u0E25\u0E2D\u0E07\u0E01\u0E23\u0E38\u0E07 37 \u0E41\u0E02\u0E27\u0E07\u0E25\u0E33\u0E1B\u0E25\u0E32\u0E17\u0E34\u0E27 \u0E40\u0E02\u0E15\u0E25\u0E32\u0E14\u0E01\u0E23\u0E30\u0E1A\u0E31\u0E07 \u0E01\u0E23\u0E38\u0E07\u0E40\u0E17\u0E1E\u0E2F 10520"
    ].join("\n");
    return [
      { type: "text", text: templateAddress },
      { type: "text", text: "\u0E42\u0E1B\u0E23\u0E14\u0E23\u0E30\u0E1A\u0E38\u0E40\u0E25\u0E02\u0E15\u0E36\u0E01\u0E41\u0E25\u0E30\u0E40\u0E25\u0E02\u0E2B\u0E49\u0E2D\u0E07\u0E08\u0E23\u0E34\u0E07\u0E02\u0E2D\u0E07\u0E04\u0E38\u0E13\u0E17\u0E38\u0E01\u0E04\u0E23\u0E31\u0E49\u0E07 \u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E43\u0E2B\u0E49\u0E1E\u0E31\u0E2A\u0E14\u0E38\u0E2A\u0E48\u0E07\u0E16\u0E36\u0E07\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07\u0E19\u0E30\u0E04\u0E30" }
    ];
  }
  if (normalized.includes("\u0E23\u0E32\u0E22\u0E25\u0E30\u0E40\u0E2D\u0E35\u0E22\u0E14") || includesAny(lower, ["room detail", "room details", "details", "detail"])) {
    const quickItems = [
      { label: "\u0E02\u0E19\u0E32\u0E14/\u0E40\u0E25\u0E22\u0E4C\u0E40\u0E2D\u0E32\u0E15\u0E4C", act: "ROOM_SIZE" },
      { label: "\u0E40\u0E1F\u0E2D\u0E23\u0E4C\u0E19\u0E34\u0E40\u0E08\u0E2D\u0E23\u0E4C", act: "ROOM_FURNITURE" },
      { label: "\u0E40\u0E04\u0E23\u0E37\u0E48\u0E2D\u0E07\u0E43\u0E0A\u0E49\u0E44\u0E1F\u0E1F\u0E49\u0E32", act: "ROOM_APPLIANCE" },
      { label: "\u0E04\u0E48\u0E32\u0E40\u0E0A\u0E48\u0E32", act: "ROOM_RENT" },
      { label: "\u0E04\u0E48\u0E32\u0E19\u0E49\u0E33-\u0E44\u0E1F/\u0E40\u0E19\u0E47\u0E15", act: "ROOM_UTIL" },
      { label: "\u0E40\u0E07\u0E34\u0E19\u0E1B\u0E23\u0E30\u0E01\u0E31\u0E19/\u0E2A\u0E31\u0E0D\u0E0D\u0E32", act: "ROOM_DEPOSIT" },
      { label: "\u0E17\u0E35\u0E48\u0E08\u0E2D\u0E14\u0E23\u0E16", act: "ROOM_PARKING" },
      { label: "\u0E40\u0E02\u0E49\u0E32\u0E2D\u0E22\u0E39\u0E48\u0E40\u0E23\u0E47\u0E27\u0E2A\u0E38\u0E14", act: "ROOM_EARLIEST" },
      { label: "\u0E20\u0E32\u0E1E + \u0E40\u0E23\u0E17\u0E23\u0E32\u0E04\u0E32", act: "ROOM_RENT_IMG" }
    ].filter(Boolean).map(({ label, act }) => ({
      type: "action",
      action: {
        type: "postback",
        label,
        data: `act=${act}`,
        displayText: label
      }
    }));
    return [
      {
        type: "text",
        text: "\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E2B\u0E31\u0E27\u0E02\u0E49\u0E2D\u0E23\u0E32\u0E22\u0E25\u0E30\u0E40\u0E2D\u0E35\u0E22\u0E14\u0E2B\u0E49\u0E2D\u0E07\u0E17\u0E35\u0E48\u0E2D\u0E22\u0E32\u0E01\u0E14\u0E39\u0E44\u0E14\u0E49\u0E40\u0E25\u0E22\u0E04\u0E48\u0E30 \u{1F447}",
        quickReply: { items: quickItems }
      }
    ];
  }
  const locationThaiTriggers = ["\u0E17\u0E35\u0E48\u0E15\u0E31\u0E49\u0E07", "\u0E41\u0E1C\u0E19\u0E17\u0E35\u0E48", "\u0E2D\u0E22\u0E39\u0E48\u0E41\u0E16\u0E27", "\u0E2D\u0E22\u0E39\u0E48\u0E15\u0E23\u0E07\u0E44\u0E2B\u0E19", "\u0E2D\u0E22\u0E39\u0E48\u0E44\u0E2B\u0E19", "\u0E41\u0E16\u0E27\u0E44\u0E2B\u0E19", "\u0E0B\u0E2D\u0E22\u0E44\u0E2B\u0E19", "\u0E1E\u0E34\u0E01\u0E31\u0E14", "\u0E44\u0E1B\u0E22\u0E31\u0E07\u0E44\u0E07", "\u0E44\u0E1B\u0E22\u0E31\u0E07\u0E44\u0E2B\u0E19", "\u0E40\u0E14\u0E34\u0E19\u0E17\u0E32\u0E07\u0E22\u0E31\u0E07\u0E44\u0E07", "\u0E40\u0E14\u0E34\u0E19\u0E17\u0E32\u0E07\u0E44\u0E1B", "\u0E17\u0E32\u0E07\u0E44\u0E1B"];
  const locationEnglishTriggers = ["location", "map", "where is", "how to get", "how do i get", "how to go"];
  const locationRegex = /(ไป|เดินทาง).*(ยังไง|อย่างไร|ทางไหน)/i;
  if (includesAny(normalized, locationThaiTriggers) || includesAny(lower, locationEnglishTriggers) || locationRegex.test(normalized)) {
    const mapUrl = String((env?.MAPS_URL || "").trim() || "https://maps.app.goo.gl/Qktm2mDGPappQ8EZA");
    const mapMessage = [
      "\u{1F4CD} \u0E15\u0E33\u0E41\u0E2B\u0E19\u0E48\u0E07 Mama Mansion",
      mapUrl
    ].join("\n");
    return [
      { type: "text", text: mapMessage },
      {
        type: "text",
        text: "\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E14\u0E39\u0E27\u0E34\u0E18\u0E35\u0E40\u0E14\u0E34\u0E19\u0E17\u0E32\u0E07\u0E44\u0E14\u0E49\u0E40\u0E25\u0E22\u0E04\u0E48\u0E30",
        quickReply: {
          items: [
            {
              type: "action",
              action: {
                type: "postback",
                label: "\u0E44\u0E1B KMITL",
                data: "act=RES_COMMUTE_KMITL",
                displayText: "\u0E27\u0E34\u0E18\u0E35\u0E40\u0E14\u0E34\u0E19\u0E17\u0E32\u0E07\u0E44\u0E1B KMITL"
              }
            },
            {
              type: "action",
              action: {
                type: "postback",
                label: "\u0E44\u0E1B\u0E2A\u0E19\u0E32\u0E21\u0E1A\u0E34\u0E19\u0E2A\u0E38\u0E27\u0E23\u0E23\u0E13\u0E20\u0E39\u0E21\u0E34",
                data: "act=RES_COMMUTE_AIRPORT",
                displayText: "\u0E27\u0E34\u0E18\u0E35\u0E40\u0E14\u0E34\u0E19\u0E17\u0E32\u0E07\u0E44\u0E1B\u0E2A\u0E19\u0E32\u0E21\u0E1A\u0E34\u0E19\u0E2A\u0E38\u0E27\u0E23\u0E23\u0E13\u0E20\u0E39\u0E21\u0E34"
              }
            }
          ]
        }
      }
    ];
  }
  const bookingRegex = /จอง.*(ยังไง|อย่างไร|ทำไง|ทำอย่างไร)/i;
  const bookingInterest = normalized.includes("\u0E2A\u0E19\u0E43\u0E08\u0E08\u0E2D\u0E07") || normalized.includes("\u0E2A\u0E19\u0E43\u0E08") && normalized.includes("\u0E08\u0E2D\u0E07");
  if (normalized.includes("\u0E27\u0E34\u0E18\u0E35\u0E08\u0E2D\u0E07") || normalized.includes("\u0E2D\u0E22\u0E32\u0E01\u0E08\u0E2D\u0E07") || bookingInterest || includesAny(lower, ["book", "booking"]) || bookingRegex.test(normalized)) {
    const bookingStepsText = [
      "[\u{1F4C5} \u0E27\u0E34\u0E18\u0E35\u0E08\u0E2D\u0E07\u0E2B\u0E49\u0E2D\u0E07\u0E1E\u0E31\u0E01]",
      "",
      "1) \u0E40\u0E02\u0E49\u0E32 \u201C\u0E23\u0E30\u0E1A\u0E1A\u0E08\u0E2D\u0E07\u201D \u0E17\u0E35\u0E48\u0E25\u0E34\u0E07\u0E01\u0E4C\u0E19\u0E35\u0E49: https://mamamansion-ar2.pages.dev/",
      "2) \u0E01\u0E23\u0E2D\u0E01\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25 \u0E40\u0E25\u0E37\u0E2D\u0E01\u0E2B\u0E49\u0E2D\u0E07\u0E41\u0E25\u0E30\u0E27\u0E31\u0E19\u0E17\u0E35\u0E48\u0E40\u0E02\u0E49\u0E32\u0E2D\u0E22\u0E39\u0E48 \u0E41\u0E25\u0E49\u0E27\u0E2A\u0E48\u0E07\u0E1F\u0E2D\u0E23\u0E4C\u0E21",
      "3) \u0E23\u0E30\u0E1A\u0E1A\u0E2D\u0E2D\u0E01\u0E40\u0E25\u0E02\u0E23\u0E2B\u0E31\u0E2A #MMxxx",
      "4) \u0E1E\u0E34\u0E21\u0E1E\u0E4C\u0E23\u0E2B\u0E31\u0E2A #MMxxx \u0E43\u0E19\u0E41\u0E0A\u0E17\u0E19\u0E35\u0E49",
      "5) \u0E0A\u0E33\u0E23\u0E30\u0E04\u0E48\u0E32\u0E08\u0E2D\u0E07\u0E41\u0E25\u0E30\u0E23\u0E2D\u0E22\u0E37\u0E19\u0E22\u0E31\u0E19\u0E08\u0E32\u0E01\u0E40\u0E08\u0E49\u0E32\u0E2B\u0E19\u0E49\u0E32\u0E17\u0E35\u0E48",
      "6) \u26A0\uFE0F \u0E2B\u0E25\u0E31\u0E07\u0E08\u0E2D\u0E07\u0E43\u0E19\u0E40\u0E27\u0E47\u0E1A\u0E44\u0E0B\u0E15\u0E4C \u0E15\u0E49\u0E2D\u0E07\u0E22\u0E37\u0E19\u0E22\u0E31\u0E19\u0E41\u0E25\u0E30\u0E0A\u0E33\u0E23\u0E30\u0E04\u0E48\u0E32\u0E08\u0E2D\u0E07\u0E17\u0E32\u0E07 LINE \u0E19\u0E35\u0E49\u0E20\u0E32\u0E22\u0E43\u0E19 2 \u0E0A\u0E31\u0E48\u0E27\u0E42\u0E21\u0E07 \u0E21\u0E34\u0E09\u0E30\u0E19\u0E31\u0E49\u0E19\u0E23\u0E30\u0E1A\u0E1A\u0E08\u0E30\u0E22\u0E01\u0E40\u0E25\u0E34\u0E01\u0E2D\u0E31\u0E15\u0E42\u0E19\u0E21\u0E31\u0E15\u0E34"
    ].join("\n");
    const defaultBookingImageUrls = [
      "https://drive.google.com/uc?export=view&id=146RJw9oS4fr1gEMiqrePMTwS-bXZYcZJ",
      "https://drive.google.com/uc?export=view&id=1Y6KUvNmw0wkBoSCldHNA38sBvrDniuR3"
    ];
    const bookingImages = defaultBookingImageUrls.map((fallbackUrl, idx) => {
      const override = idx === 0 ? env?.HOWTO_IMAGE_URL_1 : env?.HOWTO_IMAGE_URL_2;
      const url = String((override || "").trim() || fallbackUrl);
      if (!url) return null;
      return {
        type: "image",
        originalContentUrl: url,
        previewImageUrl: url
      };
    }).filter(Boolean);
    return [
      { type: "text", text: bookingStepsText },
      ...bookingImages
    ];
  }
  if (normalized.includes("\u0E41\u0E21\u0E48\u0E1A\u0E49\u0E32\u0E19") || lower.includes("maid")) {
    return maidContact;
  }
  return null;
}
__name(quickKeywordReply, "quickKeywordReply");
function fridgeInfoReply(env, options = {}) {
  const fridgeWebhook = getN8nFridgeWebhook(env);
  if (options.includeN8nButton && fridgeWebhook) {
    return fridgeButtonMessage(buildFridgePostbackPayload(options));
  }
  console.warn("fridgeInfoReply: missing fridge webhook or button disabled");
  return { type: "text", text: "\u0E21\u0E35\u0E02\u0E49\u0E2D\u0E1C\u0E34\u0E14\u0E1E\u0E25\u0E32\u0E14 \u0E01\u0E23\u0E38\u0E13\u0E32\u0E15\u0E34\u0E14\u0E15\u0E48\u0E2D\u0E40\u0E08\u0E49\u0E32\u0E2B\u0E19\u0E49\u0E32\u0E17\u0E35\u0E48" };
}
__name(fridgeInfoReply, "fridgeInfoReply");
function buildFridgePostbackPayload(options = {}) {
  return {
    act: "fridge_rent_request",
    lineUserId: options.lineUserId || null,
    roomHint: options.roomHint || null,
    chatId: options.chatId || null
  };
}
__name(buildFridgePostbackPayload, "buildFridgePostbackPayload");
function fridgeButtonMessage(postbackData) {
  let dataString = "{}";
  try {
    dataString = JSON.stringify(postbackData);
  } catch (err) {
    console.error("fridgeButtonMessage stringify error", err);
  }
  return {
    type: "template",
    altText: "\u0E40\u0E0A\u0E48\u0E32\u0E15\u0E39\u0E49\u0E40\u0E22\u0E47\u0E19",
    template: {
      type: "buttons",
      text: "\u0E21\u0E35\u0E43\u0E2B\u0E49\u0E40\u0E0A\u0E48\u0E32\u0E40\u0E14\u0E37\u0E2D\u0E19\u0E25\u0E30 200 \u0E1A\u0E32\u0E17",
      actions: [
        {
          type: "postback",
          label: "\u0E40\u0E0A\u0E48\u0E32\u0E15\u0E39\u0E49\u0E40\u0E22\u0E47\u0E19",
          data: dataString,
          displayText: "\u0E02\u0E2D\u0E40\u0E0A\u0E48\u0E32\u0E15\u0E39\u0E49\u0E40\u0E22\u0E47\u0E19"
        }
      ]
    }
  };
}
__name(fridgeButtonMessage, "fridgeButtonMessage");
function buildParkingPostbackPayload(plan, options = {}) {
  return {
    act: "parking_rent_request",
    type: "parking",
    plan,
    lineUserId: options.lineUserId || null,
    chatId: options.chatId || null
  };
}
__name(buildParkingPostbackPayload, "buildParkingPostbackPayload");
function parkingButtonsMessage(payloadOpen, payloadCovered) {
  let dataOpen = "{}";
  let dataCovered = "{}";
  try {
    dataOpen = JSON.stringify(payloadOpen);
  } catch (err) {
    console.error("parkingButtonsMessage stringify open error", err);
  }
  try {
    dataCovered = JSON.stringify(payloadCovered);
  } catch (err) {
    console.error("parkingButtonsMessage stringify covered error", err);
  }
  return {
    type: "template",
    altText: "\u0E40\u0E0A\u0E48\u0E32\u0E17\u0E35\u0E48\u0E08\u0E2D\u0E14\u0E23\u0E16",
    template: {
      type: "carousel",
      columns: [
        {
          title: "\u0E44\u0E21\u0E48\u0E21\u0E35\u0E2B\u0E25\u0E31\u0E07\u0E04\u0E32",
          text: "500 \u0E1A\u0E32\u0E17/\u0E40\u0E14\u0E37\u0E2D\u0E19",
          actions: [
            {
              type: "postback",
              label: "\u0E40\u0E0A\u0E48\u0E32\u0E40\u0E25\u0E22",
              data: dataOpen,
              displayText: "\u0E40\u0E0A\u0E48\u0E32\u0E17\u0E35\u0E48\u0E08\u0E2D\u0E14\u0E23\u0E16 (\u0E44\u0E21\u0E48\u0E21\u0E35\u0E2B\u0E25\u0E31\u0E07\u0E04\u0E32)"
            }
          ]
        },
        {
          title: "\u0E21\u0E35\u0E2B\u0E25\u0E31\u0E07\u0E04\u0E32",
          text: "800 \u0E1A\u0E32\u0E17/\u0E40\u0E14\u0E37\u0E2D\u0E19",
          actions: [
            {
              type: "postback",
              label: "\u0E40\u0E0A\u0E48\u0E32\u0E40\u0E25\u0E22",
              data: dataCovered,
              displayText: "\u0E40\u0E0A\u0E48\u0E32\u0E17\u0E35\u0E48\u0E08\u0E2D\u0E14\u0E23\u0E16 (\u0E21\u0E35\u0E2B\u0E25\u0E31\u0E07\u0E04\u0E32)"
            }
          ]
        }
      ]
    }
  };
}
__name(parkingButtonsMessage, "parkingButtonsMessage");
function getN8nFridgeWebhook(env) {
  return env.N8N_FRIDGE_WEBHOOK_URL || "";
}
__name(getN8nFridgeWebhook, "getN8nFridgeWebhook");
function getN8nParkingWebhook(env) {
  return env.N8N_PARKING_WEBHOOK_URL || "";
}
__name(getN8nParkingWebhook, "getN8nParkingWebhook");
async function notifyN8nFridge(env, payload) {
  const url = getN8nFridgeWebhook(env);
  if (!url) {
    console.warn("notifyN8nFridge: missing webhook URL");
    return false;
  }
  const headers = { "Content-Type": "application/json" };
  const secret = env.WORKER_SECRET || "";
  if (secret) {
    headers["x-worker-secret"] = secret;
  } else {
    console.warn("notifyN8nFridge: missing WORKER_SECRET");
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      console.error("notifyN8nFridge: non-200 response", res.status);
    }
    return res.ok;
  } catch (err) {
    console.error("notifyN8nFridge error", err);
    return false;
  }
}
__name(notifyN8nFridge, "notifyN8nFridge");
async function notifyN8nParking(env, payload) {
  const url = getN8nParkingWebhook(env);
  if (!url) {
    console.warn("notifyN8nParking: missing webhook URL");
    return false;
  }
  const headers = { "Content-Type": "application/json" };
  const secret = env.WORKER_SECRET || "";
  if (secret) {
    headers["x-worker-secret"] = secret;
  } else {
    console.warn("notifyN8nParking: missing WORKER_SECRET");
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      console.error("notifyN8nParking: non-200 response", res.status);
    }
    return res.ok;
  } catch (err) {
    console.error("notifyN8nParking error", err);
    return false;
  }
}
__name(notifyN8nParking, "notifyN8nParking");
export {
  index_default as default
};
//# sourceMappingURL=index.js.map

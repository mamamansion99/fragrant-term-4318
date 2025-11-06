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

const PHONE_RE = /^0\d{9}$/; // 10 digits, starts with 0
const maskPhone = (p)=> (p||'').replace(/^(\d{3})\d{4}(\d{3})$/, '$1••••$2');

/* =========================
 * 1) KV + Loading helpers
 * ========================= */
function hasKV(env){ return !!(env && env.KV && typeof env.KV.get === 'function'); }
async function kvGet(env, k){ try{ if(!hasKV(env)) return null; return await env.KV.get(k, 'json'); }catch(_){ return null; } }
async function kvPut(env, k, v){ try{ if(!hasKV(env)) return; await env.KV.put(k, JSON.stringify(v), { expirationTtl: 7200 }); }catch(_){ /* no-op */ } }
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

async function linePushMessage(channelToken, to, message) {
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${channelToken}`,
    },
    body: JSON.stringify({
      to,
      messages: [message],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LINE push failed ${res.status} ${res.statusText}: ${body}`);
  }
}


// GAS #1: your existing “MM_LineWebhook” (used for LINE webhook traffic)
function getWebhookGas(env){
  return env.MM_GAS_WEBHOOK_URL || env.APPS_SCRIPT_URL || '';
}

// GAS #2: new Move-out API (resolve_token / status / moveout_upsert)
function getMoveoutGas(env){
  return env.MOVEOUT_GAS_URL || '';
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

function getReservationGas(env){
  return env.RESERVATION_URL || '';
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
    const res = await fetch(gasUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Worker-Secret': secret
      },
      body: JSON.stringify(payload)
    });
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
  const secret = env.WORKER_SECRET || '';
  const payload = { ...body, workerSecret: secret }; // body secret for edge calls

  if (!gasUrl || !secret) {
    console.error('forwardToGas: missing config', { hasUrl: !!gasUrl, hasSecret: !!secret });
    return false;
  }

  let ok = false, status = 0, text = '';
  try {
    const res = await fetch(gasUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Worker-Secret': secret // header secret for forwarded LINE events
      },
      body: JSON.stringify(payload)
    });
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

    for (const ev of events) {
      const replyToken = ev?.replyToken;

      /* -----------------------
       * POSTBACK HANDLER
       * --------------------- */
      if (ev.type === 'postback') {
        const data = parseKv(ev.postback?.data || '');

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

        if (data.act === 'FRIDGE_RENT_NOW') {
          const userId = ev?.source?.userId || '';
          if (!userId) {
            await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [{
              type: 'text',
              text: 'ขออภัยค่ะ ยังไม่ทราบเลขห้องของคุณ กรุณาพิมพ์เลขห้อง (เช่น A101) เพื่อดำเนินการต่อ',
              quickReply: { items: fridgeConfirmQuickReplyItems() }
            }]).catch(console.error);
            continue;
          }

          await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [{
            type: 'text',
            text: 'กำลังตรวจสอบเลขห้องของคุณและเตรียมตู้เย็นค่ะ โปรดรอสักครู่…'
          }]).catch(console.error);

          const chatId = getChatId(ev);
          ctx.waitUntil(lineStartLoading(env.LINE_ACCESS_TOKEN, chatId, 6).catch(console.error));

          const roomId = await lookupRoomForUser(env, userId);
          if (roomId) {
            await linePushMessage(env.LINE_ACCESS_TOKEN, chatId, {
              type: 'text',
              text: `✅ ตรวจสอบแล้วว่าคุณอยู่ห้อง ${roomId}\nทีมงานจะติดต่อเพื่อยืนยันเวลาส่งตู้เย็น หากพร้อมกดปุ่มยืนยันได้เลยค่ะ`
            }).catch(console.error);

            const confirmMessage = {
              type: 'template',
              altText: `ยืนยันเช่าตู้เย็น ห้อง ${roomId}`,
              template: {
                type: 'confirm',
                text: `ต้องการเช่าตู้เย็นให้ห้อง ${roomId} หรือไม่?`,
                actions: [
                  {
                    type: 'message',
                    label: 'ยืนยัน',
                    text: `ยืนยันเช่าตู้เย็น ห้อง ${roomId}`
                  },
                  {
                    type: 'message',
                    label: 'ยกเลิก',
                    text: 'ขอยกเลิกเช่าตู้เย็น'
                  }
                ]
              }
            };

            await linePushMessage(env.LINE_ACCESS_TOKEN, chatId, confirmMessage).catch(console.error);
          } else {
            const retryMessage = {
              type: 'text',
              text: 'ยังไม่พบข้อมูลเลขห้องในระบบค่ะ กรุณาพิมพ์เลขห้อง (เช่น A101) เพื่อให้เราช่วยตรวจสอบให้อีกครั้ง',
              quickReply: { items: fridgeConfirmQuickReplyItems() }
            };
            await linePushMessage(env.LINE_ACCESS_TOKEN, chatId, retryMessage).catch(console.error);
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

        // === TEXT ===
        if (m.type === 'text') {
          const textIn  = (m.text || '').trim();
          const chatId  = getChatId(ev);
          const stateKey= getStateKey(ev);
          const userId  = ev?.source?.userId || '';


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

          // (C) Rent payment trigger
          if (/^\s*(ส่งสลิปค่าเช่า|ชำระค่าเช่า|send\s*rent\s*slip|pay\s*rent)\s*$/i.test(textIn)) {
            ctx.waitUntil(lineStartLoading(env.LINE_ACCESS_TOKEN, chatId, 7));
            ctx.waitUntil(lineReply(env.LINE_ACCESS_TOKEN, replyToken, [{
              type: 'text',
              text: 'เริ่มขั้นตอนชำระค่าเช่า…\nโปรดพิมพ์เบอร์ห้อง (เช่น A101)',
              quickReply: { items: [ { type:'action', action:{ type:'postback', label:'ยกเลิก', data:'act=rent_cancel', displayText:'ยกเลิก' } } ] }
            }]).catch(console.error));
            const fakeEv = { ...ev, type: 'postback', postback: { data: 'act=pay_rent' } };
            ctx.waitUntil(forwardToGas(env, { events: [fakeEv] }));
            continue;
          }

          // (C.1) Fridge inquiry → single response with confirm button
          if (isFridgeInquiry(textIn)) {
            await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [fridgeInfoReply()]).catch(console.error);
            continue;
          }

          // (D) Quick keyword replies
          const fast = quickKeywordReply(textIn, env);
          if (fast) {
            ctx.waitUntil(lineReply(env.LINE_ACCESS_TOKEN, replyToken, fast).catch(console.error));
            continue;
          }

          const confirmMatch = /^ยืนยันเช่าตู้เย็น\s+ห้อง\s+([A-Za-z]\d{3,4})\s*$/i.exec(textIn || '');
          if (confirmMatch) {
            const confirmedRoom = confirmMatch[1].toUpperCase();

            await lineReply(env.LINE_ACCESS_TOKEN, replyToken, [{
              type: 'text',
              text: `✅ รับคำยืนยันเช่าตู้เย็นสำหรับห้อง ${confirmedRoom} แล้วค่ะ ทีมงานจะดำเนินการต่อให้เร็วที่สุด`
            }]).catch(console.error);

            ctx.waitUntil(forwardToSpecificGas(env, getReservationGas(env), {
              act: 'fridge_rent',
              via: 'LINE confirm',
              roomId: confirmedRoom,
              lineUserId: userId,
              text: textIn,
              events: [ev]
            }));

            continue;
          }

          // (E) Label → act mapping
          const mappedAct =
            ROOM_LABEL_MAP[textIn] ? ROOM_LABEL_MAP[textIn] :
            FIX_LABEL_MAP[textIn]  ? FIX_LABEL_MAP[textIn]  :
            null;


          // (F) Booking code → ack + forward
          if (/^#?\s*MM\d{3,}$/i.test(textIn)) {
            ctx.waitUntil(lineReply(env.LINE_ACCESS_TOKEN, replyToken, [
              { type: 'text', text: 'กำลังตรวจสอบรหัสจอง…' }
            ]).catch(console.error));
            ctx.waitUntil(forwardToGas(env, { events: [ev] }));
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
          // Optional quick ack
          ctx.waitUntil(lineReply(env.LINE_ACCESS_TOKEN, replyToken, [
            { type: 'text', text: 'รับไฟล์แล้ว กำลังตรวจสอบ…' }
          ]).catch(console.error));

          const stateKey = getStateKey(ev);
          const flow = await kvGet(env, stateKey + ':payrent_flow');
          const active = !!(flow && flow.ts && (Date.now() - flow.ts < 15 * 60 * 1000)); // 15 min window

          if (active) {
            // Route to PAYRENT only while flow is active
            const rentUrl = getPayRentGas(env);
            ctx.waitUntil(forwardToSpecificGas(env, rentUrl, { events: [ev] }));
            // clear the flag after handing off (optional; keeps it one-shot)
            ctx.waitUntil(kvDel(env, stateKey + ':payrent_flow'));
          } else {
            // Not in payrent flow → keep your default behavior
            ctx.waitUntil(forwardToGas(env, { events: [ev] }));
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

async function moveoutTextGate(env, stateKey, textIn, replyToken) {
  // Fallback implementation: forward all handling to GAS by returning false.
  // Existing MOVEOUT flows handled in GAS will continue to work.
  return false;
}

function quickKeywordReply(text, env) {
  const normalized = (text || '').trim();
  if (!normalized) return null;

  const lower = normalized.toLowerCase();

  const contactMenu = [
    {
      type: 'text',
      text: [
        '📞 ช่องทางติดต่อหลัก',
        '• แม่บ้าน (พี่ก้อย) 080-649-0441 ตึก A',
        '• แม่บ้าน (พี่ยุ) ………………………. ตึก B',
        '• ผู้จัดการ 082-798-1676'
      ].join('\n')
    }
  ];

  const maidContact = [
    {
      type: 'text',
      text: 'แม่บ้าน (พี่ก้อย) 080-649-0441 ตึก A\nแม่บ้าน (พี่ยุ) ………………………. ตึก B\nผู้จัดการ (พิม) 082-798-1676\nโทรได้ทุกวัน 08:00-20:00 น.',
    }
  ];

  if (normalized.includes('โปรโมชั่น') || ['promotion', 'promo', 'promotions'].includes(lower)) {
    return [
      {
        type: 'text',
        text: '🎁 โปรโมชั่นพิเศษ: ฟรีอินเทอร์เน็ต/ไวไฟ และค่าส่วนกลาง เมื่อจองก่อน 31 ธันวาคมนี้!'
      }
    ];
  }

  if (['เบอร์ติดต่อ', 'ติดต่อ', 'เบอร์โทร', 'ช่องทางติดต่อ', 'contact', 'phone'].includes(lower)) {
    return contactMenu;
  }

  if (['รายละเอียด', 'รายละเอียดห้อง', 'room detail', 'room details', 'details'].includes(lower)) {
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

  if (normalized.includes('ที่ตั้ง') || normalized.includes('แผนที่') || ['location', 'map'].includes(lower)) {
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

  if (normalized.includes('วิธีจอง')) {
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

  if (['แม่บ้าน', 'ติดต่อแม่บ้าน', 'เบอร์แม่บ้าน', 'โทรหาแม่บ้าน'].includes(lower)) {
    return maidContact;
  }

  return null;
}

function isFridgeInquiry(text) {
  const normalized = (text || '').trim().toLowerCase();
  if (!normalized) return false;

  const fridgeTokens = ['ตู้เย็น', 'fridge', 'refrigerator'];
  const intentTokens = ['สนใจ', 'เช่า', 'ราคา', 'เท่าไหร่', 'กี่บาท', 'ยังไง', 'ไง', 'อยาก', 'ขอ', 'เพิ่ม', 'มีไหม', 'ต้องการ'];

  const hasFridgeWord = fridgeTokens.some(token => normalized.includes(token));
  if (!hasFridgeWord) return false;

  return intentTokens.some(token => normalized.includes(token));
}

function fridgeInfoReply() {
  return {
    type: 'text',
    text: '🧊 ตู้เย็นมีให้เช่าเพิ่ม 200 บาท/เดือน หากสนใจกดปุ่ม “สนใจ”',
    quickReply: { items: fridgeConfirmQuickReplyItems() }
  };
}

function fridgeConfirmQuickReplyItems() {
  return [
    {
      type: 'action',
      action: {
        type: 'postback',
        label: 'สนใจ',
        data: 'act=FRIDGE_RENT_NOW',
        displayText: 'สนใจเช่าตู้เย็น'
      }
    }
  ];
}

async function lookupRoomForUser(env, lineUserId) {
  const userId = (lineUserId || '').trim();
  if (!userId) return null;

  const gasUrl = getReservationGas(env);
  const secret = env.WORKER_SECRET || '';
  if (!gasUrl || !secret) return null;

  const payload = {
    act: 'lookup_room_by_line',
    lineUserId: userId,
    workerSecret: secret
  };

  try {
    const res = await fetch(gasUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Worker-Secret': secret
      },
      body: JSON.stringify(payload)
    });

    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (!ct.includes('application/json')) {
      const text = await res.text().catch(() => '');
      console.warn('lookupRoomForUser non-json', text.slice(0, 200));
      return null;
    }

    const data = await res.json().catch(() => null);
    if (!data || !data.ok) return null;
    const room = typeof data.roomId === 'string' ? data.roomId.trim() : '';
    return room || null;
  } catch (err) {
    console.error('lookupRoomForUser error', err);
    return null;
  }
}

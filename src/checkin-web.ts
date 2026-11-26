// One coordinator for the A999 pilot. Each card addresses a separate stored round.
export const PRACTICE_TENANT = 'Ced558b609e03d0b68e5a2cec012d4094';
const STAFF_GROUP = 'C355d5b5c8a01d88bf61296b4e10f1575';
const STAFF_PAGE = 'https://maid-webapp-umber.vercel.app';
const SLIP_WINDOW = 30 * 60_000;
const cors = { 'Access-Control-Allow-Origin': STAFF_PAGE, 'Cache-Control': 'no-store' };

type Phase = 'starting' | 'bill' | 'saving_bill' | 'method' | 'transfer' | 'checking' | 'review' | 'cash_pending' | 'keys' | 'saving_key' | 'send_form' | 'done';
interface Round {
  id: string;
  flowId: string;
  phase: Phase;
  amount?: number;
  paidAmount?: number;
  bill?: string;
  key?: string;
  cashProof?: string;
  transferSent?: boolean;
  method?: 'cash' | 'transfer';
  transferAt?: number;
  earlySlip?: Record<string, unknown>;
  messageId?: string;
  retryAfter?: number;
  notice: string;
  startedAt: string;
  actor?: string;
}

interface CheckinEnv {
  CHECKIN_WEB: DurableObjectNamespace;
  WORKER_SECRET?: string;
  LINE_ACCESS_TOKEN: string;
  N8N_CHECKIN_FLOW_URL?: string;
  N8N_CHECKINFLOW_URL?: string;
  CHECKIN_WEB_PILOT?: string;
}

function response(body: unknown, status = 200) {
  return Response.json(body, { status, headers: cors });
}

export function checkinCall(env: CheckinEnv, action: string, payload: Record<string, unknown>) {
  const ns = env.CHECKIN_WEB;
  return ns.get(ns.idFromName(PRACTICE_TENANT)).fetch('https://checkin.internal/' + action, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

const publicActions = new Set(['status', 'bill', 'cash', 'transfer', 'key', 'send-form']);
export async function checkinWebRequest(request: Request, env: CheckinEnv, upload: (req: Request) => Promise<Response>, staffName: (token: string) => Promise<string>) {
  if (request.method !== 'POST') return response({ ok: false }, 405);
  const url = new URL(request.url);
  if (url.pathname.endsWith('/workflow')) {
    if (!env.LINE_ACCESS_TOKEN || request.headers.get('Authorization') !== 'Bearer ' + env.LINE_ACCESS_TOKEN) {
      return response({ ok: false }, 401);
    }
    const data = await request.json<Record<string, unknown>>();
    return checkinCall(env, 'workflow', data);
  }

  if (request.headers.get('Origin') !== STAFF_PAGE) return response({ ok: false }, 403);
  if (!request.headers.get('Content-Type')?.startsWith('text/plain')) return response({ ok: false }, 415);
  const data = await request.json<Record<string, unknown>>().catch(() => null);
  if (!data || typeof data.token !== 'string' || !/^[a-f0-9-]{36}$/.test(data.token)) return response({ ok: false }, 404);
  const action = String(data.action);
  const actor = await staffName(String(data.staffToken || ''));
  if (!actor) return response({ ok: false, message: 'กรุณาเลือกชื่อและเข้าระบบแม่บ้านก่อนทำรายการ' }, 401);
  if (action === 'upload') {
    const found = await checkinCall(env, 'status', { token: data.token });
    if (!found.ok) return found;
    return upload(new Request(request.url, { method: 'POST', body: JSON.stringify({ type: 'image/jpeg', data: data.image }) }));
  }
  if (!publicActions.has(action)) return response({ ok: false }, 400);
  return checkinCall(env, action, { token: data.token, amount: data.amount, imageUrl: data.imageUrl, actor });
}

export class CheckinWeb {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly state: DurableObjectState, private readonly env: CheckinEnv) {}

  async fetch(request: Request) {
    const action = new URL(request.url).pathname.slice(1);
    const body = await request.json<Record<string, unknown>>();
    const result = this.tail.then(() => this.run(action, body));
    this.tail = result.catch(() => {});
    return result.catch(error => {
      console.error('checkin_web_action_failed', action, String(error));
      return response({ ok: false, message: 'ระบบบันทึกไม่สำเร็จ ลองอีกครั้งได้' }, 502);
    });
  }

  private async save(round: Round) {
    await this.state.storage.put('round:' + round.id, round);
  }

  private async n8n(round: Round, intent: string, extra: Record<string, unknown> = {}) {
    const url = this.env.N8N_CHECKIN_FLOW_URL || this.env.N8N_CHECKINFLOW_URL || 'https://n8n.srv1112305.hstgr.cloud/webhook/c157057d-5a43-4f6d-96ad-5655c7ebf76e';
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-worker-secret': this.env.WORKER_SECRET || '' },
      body: JSON.stringify({
        ...extra, intent, webRound: round.id, webProof: await this.proof(round, intent), flowId: round.flowId, roomId: 'A999', chatId: PRACTICE_TENANT,
      }),
    });
    if (!res.ok) throw new Error('CheckIn HTTP ' + res.status);
  }

  private async proof(round: Round, intent: string) {
    if (!this.env.WORKER_SECRET) throw new Error('Missing CheckIn worker credential');
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', encoder.encode(this.env.WORKER_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const bytes = await crypto.subtle.sign('HMAC', key, encoder.encode(round.id + ':' + intent));
    return btoa(String.fromCharCode(...new Uint8Array(bytes)));
  }

  private async push(to: string, text: string, retryKey: string) {
    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + this.env.LINE_ACCESS_TOKEN,
        'Content-Type': 'application/json',
        'X-Line-Retry-Key': retryKey,
      },
      body: JSON.stringify({ to, messages: [{ type: 'text', text }] }),
    });
    if (!res.ok && !(res.status === 409 && res.headers.has('x-line-accepted-request-id'))) {
      throw new Error('LINE HTTP ' + res.status);
    }
  }

  private async pushCard(round: Round) {
    const cardKey = round.id.replace(/^./, round.id[0] === '0' ? '1' : '0');
    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {'Authorization': 'Bearer ' + this.env.LINE_ACCESS_TOKEN, 'Content-Type': 'application/json', 'X-Line-Retry-Key': cardKey},
      body: JSON.stringify({ to: STAFF_GROUP, messages: [{
        type: 'flex', altText: 'ห้องฝึก A999 · เปิดเช็กอิน', contents: {
          type: 'bubble', body: { type: 'box', layout: 'vertical', spacing: 'md', contents: [
            { type: 'text', text: 'ห้องฝึก · เช็กอิน A999', weight: 'bold', size: 'lg' },
            { type: 'text', text: 'เริ่มจากถ่ายใบคำนวณ', wrap: true },
            { type: 'button', style: 'primary', action: { type: 'uri', label: 'เปิดเช็กอิน ห้อง A999', uri: STAFF_PAGE + '/#/checkin/' + round.id } },
          ] },
        },
      }] }),
    });
    if (!res.ok && !(res.status === 409 && res.headers.has('x-line-accepted-request-id'))) throw new Error('LINE card HTTP ' + res.status);
  }

  private async form(round: Round) {
    await this.push(PRACTICE_TENANT, 'กรุณาตรวจรับห้อง A999 ที่ลิงก์นี้ค่ะ\nhttps://new-checkin.vercel.app/?flowId=' + encodeURIComponent(round.flowId), round.id);
    round.phase = 'done';
    await this.save(round);
  }

  private publicRound(round: Round) {
    const { phase, amount, method, notice, bill, key, paidAmount, transferAt, retryAfter, cashProof, transferSent } = round;
    return response({ ok: true, phase, amount, method, notice, bill, key, paidAmount, retryAfter, cashProof, transferSent,
      expired: !!transferAt && Date.now() > transferAt + SLIP_WINDOW });
  }

  private async run(action: string, body: Record<string, unknown>) {
    const state = this.state.storage;
    const currentId = await state.get<string>('active');
    if (action === 'start') {
      const old = currentId && await state.get<Round>('round:' + currentId);
      if (old && old.startedAt === body.receivedAt) return response({ ok: true });
      if (old && !['done', 'starting'].includes(old.phase) && Date.now() - Date.parse(old.startedAt) < 8 * 3600_000) {
        await this.pushCard(old);
        return response({ ok: true });
      }
      const id = crypto.randomUUID();
      const startedAt = String(body.receivedAt);
      const flowId = PRACTICE_TENANT + '-A999_' + btoa(startedAt);
      const round: Round = { id, flowId, startedAt, notice: String(body.notice || ''), phase: 'starting' };
      await state.put({ active: id, ['round:' + id]: round });
      await this.n8n(round, 'checkin_start', { receivedAt: startedAt });
      return response({ ok: true });
    }

    const id = action === 'slip' ? currentId : String(body.token || body.webRound || '');
    const round = id && await state.get<Round>('round:' + id);
    if (!round) return response({ ok: false }, 404);

    if (action === 'workflow') {
      if (body.flowId !== round.flowId) return response({ ok: false }, 409);
      switch (body.event) {
        case 'authorize': {
          const authorized = body.webProof === await this.proof(round, String(body.intent));
          return response({ ok: true, proceed: authorized && currentId === round.id });
        }
        case 'created':
          if (round.phase === 'starting') {
            round.phase = 'bill';
            await this.save(round);
          }
          if (round.phase === 'bill') await this.pushCard(round);
          break;
        case 'bill-saved':
          if (round.phase === 'saving_bill' && round.bill === body.imageUrl) {
            round.phase = 'method';
            await this.save(round);
          }
          break;
        case 'slip-result': {
          if (round.phase !== 'checking' || round.messageId !== body.messageId) return response({ ok: true, proceed: false });
          round.paidAmount = Number(body.paidAmount) || 0;
          const valid = body.verified === true && Math.round(round.paidAmount * 100) === Math.round(Number(round.amount) * 100);
          if (!valid) {
            round.phase = 'review';
            await this.save(round);
          }
          return response({ ok: true, proceed: valid });
        }
        case 'paid':
          if (round.phase === 'cash_pending' || round.phase === 'checking') {
            round.phase = 'keys';
            await this.save(round);
          }
          break;
        case 'key-saved':
          if (round.phase === 'saving_key') {
            round.phase = 'send_form';
            await this.save(round);
            await this.form(round).catch(error => console.error('checkin_form_push', String(error)));
          }
          break;
      }
      return response({ ok: true });
    }

    if (action === 'slip') {
      if (!['bill', 'saving_bill', 'method', 'transfer', 'review'].includes(round.phase)) return response({ captured: !!round.method || round.phase !== 'starting' });
      if (round.messageId === body.imageMessageId) return response({ captured: true });
      if (['bill', 'saving_bill', 'method'].includes(round.phase)) {
        round.earlySlip = body;
        await this.save(round);
      } else {
        if (Date.now() > Number(round.transferAt) + SLIP_WINDOW) return response({ captured: true, expired: true });
        await this.verifySlip(round, body);
      }
      return response({ captured: true });
    }

    if (action === 'status') return this.publicRound(round);
    if (round.id !== currentId) return response({ ok: false, message: 'รายการนี้เป็นรอบก่อนหน้า เปิดดูข้อมูลได้' }, 409);
    if (action === 'bill' && (['bill', 'method'].includes(round.phase) || this.canRetry(round, 'saving_bill'))) {
      const amount = Number(body.amount ?? round.amount);
      const imageUrl = body.imageUrl ?? round.bill;
      if (!(amount >= 500 && amount <= 100000) || !this.photo(imageUrl)) return response({ ok: false, message: 'ตรวจรูปและยอด 500–100,000 บาท' }, 400);
      const previous = { ...round };
      Object.assign(round, { amount, bill: imageUrl, phase: 'saving_bill', retryAfter: Date.now() + 120_000 });
      await this.save(round);
      try {
        await this.n8n(round, 'checkin_calc_photo', { imageUrl, actorName: body.actor });
      } catch (error) {
        await this.save(previous);
        throw error;
      }
    } else if (action === 'cash' && (round.phase === 'method' || this.canRetry(round, 'cash_pending'))) {
      if (!this.photo(body.imageUrl)) return response({ ok: false, message: 'กรุณาแนบรูปเงินสด' }, 400);
      if (round.earlySlip) return response({ ok: false, message: 'มีรูปสลิปจากผู้เช่า กรุณาเลือกเงินโอนเพื่อตรวจสอบ' }, 409);
      const previous = round.phase;
      Object.assign(round, { phase: 'cash_pending', method: 'cash', cashProof: body.imageUrl, actor: body.actor, retryAfter: Date.now() + 120_000 });
      await this.save(round);
      try {
        await this.n8n(round, 'checkin_cash', { amount: round.amount, imageUrl: body.imageUrl, actorName: body.actor, nonce: round.id });
      } catch (error) {
        round.phase = previous;
        await this.save(round);
        throw error;
      }
    } else if (action === 'transfer' && (round.phase === 'method' || round.phase === 'transfer')) {
      if (round.phase === 'method') {
        round.method = 'transfer';
        round.transferAt = Date.now();
        round.phase = 'transfer';
        await this.save(round);
      }
      if (round.earlySlip) await this.verifySlip(round, round.earlySlip);
      else if (!round.transferSent) {
        await this.push(PRACTICE_TENANT, 'ห้องฝึก A999 · ยอดเช็กอิน ' + Number(round.amount).toLocaleString('th-TH') + ' บาท กรุณาส่งสลิปในแชทนี้ภายใน 30 นาทีค่ะ', round.id.replace(/^./, round.id[0] === '2' ? '3' : '2'));
        round.transferSent = true;
      }
    } else if (action === 'key' && (round.phase === 'keys' || this.canRetry(round, 'saving_key'))) {
      if (!this.photo(body.imageUrl)) return response({ ok: false, message: 'กรุณาแนบรูปคีย์การ์ด' }, 400);
      const previous = round.phase;
      Object.assign(round, { phase: 'saving_key', key: body.imageUrl, retryAfter: Date.now() + 120_000 });
      await this.save(round);
      try {
        await this.n8n(round, 'checkin_keycard_photo', { imageUrl: round.key });
      } catch (error) {
        round.phase = previous;
        await this.save(round);
        throw error;
      }
    } else if (action === 'send-form' && round.phase === 'send_form') {
      await this.form(round);
    }
    await this.save(round);
    return this.publicRound(round);
  }

  private canRetry(round: Round, phase: Phase) {
    return round.phase === phase && Date.now() > Number(round.retryAfter);
  }

  private photo(value: unknown) {
    return typeof value === 'string' && /^https:\/\/fragrant-term-4318\.mamamansion99\.workers\.dev\/maid\/issue-photo\/[a-f0-9]{32}$/.test(value);
  }

  private async verifySlip(round: Round, body: Record<string, unknown>) {
    const previous = round.phase;
    round.phase = 'checking';
    round.messageId = String(body.imageMessageId);
    await this.save(round);
    try {
      await this.n8n(round, 'checkin_slip', body);
      delete round.earlySlip;
      await this.save(round);
    } catch (error) {
      round.phase = previous;
      delete round.messageId;
      await this.save(round);
      throw error;
    }
  }
}

import { afterEach, describe, expect, it, vi } from 'vitest';
import { CheckinWeb, PRACTICE_TENANT } from '../src/checkin-web';

const imageUrl = 'https://fragrant-term-4318.mamamansion99.workers.dev/maid/issue-photo/0123456789abcdef0123456789abcdef';

function rehearsal() {
  const rows = new Map<string, unknown>();
  const state = {
    storage: {
      get: async (key: string) => structuredClone(rows.get(key)),
      put: async (key: string | Record<string, unknown>, value: unknown) => {
        const entries = typeof key === 'string' ? [[key, value] as const] : Object.entries(key);
        entries.forEach(([key, value]) => rows.set(key, structuredClone(value)));
      },
    },
  };
  const n8n: any[] = [];
  const line: any[] = [];
  let failForm = false;
  const doObject = new CheckinWeb(state as any, { WORKER_SECRET: 'test', LINE_ACCESS_TOKEN: 'test' } as any);
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const data = JSON.parse(String(init.body));
    if (url.includes('n8n')) n8n.push(data);
    else {
      if (failForm && data.messages?.[0]?.text?.includes('กรุณาตรวจรับห้อง')) return new Response(null, { status: 503 });
      line.push(data);
    }
    return new Response(null, { status: 200 });
  });
  const call = async (action: string, body = {}) => {
    const res = await doObject.fetch(new Request('https://checkin.internal/' + action, { method: 'POST', body: JSON.stringify(body) }));
    return { status: res.status, ...await res.json<any>() };
  };
  async function start() {
    await call('start', { receivedAt: new Date().toISOString() });
    const { webRound, flowId } = n8n[0];
    const workflow = (event: string, data = {}) => call('workflow', { webRound, flowId, event, ...data });
    const staff = (action: string, data = {}) => call(action, { token: webRound, ...data });
    expect(line).toHaveLength(0);
    expect(await workflow('authorize', { intent: 'checkin_start', webProof: n8n[0].webProof })).toMatchObject({ proceed: true });
    expect(await workflow('authorize', { intent: 'checkin_start', webProof: 'wrong' })).toMatchObject({ proceed: false });
    await workflow('created');
    expect(line[0].messages[0].contents.body.contents.at(-1).action.uri).toContain(webRound);
    expect(await staff('bill', { imageUrl, amount: 9550 })).toMatchObject({ phase: 'saving_bill' });
    expect(await staff('transfer')).toMatchObject({ phase: 'saving_bill' });
    await workflow('bill-saved', { imageUrl });
    expect(await staff('status')).toMatchObject({ phase: 'method', amount: 9550 });
    return { staff, workflow };
  }
  return { call, start, n8n, line, setFailForm: (value: boolean) => { failForm = value; } };
}

afterEach(() => vi.unstubAllGlobals());

describe('A999 staff check-in', () => {
  it('records cash once and retries a failed form without saving the key photo again', async () => {
    const { start, n8n, line, setFailForm } = rehearsal();
    const { staff, workflow } = await start();
    const results = await Promise.all([staff('cash', { imageUrl, actor: 'staff' }), staff('cash', { imageUrl, actor: 'staff' })]);
    expect(results[0]).toMatchObject({ phase: 'cash_pending' });
    expect(n8n.filter(entry => entry.intent === 'checkin_cash')).toHaveLength(1);
    await workflow('paid');
    expect(await staff('key', { imageUrl })).toMatchObject({ phase: 'saving_key' });
    setFailForm(true);
    await workflow('key-saved');
    expect(await staff('status')).toMatchObject({ phase: 'send_form' });
    setFailForm(false);
    expect(await staff('send-form')).toMatchObject({ phase: 'done' });
    expect(await staff('send-form')).toMatchObject({ phase: 'done' });
    expect(n8n.filter(entry => entry.intent === 'checkin_keycard_photo')).toHaveLength(1);
    expect(line.filter(entry => entry.to === PRACTICE_TENANT)).toHaveLength(1);
  });

  it('holds an early slip until transfer is selected and blocks keys for a mismatched amount', async () => {
    const { call, start, line, n8n } = rehearsal();
    const { staff, workflow } = await start();
    expect(await call('slip', { imageMessageId: 'early' })).toMatchObject({ captured: true });
    expect(n8n.filter(entry => entry.intent === 'checkin_slip')).toHaveLength(0);
    expect(await staff('transfer')).toMatchObject({ phase: 'checking' });
    expect(line).toHaveLength(1);
    expect(await workflow('slip-result', { messageId: 'early', verified: true, paidAmount: 9500 })).toMatchObject({ proceed: false });
    expect(await staff('key', { imageUrl })).toMatchObject({ phase: 'review', paidAmount: 9500 });
    await call('slip', { imageMessageId: 'corrected' });
    expect(await workflow('slip-result', { messageId: 'corrected', verified: true, paidAmount: 9550 })).toMatchObject({ proceed: true });
    await workflow('paid');
    expect(await staff('status')).toMatchObject({ phase: 'keys', method: 'transfer' });
    await staff('key', { imageUrl });
    await workflow('key-saved');
    expect(await staff('status')).toMatchObject({ phase: 'done' });
    expect(line.filter(entry => entry.to === PRACTICE_TENANT)).toHaveLength(1);
  });
});

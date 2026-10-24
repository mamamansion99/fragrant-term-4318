import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { issueInboxToken, recordInboxEvent, recordInboxOutbound } from '../src/inbox';

const STAFF = 'Ue90558b73d62863e2287ac32e69541a3';
const CUSTOMER = 'Uinboxtest000000000000000000000001';
const e = env as any;

const inbound = (text: string, logId: string, ts: string, extra: Record<string, unknown> = {}) => ({
	timestamp: ts, direction: 'IN', eventType: 'message', messageType: 'text', text,
	userId: CUSTOMER, sourceType: 'user', logId, handler: 'unhandled', ...extra
});

async function get(path: string, token?: string) {
	const res = await SELF.fetch(`https://example.com${path}`, token ? { headers: { Authorization: `Bearer ${token}` } } : {});
	return { status: res.status, body: await res.json() as any };
}

describe('inbox', () => {
	it('records 1:1 chats with who wrote each message and serves them to staff', async () => {
		await recordInboxEvent(e, inbound('ห้องว่างไหมคะ', 'log-1', '2026-10-24T10:00:00.000Z'));
		await recordInboxEvent(e, inbound('ห้องว่างไหมคะ', 'log-1', '2026-10-24T10:00:00.000Z')); // redelivery
		await recordInboxOutbound(e, { timestamp: '2026-10-24T10:00:01.000Z', userId: CUSTOMER, sourceType: 'user', text: 'เดี๋ยวเช็คให้นะครับ', logId: 'log-1:out1', handler: 'quick_keyword' }, 'bot');
		await recordInboxOutbound(e, { timestamp: '2026-10-24T10:05:00.000Z', userId: CUSTOMER, sourceType: 'user', text: 'ว่างธันวาครับ', logId: 'log-x', handler: 'inbox' }, 'staff:Ma');
		// Groups are not part of the inbox.
		await recordInboxEvent(e, inbound('group talk', 'log-g', '2026-10-24T10:06:00.000Z', { sourceType: 'group', userId: CUSTOMER }));

		expect((await get('/inbox/api/chats?f=all')).status).toBe(401);
		const token = await issueInboxToken(e, STAFF);
		expect((await get('/inbox/api/me', token)).body.name).toBe('Ma');

		const chats = (await get('/inbox/api/chats?f=all', token)).body.chats;
		const chat = chats.find((c: any) => c.u === CUSTOMER);
		expect(chat.text).toBe('ว่างธันวาครับ');
		expect(chat.author).toBe('staff:Ma');
		expect(chat.waiting).toBe(false);

		const thread = (await get(`/inbox/api/messages?u=${CUSTOMER}`, token)).body;
		expect(thread.messages.map((m: any) => [m.dir, m.author, m.text])).toEqual([
			['IN', 'customer', 'ห้องว่างไหมคะ'],
			['OUT', 'bot', 'เดี๋ยวเช็คให้นะครับ'],
			['OUT', 'staff:Ma', 'ว่างธันวาครับ']
		]);

		// Searching a room finds the tenant from any tab.
		await e.INBOX_DB.prepare("UPDATE contacts SET contact_type = 'TENANT', room_id = 'A102' WHERE user_id = ?1").bind(CUSTOMER).run();
		const found = (await get('/inbox/api/chats?f=lead&q=a102', token)).body.chats;
		expect(found.map((c: any) => c.u)).toContain(CUSTOMER);
		expect((await get('/inbox/api/chats?f=lead', token)).body.chats.some((c: any) => c.u === CUSTOMER)).toBe(false);

		await recordInboxEvent(e, inbound('ขอบคุณค่ะ', 'log-2', '2026-10-24T10:07:00.000Z'));
		const waiting = (await get('/inbox/api/chats?f=waiting', token)).body.chats;
		expect(waiting.some((c: any) => c.u === CUSTOMER)).toBe(true);
	});

	it('refuses tokens for people who are not staff and tampered tokens', async () => {
		const outsider = await issueInboxToken(e, 'Unotstaff00000000000000000000000');
		expect((await get('/inbox/api/me', outsider)).status).toBe(401);
		const good = await issueInboxToken(e, STAFF);
		expect((await get('/inbox/api/me', good.slice(0, -2) + '00')).status).toBe(401);
	});

	it('serves the page without a token and rejects an empty reply', async () => {
		const page = await SELF.fetch('https://example.com/inbox');
		expect(page.status).toBe(200);
		expect(await page.text()).toContain('Mama Inbox');
		const token = await issueInboxToken(e, STAFF);
		const res = await SELF.fetch('https://example.com/inbox/api/send', {
			method: 'POST',
			headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
			body: JSON.stringify({ u: CUSTOMER, text: '  ' })
		});
		expect(res.status).toBe(400);
	});
});

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

describe('inbox drafts and facts', () => {
	const U = 'Uinboxdraft00000000000000000000002';
	it('offers the newest unused AI draft until someone replies, and shows screening facts', async () => {
		const token = await issueInboxToken(e, STAFF);
		const now = Date.now();
		await recordInboxEvent(e, { timestamp: new Date(now - 60000).toISOString(), direction: 'IN', eventType: 'message', messageType: 'text',
			text: 'นักศึกษาค่ะ เข้า ธ.ค.', userId: U, sourceType: 'user', logId: 'd-in-1', handler: 'unhandled' });
		await e.INBOX_DB.prepare("UPDATE contacts SET facts = ?2 WHERE user_id = ?1").bind(U, JSON.stringify({ job: 'นักศึกษา', move_in: 'ธ.ค.' })).run();
		await e.INBOX_DB.prepare('INSERT INTO drafts (user_id, in_log_id, created_at, draft, verdict, ai_sent) VALUES (?1, ?2, ?3, ?4, ?5, 0)')
			.bind(U, 'd-in-1', now - 30000, 'พักกี่คนและมีสัตว์เลี้ยงไหมครับ', 'NEED_INFO').run();

		let t = (await get(`/inbox/api/messages?u=${U}`, token)).body;
		expect(t.draft.text).toBe('พักกี่คนและมีสัตว์เลี้ยงไหมครับ');
		expect(t.contact.facts).toEqual({ job: 'นักศึกษา', move_in: 'ธ.ค.' });
		expect(t.contact.waiting).toBe(true);

		// A draft the live AI already sent is not offered again.
		await e.INBOX_DB.prepare('UPDATE drafts SET ai_sent = 1 WHERE user_id = ?1').bind(U).run();
		expect((await get(`/inbox/api/messages?u=${U}`, token)).body.draft).toBeNull();
		await e.INBOX_DB.prepare('UPDATE drafts SET ai_sent = 0 WHERE user_id = ?1').bind(U).run();

		// Once anyone replies after the draft, it is stale.
		await recordInboxOutbound(e, { timestamp: new Date(now).toISOString(), userId: U, sourceType: 'user', text: 'ได้ครับ', logId: 'd-out-1', handler: 'inbox' }, 'staff:Ma');
		t = (await get(`/inbox/api/messages?u=${U}`, token)).body;
		expect(t.draft).toBeNull();

		const me = (await get('/inbox/api/me', token)).body;
		expect(me.today.staffChats).toBeGreaterThanOrEqual(1);
		expect(me.today.myChats).toBeGreaterThanOrEqual(1);
	});

	it('does not offer a draft for a message the keyword bot already answered', async () => {
		const token = await issueInboxToken(e, STAFF);
		const U2 = 'Uinboxdraft00000000000000000000003';
		const now = Date.now();
		await recordInboxEvent(e, { timestamp: new Date(now - 60000).toISOString(), direction: 'IN', eventType: 'message', messageType: 'text',
			text: 'รายละเอียดห้อง', userId: U2, sourceType: 'user', logId: 'k-in-1', handler: 'quick_keyword' });
		await recordInboxOutbound(e, { timestamp: new Date(now - 59000).toISOString(), userId: U2, sourceType: 'user', text: '[flex]', logId: 'k-in-1:out1', inReplyTo: 'k-in-1', handler: 'quick_keyword' }, 'bot');
		await e.INBOX_DB.prepare('INSERT INTO drafts (user_id, in_log_id, created_at, draft, verdict, ai_sent) VALUES (?1, ?2, ?3, ?4, ?5, 0)')
			.bind(U2, 'k-in-1', now - 30000, 'ห้องมาตรฐาน 4,000 บาทครับ', 'NEED_INFO').run();
		expect((await get(`/inbox/api/messages?u=${U2}`, token)).body.draft).toBeNull();
	});
});

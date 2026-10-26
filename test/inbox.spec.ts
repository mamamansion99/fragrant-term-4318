import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { issueInboxToken, payRentCommandInWindow, recordInboxEvent, recordInboxOutbound } from '../src/inbox';

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

		await recordInboxEvent(e, inbound('แล้วค่ามัดจำเท่าไหร่คะ', 'log-2', new Date().toISOString()));
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

describe('what counts as waiting for a reply', () => {
	it('tells questions from stickers, thanks and button taps', async () => {
		const { needsReply } = await import('../src/inbox');
		for (const t of ['ขอบคุณค่ะ', 'ok ค่ะ', 'โอเคครับ', 'รับทราบครับ', 'ได้ครับผม', 'ขอบคุณมากๆ ครับ 🙏', 'ครับ']) expect(needsReply('text', t), t).toBe(false);
		for (const t of ['ห้องว่างไหมคะ', 'ok แล้วค่าน้ำเท่าไหร่ครับ', 'ขอบคุณค่ะ แต่ช่วยเช็คบิลให้หน่อย', 'เช็นสัญญาเรียบร้อยแล้วค่ะ พรุ่งนี้ส่งกุญแจที่ไหน', 'แอร์ไม่เย็นค่ะ']) expect(needsReply('text', t), t).toBe(true);
		expect(needsReply('sticker', '(sticker 1/2)')).toBe(false);
		expect(needsReply('follow', '(follow)')).toBe(false);
		expect(needsReply('postback', 'act=X')).toBe(false);
		expect(needsReply('image', '(image)')).toBe(true);
		// A rent slip goes to PAY_RENT, which answers by push outside the inbox.
		expect(needsReply('image', '(image)', 'image:pay_rent')).toBe(false);
		expect(needsReply('image', '(image)', 'message:image')).toBe(false);
		expect(needsReply('image', '(image)', 'image:unclaimed')).toBe(true);
	});

	it('keeps a question waiting when a sticker follows it, and drops chats older than three days', async () => {
		const token = await issueInboxToken(e, STAFF);
		const U = 'Uinboxwait000000000000000000000005';
		const old = 'Uinboxwait000000000000000000000006';
		const now = Date.now();
		const ev = (u: string, text: string, ts: number, kind = 'text', logId = `${u}-${ts}`) => recordInboxEvent(e, {
			timestamp: new Date(ts).toISOString(), direction: 'IN', eventType: 'message', messageType: kind, text, userId: u, sourceType: 'user', logId, handler: 'unhandled' });
		await ev(U, 'ค่าส่วนกลางจ่ายทุกเดือนไหมคะ', now - 60000);
		await ev(U, '(sticker 1/2)', now - 30000, 'sticker');
		await ev(old, 'ห้องว่างไหม', now - 4 * 24 * 3600 * 1000);
		const d = (await get('/inbox/api/chats?f=waiting', token)).body;
		expect(d.chats.map((c: any) => c.u)).toContain(U);
		expect(d.chats.map((c: any) => c.u)).not.toContain(old);
		expect(d.waitingCount).toBe(d.chats.length);

		const thanks = 'Uinboxwait000000000000000000000007';
		await recordInboxOutbound(e, { timestamp: new Date(now - 90000).toISOString(), userId: thanks, sourceType: 'user', text: 'ได้ครับ', logId: 'th-out', handler: 'inbox' }, 'staff:Ma');
		await ev(thanks, 'ขอบคุณค่ะ', now - 10000);
		expect((await get('/inbox/api/chats?f=waiting', token)).body.chats.map((c: any) => c.u)).not.toContain(thanks);
	});
});

describe('ending chats and shortcuts', () => {
	const U = 'Uinboxstatus0000000000000000000004';
	const post = async (path: string, token: string, body: unknown) => {
		const res = await SELF.fetch(`https://example.com${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
		return { status: res.status, body: await res.json() as any };
	};
	const ids = (chats: any[]) => chats.map((c) => c.u);

	it('takes an ended chat out of รอตอบ, brings a closed one back on a new message, keeps a muted one hidden', async () => {
		const token = await issueInboxToken(e, STAFF);
		const t0 = Date.now() - 120000;
		await recordInboxEvent(e, { timestamp: new Date(t0).toISOString(), direction: 'IN', eventType: 'message', messageType: 'text', text: 'ห้องว่างไหม', userId: U, sourceType: 'user', logId: 's-1', handler: 'unhandled' });
		expect(ids((await get('/inbox/api/chats?f=waiting', token)).body.chats)).toContain(U);

		await post('/inbox/api/status', token, { u: U, status: 'closed', reason: 'unfit' });
		expect(ids((await get('/inbox/api/chats?f=waiting', token)).body.chats)).not.toContain(U);
		const closed = (await get('/inbox/api/chats?f=closed', token)).body.chats.find((c: any) => c.u === U);
		expect(closed.statusReason).toBe('ไม่ผ่านเกณฑ์');

		await recordInboxEvent(e, { timestamp: new Date(t0 + 1000).toISOString(), direction: 'IN', eventType: 'message', messageType: 'text', text: 'ยังว่างอยู่ไหม', userId: U, sourceType: 'user', logId: 's-2', handler: 'unhandled' });
		expect(ids((await get('/inbox/api/chats?f=waiting', token)).body.chats)).toContain(U);

		await post('/inbox/api/status', token, { u: U, status: 'muted' });
		await recordInboxEvent(e, { timestamp: new Date(t0 + 2000).toISOString(), direction: 'IN', eventType: 'message', messageType: 'text', text: 'ตอบหน่อย', userId: U, sourceType: 'user', logId: 's-3', handler: 'unhandled' });
		expect(ids((await get('/inbox/api/chats?f=waiting', token)).body.chats)).not.toContain(U);
		expect(ids((await get('/inbox/api/chats?f=lead', token)).body.chats)).not.toContain(U);
		const thread = (await get(`/inbox/api/messages?u=${U}`, token)).body;
		expect(thread.contact.status).toBe('muted');
		expect(thread.contact.human).toBe('Ma');

		await post('/inbox/api/status', token, { u: U, status: 'open' });
		expect((await get(`/inbox/api/messages?u=${U}`, token)).body.contact.human).toBe('');
	});

	it('lets staff edit the shortcut buttons and rejects image links LINE cannot show', async () => {
		const token = await issueInboxToken(e, STAFF);
		const seeded = (await get('/inbox/api/shortcuts', token)).body.shortcuts;
		expect(seeded.map((x: any) => x.kind)).toEqual(expect.arrayContaining(['roomcard', 'image', 'text']));
		expect(seeded.find((x: any) => x.label.includes('ข้อมูลหอ')).body).toContain('10,200-10,700');

		const bad = await post('/inbox/api/shortcuts', token, { label: 'รูป', kind: 'image', body: 'http://example.com/a.webp' });
		expect(bad.body.error).toBe('image_url');
		const added = await post('/inbox/api/shortcuts', token, { label: 'โปร', kind: 'text', body: 'ลด 500 บาทเดือนแรก' });
		const id = added.body.shortcuts.find((x: any) => x.label === 'โปร').id;
		const after = await post('/inbox/api/shortcuts/delete', token, { id });
		expect(after.body.shortcuts.some((x: any) => x.id === id)).toBe(false);
	});
});

describe('staff answers the AI learns from', () => {
	it('ranks similar questions first, prefers answers staff rewrote over an AI draft, and skips the same customer', async () => {
		const { staffExamples, similarity } = await import('../src/inbox');
		expect(similarity('ค่าส่วนกลางต้องจ่ายทุกเดือนไหมคะ', 'ค่าส่วนกลางจ่ายรายเดือนไหมครับ')).toBeGreaterThan(similarity('ค่าส่วนกลางต้องจ่ายทุกเดือนไหมคะ', 'มีที่จอดรถไหมครับ'));

		const now = Date.now();
		let n = 0;
		const pair = async (u: string, q: string, a: string) => {
			n++;
			await recordInboxEvent(e, { timestamp: new Date(now - 100000 + n * 10).toISOString(), direction: 'IN', eventType: 'message', messageType: 'text', text: q, userId: u, sourceType: 'user', logId: `ex-in-${n}`, handler: 'unhandled' });
			await recordInboxOutbound(e, { timestamp: new Date(now - 100000 + n * 10 + 5).toISOString(), userId: u, sourceType: 'user', text: a, logId: `ex-out-${n}`, handler: 'inbox' }, 'staff:KP');
		};
		await pair('Uexample00000000000000000000000001', 'ค่าส่วนกลางจ่ายรายเดือนไหมครับ', 'ค่าส่วนกลาง 200 บาท/เดือนครับ');
		await pair('Uexample00000000000000000000000002', 'มีที่จอดรถยนต์ไหมครับ', 'มีครับ เดือนละ 800');
		await pair('Uexample00000000000000000000000003', 'ค่าส่วนกลางต้องจ่ายทุกเดือนไหมคะ', 'จ่ายทุกเดือนค่ะ 200 บาท');

		const ex = await staffExamples(e, 'ค่าส่วนกลางต้องจ่ายทุกเดือนไหมคะ', 'Uexample00000000000000000000000003');
		expect(ex[0].answer).toBe('ค่าส่วนกลาง 200 บาท/เดือนครับ');
		expect(ex.some((x: any) => x.answer === 'จ่ายทุกเดือนค่ะ 200 บาท')).toBe(false); // same customer
		expect(ex.some((x: any) => x.answer === 'มีครับ เดือนละ 800')).toBe(false); // unrelated

		// A staff rewrite of an AI draft outranks a plain answer of equal similarity.
		await e.INBOX_DB.prepare('INSERT INTO drafts (user_id, in_log_id, created_at, draft, verdict, final_text, final_author, sent_at, edited) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1)')
			.bind('Uexample00000000000000000000000001', 'ex-in-1', now, 'ค่าส่วนกลางรวมในค่าเช่าแล้วครับ', 'NEED_INFO', 'ค่าส่วนกลางแยกจากค่าเช่า 200 บาทครับ', 'KP', now).run();
		const ex2 = await staffExamples(e, 'ค่าส่วนกลางจ่ายรายเดือนไหมครับ', 'Uother');
		expect(ex2[0]).toMatchObject({ answer: 'ค่าส่วนกลางแยกจากค่าเช่า 200 บาทครับ', edited: true, aiDraft: 'ค่าส่วนกลางรวมในค่าเช่าแล้วครับ' });
	});

	it('does not hand the AI context to callers without the n8n key', async () => {
		const res = await SELF.fetch('https://example.com/inbox/api/ai-context?u=Uexample00000000000000000000000001&q=test');
		expect(res.status).toBe(401);
	});
});

describe('home-screen app and LINE login', () => {
	it('serves the manifest and icon for adding to the home screen', async () => {
		const m = await (await SELF.fetch('https://example.com/inbox/manifest.webmanifest')).json() as any;
		expect(m).toMatchObject({ name: 'Mama Inbox', start_url: '/inbox', display: 'standalone' });
		const icon = await SELF.fetch('https://example.com/inbox/icon-180.png');
		expect(icon.headers.get('content-type')).toBe('image/png');
		expect((await icon.arrayBuffer()).byteLength).toBeGreaterThan(1000);
	});

	it('hands a finished login to the polling app exactly once, and rejects bad or stale states', async () => {
		const s = 'a'.repeat(32);
		const poll = async (st: string) => (await (await SELF.fetch(`https://example.com/inbox/auth/poll?s=${st}`)).json()) as any;
		expect((await SELF.fetch('https://example.com/inbox/auth/poll?s=nope')).status).toBe(400);
		await e.INBOX_DB.prepare('INSERT INTO auth_states (state, created_at) VALUES (?1, ?2)').bind(s, Date.now()).run();
		expect(await poll(s)).toMatchObject({ ok: false, pending: true });
		const token = await issueInboxToken(e, STAFF);
		await e.INBOX_DB.prepare('UPDATE auth_states SET token = ?2, staff = ?3 WHERE state = ?1').bind(s, token, 'Ma').run();
		expect(await poll(s)).toMatchObject({ ok: true, token, name: 'Ma' });
		expect(await poll(s)).toMatchObject({ ok: false, expired: true });

		const old = 'b'.repeat(32);
		await e.INBOX_DB.prepare('INSERT INTO auth_states (state, created_at, token) VALUES (?1, ?2, ?3)').bind(old, Date.now() - 11 * 60 * 1000, token).run();
		expect(await poll(old)).toMatchObject({ ok: false, expired: true });
	});

	it('says LINE Login is not set up instead of sending staff to a broken LINE page', async () => {
		const res = await SELF.fetch(`https://example.com/inbox/auth/start?s=${'c'.repeat(32)}`, { redirect: 'manual' });
		expect(res.status).toBe(200);
		expect(await res.text()).toContain('ยังไม่ได้ตั้งค่า LINE Login');
	});
});

describe('pay-rent flow recovery', () => {
	const U = 'Upayrenttest0000000000000000000001';
	const at = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
	it('sees a recent ชำระค่าเช่า until a slip has been forwarded', async () => {
		expect(await payRentCommandInWindow(e, U, 15 * 60 * 1000)).toBeNull();
		await recordInboxEvent(e, { timestamp: at(14000), direction: 'IN', eventType: 'message', messageType: 'text', text: 'ชำระค่าเช่า', userId: U, sourceType: 'user', logId: 'pr-cmd', handler: 'pay_rent' });
		expect(await payRentCommandInWindow(e, U, 15 * 60 * 1000)).not.toBeNull();
		expect(await payRentCommandInWindow(e, U, 5000)).toBeNull(); // older than the window
		await recordInboxEvent(e, { timestamp: at(1000), direction: 'IN', eventType: 'message', messageType: 'image', text: '(image)', userId: U, sourceType: 'user', logId: 'pr-img', handler: 'image:pay_rent' });
		expect(await payRentCommandInWindow(e, U, 15 * 60 * 1000)).toBeNull(); // slip already used the flow
	});
});

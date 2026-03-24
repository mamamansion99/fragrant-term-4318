import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src';

describe('Worker routes', () => {
	it('returns OK for non-POST requests outside known GET routes', async () => {
		const request = new Request<unknown, IncomingRequestCfProperties>('http://example.com/message');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		expect(await response.text()).toBe('OK');
	});

	it('returns parsed debug payload at /debug/postback', async () => {
		const request = new Request<unknown, IncomingRequestCfProperties>('http://example.com/debug/postback?data=act%3Dconfirm%26room%3DA101');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const body = await response.json() as Record<string, unknown>;
		expect(body.raw).toBe('act=confirm&room=A101');
		expect(body.parsed).toBeTruthy();
	});

	it('parses contract renewal pipe postback format', async () => {
		const encoded = encodeURIComponent('renewal_reply|ans=CONTINUE&room=A101&end=2026-05-23&inq=RI-A101-2026-05-23&trig=60');
		const request = new Request<unknown, IncomingRequestCfProperties>(`http://example.com/debug/postback?data=${encoded}`);
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const body = await response.json() as Record<string, unknown>;
		const parsed = body.parsed as Record<string, string>;
		expect(parsed.eventType).toBe('renewal_reply');
		expect(parsed.action).toBe('CONTINUE');
		expect(parsed.room).toBe('A101');
		expect(parsed.end).toBe('2026-05-23');
		expect(parsed.inq).toBe('RI-A101-2026-05-23');
		expect(parsed.td).toBe('60');
		expect(parsed.trig).toBe('60');
	});

	it('parses renewal admin pipe postback format', async () => {
		const encoded = encodeURIComponent('renewal_admin|action=ADMIN_SIGN_TEXT&inq=INQ123&room=A101&userId=Ue90558b73d62863e2287ac32e69541a3&end=2026-05-31&td=60');
		const request = new Request<unknown, IncomingRequestCfProperties>(`http://example.com/debug/postback?data=${encoded}`);
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const body = await response.json() as Record<string, unknown>;
		const parsed = body.parsed as Record<string, string>;
		expect(parsed.eventType).toBe('renewal_admin');
		expect(parsed.action).toBe('ADMIN_SIGN_TEXT');
		expect(parsed.room).toBe('A101');
		expect(parsed.inq).toBe('INQ123');
		expect(parsed.userId).toBe('Ue90558b73d62863e2287ac32e69541a3');
		expect(parsed.end).toBe('2026-05-31');
		expect(parsed.td).toBe('60');
	});

	it('validates repo format for /git/latest-commit before calling GitHub', async () => {
		const request = new Request<unknown, IncomingRequestCfProperties>('http://example.com/git/latest-commit?repo=invalid-repo-format');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(500);
		const body = await response.json() as Record<string, unknown>;
		expect(body.ok).toBe(false);
		expect(String(body.error || '')).toContain('invalid GitHub repo format');
	});

	it('integration: default non-POST path still returns OK', async () => {
		const request = new Request('http://example.com/message');
		const response = await SELF.fetch(request);
		expect(await response.text()).toBe('OK');
	});
});

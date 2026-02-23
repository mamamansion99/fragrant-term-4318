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

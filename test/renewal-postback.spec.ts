import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src';

describe('renewal postback parsing', () => {
	it('parses leave checkout datetimepicker querystring payload', async () => {
		const encoded = encodeURIComponent('action=LEAVE_PICK_CHECKOUT&inquiryId=RI-A101-2026-05-23&roomId=A101&contractEnd=2026-05-08&userId=Uxxxxxxxx');
		const request = new Request<unknown, IncomingRequestCfProperties>(`http://example.com/debug/postback?data=${encoded}`);
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const body = await response.json() as Record<string, unknown>;
		const parsed = body.parsed as Record<string, string>;
		expect(parsed.action).toBe('LEAVE_PICK_CHECKOUT');
		expect(parsed.inquiryId).toBe('RI-A101-2026-05-23');
		expect(parsed.roomId).toBe('A101');
		expect(parsed.contractEnd).toBe('2026-05-08');
		expect(parsed.userId).toBe('Uxxxxxxxx');
	});
});

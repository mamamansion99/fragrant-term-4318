import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src';
import { __testables } from '../src/index';

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

	it('normalizes manager renewal decision postbacks for n8n routing', () => {
		const parsed = __testables.parsePostbackData('action=manager_renewal_decision&decision=APPROVE&roomId=A101&end=2026-05-08&inquiryId=RI-A101-2026-05-08&triggerDay=60');
		const meta = __testables.buildRenewalPostbackMeta(parsed, {
			source: {
				type: 'group',
				groupId: 'C-manager-group',
				userId: 'U-manager'
			}
		} as any);

		expect(meta.actionType).toBe('MANAGER_DECISION');
		expect(meta.action).toBe('APPROVE');
		expect(meta.managerDecision).toBe('APPROVE');
		expect(meta.inq).toBe('RI-A101-2026-05-08');
		expect(meta.room).toBe('A101');
		expect(meta.end).toBe('2026-05-08');
		expect(meta.td).toBe('60');
		expect(meta.managerDecisionBy).toBe('U-manager');
		expect(meta.managerChatId).toBe('C-manager-group');
		expect(meta.normalizedEventType).toBe('manager_renewal_decision');
	});

	it('marks tenant renewal replies with ActionType for downstream switch routing', () => {
		const meta = __testables.buildRenewalPostbackMeta({
			action: 'CONTINUE',
			inquiryId: 'RI-A101-2026-05-08',
			roomId: 'A101',
			end: '2026-05-08',
			triggerDay: '60'
		}, {
			source: {
				type: 'user',
				userId: 'U-tenant'
			}
		} as any);

		expect(meta.actionType).toBe('TENANT_RENEWAL_REPLY');
		expect(meta.action).toBe('CONTINUE');
		expect(meta.renewalUserId).toBe('U-tenant');
		expect(meta.td).toBe('60');
	});

	it('accepts CONTINUE_TERM_REPLY-style actions with roomId-only payload', () => {
		const meta = __testables.buildRenewalPostbackMeta({
			action: 'RENEWAL_ACCEPT_TERMS',
			roomId: 'A101'
		}, {
			source: {
				type: 'user',
				userId: 'U-tenant'
			}
		} as any);

		expect(meta.actionType).toBe('TENANT_RENEWAL_REPLY');
		expect(meta.action).toBe('RENEWAL_ACCEPT_TERMS');
		expect(meta.room).toBe('A101');
		expect(meta.inq).toBe('');
		expect(meta.renewalUserId).toBe('U-tenant');
	});

	it('marks renewal signing slot postbacks as tenant renewal replies', () => {
		const meta = __testables.buildRenewalPostbackMeta({
			action: 'RENEWAL_SIGN_SLOT_CONFIRM',
			roomId: 'A101',
			InquiryId: 'RI-ALIAS-001',
			slotKey: 'SLOT-2026-04-12-1300'
		}, {
			source: {
				type: 'user',
				userId: 'U-tenant'
			}
		} as any);

		expect(meta.actionType).toBe('TENANT_RENEWAL_REPLY');
		expect(meta.action).toBe('RENEWAL_SIGN_SLOT_CONFIRM');
		expect(meta.inq).toBe('RI-ALIAS-001');
		expect(meta.slotKey).toBe('SLOT-2026-04-12-1300');
		expect(meta.renewalUserId).toBe('U-tenant');
	});

	it('marks admin datetime picker signing postback as renewal reply', () => {
		const meta = __testables.buildRenewalPostbackMeta({
			action: 'RENEWAL_ADMIN_PICK_SIGNING',
			roomId: 'A101',
			InquiryId: 'RI-ALIAS-001',
			leaseId: 'LEASE-0099'
		}, {
			source: {
				type: 'group',
				groupId: 'C-admin-group',
				userId: 'U-admin'
			}
		} as any);

		expect(meta.actionType).toBe('TENANT_RENEWAL_REPLY');
		expect(meta.action).toBe('RENEWAL_ADMIN_PICK_SIGNING');
		expect(meta.inq).toBe('RI-ALIAS-001');
		expect(meta.leaseId).toBe('LEASE-0099');
		expect(meta.managerChatId).toBe('C-admin-group');
	});

	it('parses renewal action from Action alias key', () => {
		const meta = __testables.buildRenewalPostbackMeta({
			Action: 'RENEWAL_ADMIN_PICK_SIGNING',
			roomId: 'A101',
			inquiryId: 'RI-ALIAS-001'
		}, {
			source: {
				type: 'group',
				groupId: 'C-admin-group',
				userId: 'U-admin'
			}
		} as any);

		expect(meta.actionType).toBe('TENANT_RENEWAL_REPLY');
		expect(meta.action).toBe('RENEWAL_ADMIN_PICK_SIGNING');
		expect(meta.inq).toBe('RI-ALIAS-001');
	});

	it('parses renewalId alias as inquiry identifier', () => {
		const meta = __testables.buildRenewalPostbackMeta({
			action: 'RENEWAL_ASK_MORE',
			roomId: 'A101',
			renewalId: 'RI-000123'
		}, {
			source: {
				type: 'user',
				userId: 'U-tenant'
			}
		} as any);

		expect(meta.actionType).toBe('TENANT_RENEWAL_REPLY');
		expect(meta.action).toBe('RENEWAL_ASK_MORE');
		expect(meta.inq).toBe('RI-000123');
	});

	it('parses InquiryId and LeaseID aliases for CONTINUE_TERM_REPLY payloads', () => {
		const meta = __testables.buildRenewalPostbackMeta({
			action: 'RENEWAL_ACCEPT_TERMS',
			RoomID: 'A101',
			InquiryId: 'RI-ALIAS-001',
			LeaseID: 'LEASE-0099',
			ContractEndDateISO: '2027-05-30'
		}, {
			source: {
				type: 'user',
				userId: 'U-tenant'
			}
		} as any);

		expect(meta.actionType).toBe('TENANT_RENEWAL_REPLY');
		expect(meta.action).toBe('RENEWAL_ACCEPT_TERMS');
		expect(meta.room).toBe('A101');
		expect(meta.inq).toBe('RI-ALIAS-001');
		expect(meta.leaseId).toBe('LEASE-0099');
		expect(meta.end).toBe('2027-05-30');
	});

	it('normalizes manager decision aliases', () => {
		expect(__testables.normalizeManagerDecision('approved')).toBe('APPROVE');
		expect(__testables.normalizeManagerDecision('decline')).toBe('REJECT');
		expect(__testables.normalizeManagerDecision('pending')).toBe('HOLD');
	});

	it('routes only new renewal flex actions to CONTINUE_TERM_REPLY webhook', () => {
		const mockEnv = {
			N8N_RENEWAL_POSTBACK_URL: 'https://example.com/renewal-postback',
			N8N_CONTINUE_TERM_REPLY_URL: 'https://example.com/continue-term-reply'
		} as any;

		expect(__testables.getRenewalPostbackWebhookUrl(mockEnv, 'RENEWAL_ACCEPT_TERMS')).toBe('https://example.com/continue-term-reply');
		expect(__testables.getRenewalPostbackWebhookUrl(mockEnv, 'RENEWAL_ASK_MORE')).toBe('https://example.com/continue-term-reply');
		expect(__testables.getRenewalPostbackWebhookUrl(mockEnv, 'RENEWAL_SIGN_SLOT_CONFIRM')).toBe('https://example.com/continue-term-reply');
		expect(__testables.getRenewalPostbackWebhookUrl(mockEnv, 'RENEWAL_SIGN_SLOT_CHANGE')).toBe('https://example.com/continue-term-reply');
		expect(__testables.getRenewalPostbackWebhookUrl(mockEnv, 'RENEWAL_ADMIN_PICK_SIGNING')).toBe('https://example.com/continue-term-reply');
		expect(__testables.getRenewalPostbackWebhookUrl(mockEnv, 'CONTINUE')).toBe('https://example.com/renewal-postback');
		expect(__testables.getRenewalPostbackWebhookUrl(mockEnv, 'LEAVE')).toBe('https://example.com/renewal-postback');
	});

	it('parses direct key-rent command with mobile banking payment suffix', () => {
		const parsed = __testables.parseKeyRent('เช่าชุดกุญแจ A101 โอน') as Record<string, unknown>;
		expect(parsed).toBeTruthy();
		expect(parsed.mode).toBe('SET');
		expect(parsed.room).toBe('A101');
		expect(parsed.amount).toBe(600);
		expect(parsed.paymentMethod).toBe('MOBILE_BANKING');
	});

	it('parses direct key-rent command with cash payment suffix', () => {
		const parsed = __testables.parseKeyRent('เช่าคีย์การ์ด B514 สด') as Record<string, unknown>;
		expect(parsed).toBeTruthy();
		expect(parsed.mode).toBe('KEYCARD');
		expect(parsed.room).toBe('B514');
		expect(parsed.amount).toBe(100);
		expect(parsed.paymentMethod).toBe('CASH');
	});

	it('keeps direct key-rent command backward compatible when payment suffix is omitted', () => {
		const parsed = __testables.parseKeyRent('เช่ากุญแจ A102') as Record<string, unknown>;
		expect(parsed).toBeTruthy();
		expect(parsed.mode).toBe('KEY');
		expect(parsed.room).toBe('A102');
		expect(parsed.amount).toBe(500);
		expect(parsed.paymentMethod).toBeUndefined();
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

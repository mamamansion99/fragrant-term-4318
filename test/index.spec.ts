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

	it('keeps mark-paid n8n payload compatible with reservationId mappings', () => {
		const payload = __testables.buildMarkPaidForwardPayload(
			{ action: 'mark_paid', row: '75', resId: '#MM500' },
			{ type: 'postback' },
			'2026-05-14T04:11:36.320Z'
		) as Record<string, any>;

		expect(payload.source).toBe('line_postback');
		expect(payload.channel).toBe('mark_paid');
		expect(payload.data).toMatchObject({
			action: 'mark_paid',
			row: '75',
			resId: '#MM500',
			reservationId: '#MM500',
			ReservationID: '#MM500',
			code: '#MM500'
		});
		expect(payload.reservationId).toBe('#MM500');
		expect(payload.ReservationID).toBe('#MM500');
		expect(payload.code).toBe('#MM500');
		expect(payload.row).toBe('75');
	});

	it('parses cleaning tenant and management commands', () => {
		expect(__testables.parseCleaningCommand('บริการทำความสะอาด')).toEqual({
			act: 'tenant',
			roomId: ''
		});
		expect(__testables.parseCleaningCommand('ทำความสะอาด a101')).toEqual({
			act: 'management',
			roomId: 'A101'
		});
		expect(__testables.parseCleaningCommand('ทำความสะอาดA101')).toEqual({
			act: 'management',
			roomId: 'A101'
		});
		expect(__testables.parseCleaningCommand('บริการอื่น')).toBeNull();
	});

	it('restricts cleaning management commands to approved line users', () => {
		expect(__testables.isCleaningManagementAllowedLineUserId('Ue90558b73d62863e2287ac32e69541a3')).toBe(true);
		expect(__testables.isCleaningManagementAllowedLineUserId('U193cae8dd9197f7d4bd6ada8046fd98b')).toBe(true);
		expect(__testables.isCleaningManagementAllowedLineUserId('U2855d93e108ccebbef7d1b55ec8827e5')).toBe(true);
		expect(__testables.isCleaningManagementAllowedLineUserId('U9293d43980e98649e20c8759a2c2d7f0')).toBe(true);
		expect(__testables.isCleaningManagementAllowedLineUserId('Ua3e2f84505daa64ee21b8608e8857c33')).toBe(false);
	});

	it('normalizes cleaning payment reasons to dedicated action key', () => {
		expect(__testables.normalizePenaltyReason('จ่ายค่าทำความสะอาด')).toBe('CLEANING_PAYMENT');
		expect(__testables.normalizePenaltyReason('ชำระค่าทำความสะอาด')).toBe('CLEANING_PAYMENT');
	});

	it('uses OTHERS as the generic penalty slip type while preserving typed categories', () => {
		expect(__testables.normalizePenaltySlipType('penalty')).toBe('OTHERS');
		expect(__testables.normalizePenaltySlipType('Others_payment')).toBe('Others_payment');
		expect(__testables.normalizePenaltySlipReason('penalty', 'จอดรถ')).toBe('OTHERS');
		expect(__testables.normalizePenaltySlipReason('Others_payment', 'ชำระค่าทำความสะอาด')).toBe('CLEANING_PAYMENT');
		expect(__testables.normalizePenaltyFlowReason('จอดรถ')).toBe('จอดรถ');
		expect(__testables.normalizePenaltyFlowReason('ชำระค่าทำความสะอาด')).toBe('CLEANING_PAYMENT');
	});

	it('normalizes cleaning manager price postbacks', () => {
		const postbackData = 'act=CLEANING_MANAGER_PRICE&requestId=CLN-20260517-123456&roomId=A101&price=300&tenantLineUserId=Utenant&source=TENANT_LINE';
		const parsed = __testables.parseQueryString(postbackData);
		const payload = __testables.buildCleaningBillingPostbackPayload(
			{
				type: 'postback',
				replyToken: 'reply-token',
				webhookEventId: 'event-id',
				source: {
					type: 'group',
					groupId: 'CmanagerGroup',
					userId: 'Umanager'
				},
				postback: { data: postbackData }
			} as any,
			parsed,
			postbackData,
			'2026-05-17T00:00:00.000Z'
		) as Record<string, any>;

		expect(payload).toMatchObject({
			source: 'line_postback',
			intent: 'cleaning_billing',
			act: 'Billing',
			billingAction: 'CLEANING_MANAGER_PRICE',
			requestId: 'CLN-20260517-123456',
			roomId: 'A101',
			price: '300',
			tenantLineUserId: 'Utenant',
			cleaningSource: 'TENANT_LINE',
			lineUserId: 'Umanager',
			chatId: 'CmanagerGroup',
			sourceType: 'group',
			replyToken: 'reply-token',
			postbackData,
			webhookEventId: 'event-id',
			receivedAt: '2026-05-17T00:00:00.000Z'
		});
		expect(__testables.buildCleaningBillingAckText(parsed)).toBe(
			'Cleaning price selected (room A101, 300 THB). Sending the tenant bill now.'
		);
		expect(__testables.buildCleaningBillingAckText({})).toBe(
			'Cleaning price selected. Sending the tenant bill now.'
		);
	});

	it('normalizes cleaning tenant payment method postbacks', () => {
		const postbackData = 'act=CLEANING_TENANT_PAY_METHOD&cleaningId=CLNROW-1&requestId=CLN-20260517-123456&billId=BILL-9&roomId=A101&price=300&paymentMethod=CASH';
		const parsed = __testables.parseQueryString(postbackData);
		const payload = __testables.buildCleaningPaymentMethodPostbackPayload(
			{
				type: 'postback',
				replyToken: 'reply-token',
				webhookEventId: 'event-id',
				source: {
					type: 'user',
					userId: 'Utenant'
				},
				postback: { data: postbackData }
			} as any,
			parsed,
			postbackData,
			'2026-05-17T00:00:00.000Z'
		) as Record<string, any>;

		expect(payload).toMatchObject({
			source: 'line_postback',
			intent: 'cleaning_payment_method',
			act: 'CleaningPaymentMethod',
			paymentAction: 'CLEANING_TENANT_PAY_METHOD',
			cleaningId: 'CLNROW-1',
			requestId: 'CLN-20260517-123456',
			billId: 'BILL-9',
			roomId: 'A101',
			price: '300',
			paymentMethod: 'CASH',
			lineUserId: 'Utenant',
			chatId: 'Utenant',
			sourceType: 'user',
			replyToken: 'reply-token',
			postbackData,
			webhookEventId: 'event-id',
			receivedAt: '2026-05-17T00:00:00.000Z'
		});
		expect(__testables.buildCleaningPaymentMethodAckText(parsed)).toBe(
			'Payment selection completed (method CASH, room A101, 300 THB). Thank you.'
		);
		expect(__testables.buildCleaningPaymentMethodAckText({})).toBe(
			'Payment selection completed. Thank you.'
		);
	});

	it('normalizes cleaning cash confirmation postbacks', () => {
		const postbackData = 'act=CLEANING_CASH_CONFIRM&cleaningId=CLNROW-1&requestId=CLN-20260517-123456&billId=BILL-9&roomId=A101&price=300&tenantLineUserId=Utenant';
		const parsed = __testables.parseQueryString(postbackData);
		const payload = __testables.buildCleaningCashConfirmPostbackPayload(
			{
				type: 'postback',
				replyToken: 'reply-token',
				webhookEventId: 'event-id',
				source: {
					type: 'group',
					groupId: 'CmanagerGroup',
					userId: 'Umanager'
				},
				postback: { data: postbackData }
			} as any,
			parsed,
			postbackData,
			'2026-05-17T00:00:00.000Z'
		) as Record<string, any>;

		expect(payload).toMatchObject({
			source: 'line_postback',
			intent: 'cleaning_cash_confirm',
			act: 'CleaningCashConfirm',
			cashAction: 'CLEANING_CASH_CONFIRM',
			cleaningId: 'CLNROW-1',
			requestId: 'CLN-20260517-123456',
			billId: 'BILL-9',
			roomId: 'A101',
			price: '300',
			tenantLineUserId: 'Utenant',
			lineUserId: 'Umanager',
			chatId: 'CmanagerGroup',
			sourceType: 'group',
			replyToken: 'reply-token',
			postbackData,
			webhookEventId: 'event-id',
			receivedAt: '2026-05-17T00:00:00.000Z'
		});
		expect(__testables.buildCleaningCashConfirmAckText(parsed)).toBe(
			'Cash payment confirmed (room A101, 300 THB). Sending confirmation now.'
		);
		expect(__testables.buildCleaningCashConfirmAckText({})).toBe(
			'Cash payment confirmed. Sending confirmation now.'
		);
	});

	it('builds cleaning tenant confirmation flex with postback button', () => {
		const flex = __testables.buildCleaningTenantConfirmFlex() as Record<string, any>;
		expect(flex.type).toBe('flex');
		expect(flex.altText).toContain('300-500');
		const bodyText = flex.contents.body.contents.map((item: Record<string, unknown>) => item.text).join('\n');
		expect(bodyText).toContain('300-500');
		const buttonAction = flex.contents.footer.contents[0].action;
		expect(buttonAction.type).toBe('postback');
		expect(buttonAction.data).toBe('act=CLEANING_TENANT_CONFIRM');
	});

	it('does not let checkin keycard fallback capture private reservation images', () => {
		const state = {
			mode: 'WAITING_CHECKIN_KEYCARD_PHOTO',
			groupId: 'C-manager-group',
			managerUserId: 'U-manager',
			roomId: 'A101',
			ts: Date.now()
		};

		expect(__testables.isCheckinKeycardWaitingPhotoStateForEvent(state, '', 'U-manager')).toBe(false);
		expect(__testables.isCheckinKeycardWaitingPhotoStateForEvent(state, 'C-manager-group', 'U-other')).toBe(false);
		expect(__testables.isCheckinKeycardWaitingPhotoStateForEvent(state, 'C-manager-group', 'U-manager')).toBe(true);
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

	it('parses tenant flex renewal postback querystring payload and routes to CONTINUE_TERM_REPLY', () => {
		const parsed = __testables.parsePostbackData(
			'action=RENEWAL_ACCEPT_TERMS&InquiryId=RI-A101-2026-05-27&roomId=A101&leaseId=LSE-000157&contractEnd=2027-05-30'
		);
		const meta = __testables.buildRenewalPostbackMeta(parsed, {
			source: {
				type: 'user',
				userId: 'Ue90558b73d62863e2287ac32e69541a3'
			}
		} as any);
		const mockEnv = {
			N8N_RENEWAL_POSTBACK_URL: 'https://example.com/renewal-postback',
			N8N_CONTINUE_TERM_REPLY_URL: 'https://example.com/continue-term-reply'
		} as any;

		expect(meta.actionType).toBe('TENANT_RENEWAL_REPLY');
		expect(meta.action).toBe('RENEWAL_ACCEPT_TERMS');
		expect(meta.inq).toBe('RI-A101-2026-05-27');
		expect(meta.room).toBe('A101');
		expect(meta.leaseId).toBe('LSE-000157');
		expect(meta.end).toBe('2027-05-30');
		expect(meta.renewalUserId).toBe('Ue90558b73d62863e2287ac32e69541a3');
		expect(__testables.getRenewalPostbackWebhookUrl(mockEnv, meta.action)).toBe('https://example.com/continue-term-reply');
	});

	it('normalizes admin followup picker action to renewal admin pick signing', () => {
		const parsed = __testables.parsePostbackData(
			'action=RENEWAL_ADMIN_PICK_SIGNING_FOLLOWUP&taskId=RTI-A312-RI-A312-2026-05-01&inquiryId=RI-A312-2026-05-01&roomId=A312'
		);
		const meta = __testables.buildRenewalPostbackMeta(parsed, {
			source: {
				type: 'group',
				groupId: 'C07e625728aee936d59df1bca18bed149',
				userId: 'U-admin'
			}
		} as any);
		const mockEnv = {
			N8N_RENEWAL_POSTBACK_URL: 'https://example.com/renewal-postback',
			N8N_CONTINUE_TERM_REPLY_URL: 'https://example.com/continue-term-reply'
		} as any;

		expect(meta.action).toBe('RENEWAL_ADMIN_PICK_SIGNING');
		expect(meta.actionType).toBe('TENANT_RENEWAL_REPLY');
		expect(meta.inq).toBe('RI-A312-2026-05-01');
		expect(meta.room).toBe('A312');
		expect(__testables.getRenewalPostbackWebhookUrl(mockEnv, meta.action)).toBe('https://example.com/continue-term-reply');
	});

	it('keeps renewal action when payload uses act alias with InquiryId', () => {
		const parsed = __testables.parsePostbackData(
			'act=ADMIN_SEND_SLOT&InquiryId=RI-A507-2026-05-02&roomId=A507&leaseId=LSE-000157'
		);
		const meta = __testables.buildRenewalPostbackMeta(parsed, {
			source: {
				type: 'group',
				groupId: 'C-admin-group',
				userId: 'U-admin'
			}
		} as any);

		expect(meta.action).toBe('ADMIN_SEND_SLOT');
		expect(meta.inq).toBe('RI-A507-2026-05-02');
		expect(meta.room).toBe('A507');
		expect(meta.leaseId).toBe('LSE-000157');
	});

	it('still prefers ans for renew_decision alias payloads', () => {
		const meta = __testables.buildRenewalPostbackMeta({
			act: 'renew_decision',
			ans: 'CONTINUE',
			inquiryId: 'RI-A101-2026-05-08',
			roomId: 'A101'
		}, {
			source: {
				type: 'user',
				userId: 'U-tenant'
			}
		} as any, 'renew_decision');

		expect(meta.action).toBe('CONTINUE');
		expect(meta.actionType).toBe('TENANT_RENEWAL_REPLY');
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

	it('routes bare co room shortcuts to the checkout start webhook path', () => {
		const shortcut = __testables.parseCoAdminShortcut('co A101') as Record<string, unknown>;
		expect(shortcut).toBeTruthy();
		expect(shortcut.type).toBe('co');
		expect(shortcut.roomId).toBe('A101');
		expect(shortcut.outcome).toBe(null);
		expect(shortcut.normalizedCommand).toBe('co a101');
		expect(__testables.isCheckoutStartShortcut(shortcut)).toBe(true);
	});

	it('parses the check-in room command', () => {
		expect(__testables.parseCheckinCommand('เช็คอินห้อง A101')).toBe('A101');
		expect(__testables.parseCheckinCommand(' เช็คอินห้อง b514 ')).toBe('B514');
		expect(__testables.parseCheckinCommand('เช็คอิน A101')).toBeNull();
	});

	it('arms CHECKOUT2 slip flow from postback button data', () => {
		const data = __testables.parseQueryString(
			'act=CHECKOUT2&Category=CHECKOUT2&category=CHECKOUT2&room=A101&roomId=A101&RoomID=A101&lineUserId=Utenant'
		);
		const event = {
			source: { type: 'user', userId: 'Utenant' }
		};
		const state = __testables.buildCheckout2PaymentFlowState(
			data,
			event,
			'act=CHECKOUT2&roomId=A101&lineUserId=Utenant',
			123456
		) as Record<string, unknown>;

		expect(__testables.isCheckout2PaymentPostback(data)).toBe(true);
		expect(state).toMatchObject({
			ts: 123456,
			chatId: 'Utenant',
			type: 'Others_payment',
			reason: 'CHECKOUT2',
			categories: 'CHECKOUT2',
			roomId: 'A101',
			userId: 'Utenant'
		});
	});

	it('allows co admin shortcuts for configured LINE user IDs only', () => {
		expect(__testables.isCoAdminAllowedLineUserId('Ue90558b73d62863e2287ac32e69541a3')).toBe(true);
		expect(__testables.isCoAdminAllowedLineUserId('U2855d93e108ccebbef7d1b55ec8827e5')).toBe(true);
		expect(__testables.isCoAdminAllowedLineUserId('U9293d43980e98649e20c8759a2c2d7f0')).toBe(true);
		expect(__testables.isCoAdminAllowedLineUserId('Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx')).toBe(false);
		expect(__testables.isCoAdminAllowedLineUserId('')).toBe(false);
	});

	it('keeps non-start co admin shortcuts on the admin webhook path', () => {
		const coOutcomeShortcut = __testables.parseCoAdminShortcut('co A101 no') as Record<string, unknown>;
		const doneShortcut = __testables.parseCoAdminShortcut('co done A101 waive') as Record<string, unknown>;
		const statusShortcut = __testables.parseCoAdminShortcut('co status A101') as Record<string, unknown>;
		const readyShortcut = __testables.parseCoAdminShortcut('ready A101') as Record<string, unknown>;

		expect(coOutcomeShortcut.type).toBe('co');
		expect(doneShortcut.type).toBe('co_done');
		expect(statusShortcut.type).toBe('co_status');
		expect(readyShortcut.type).toBe('ready');
		expect(__testables.isCheckoutStartShortcut(coOutcomeShortcut)).toBe(false);
		expect(__testables.isCheckoutStartShortcut(doneShortcut)).toBe(false);
		expect(__testables.isCheckoutStartShortcut(statusShortcut)).toBe(false);
		expect(__testables.isCheckoutStartShortcut(readyShortcut)).toBe(false);
	});

	it('uses configured prebook webhook URL with production default fallback', () => {
		expect(__testables.getPrebookWebhookUrl({})).toBe('https://n8n.srv1112305.hstgr.cloud/webhook/prebook');
		expect(__testables.getPrebookWebhookUrl({
			N8N_PREBOOK_WEBHOOK_URL: 'https://example.com/prebook'
		})).toBe('https://example.com/prebook');
	});

	it('builds outsider parking phone state for a two minute wait window', () => {
		const postbackPayload = __testables.buildParkingPostbackPayload({
			lineUserId: 'Uparking',
			chatId: 'Uparking',
			customerType: 'outsider'
		}) as Record<string, unknown>;
		const tenantPayload = __testables.buildParkingPostbackPayload({
			lineUserId: 'Utenant',
			chatId: 'Utenant',
			customerType: 'tenant'
		}) as Record<string, unknown>;
		const state = __testables.buildParkingOutsiderPhoneState({
			lineUserId: 'Uparking',
			chatId: 'Uparking',
			requestData: postbackPayload
		}) as Record<string, any>;

		expect(__testables.PARKING_OUTSIDER_PHONE_TTL_SECONDS).toBe(120);
		expect(__testables.parkingOutsiderPhoneFlowKey('Uparking')).toBe('parking:outsider-phone:Uparking');
		expect(postbackPayload).toMatchObject({
			customerType: 'outsider',
			customerLabel: 'บุคคลภายนอก',
			pricePerMonth: 1000
		});
		expect(tenantPayload.customerType).toBeUndefined();
		expect(state).toMatchObject({
			state: __testables.PARKING_OUTSIDER_PHONE_STATE,
			type: 'parking',
			plan: 'parking',
			customerType: 'outsider',
			lineUserId: 'Uparking',
			chatId: 'Uparking',
			requestData: postbackPayload
		});
		expect(typeof state.ts).toBe('number');
	});

	it('normalizes and validates parking outsider phone replies', () => {
		expect(__testables.normalizeParkingPhone('081-234-5678')).toBe('0812345678');
		expect(__testables.normalizeParkingPhone('+66 81 234 5678')).toBe('+66812345678');
		expect(__testables.isValidParkingPhone('081-234-5678')).toBe(true);
		expect(__testables.isValidParkingPhone('+66 81 234 5678')).toBe(true);
		expect(__testables.isValidParkingPhone('12345')).toBe(false);
	});

	it('builds parking outsider phone payload for n8n', () => {
		const payload = __testables.buildParkingOutsiderPhonePayload(
			{
				source: {
					type: 'user',
					userId: 'Uparking'
				}
			} as any,
			'0812345678',
			{ chatId: 'Uparking' },
			'081-234-5678'
		) as Record<string, any>;

		expect(payload.source).toBe('line_message');
		expect(payload.channel).toBe('parking');
		expect(payload.data).toMatchObject({
			act: 'parking_outsider_phone_received',
			type: 'parking',
			plan: 'parking',
			customerType: 'outsider',
			customerLabel: 'บุคคลภายนอก',
			pricePerMonth: 1000,
			lineUserId: 'Uparking',
			chatId: 'Uparking',
			phone: '0812345678',
			rawPhoneText: '081-234-5678'
		});
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

	it('replies to combined availability and room price questions', async () => {
		const messages = await __testables.quickKeywordReply(
			'สวัสดีครับ ขออนุญาตสอบถามตอนนี้ที่หอพักมีห้องว่างหรือกำลังจะว่างมั้ยครับ ราคาห้องอยู่ที่เท่าไหร่ต่อเดือนครับ',
			env,
			'Utest'
		) as Array<Record<string, unknown>>;

		expect(messages).toHaveLength(2);
		expect(messages[0].text).toContain('Standard (เฟอร์ครบ): 4,000 บ./ด.');
		expect(messages[1].text).toContain('ตอนนี้ห้องเต็มแต่มีคนออกเรื่อยๆ');
		expect(messages[1].text).toContain('https://mm-prebook.pages.dev/');
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

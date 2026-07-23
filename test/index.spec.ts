import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect, vi } from 'vitest';
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

	it('parses and forwards payment review accept postback data', () => {
		const postbackData = 'act=PAY_REVIEW_ACCEPT&reviewId=REV-1&billId=BILL-2&room=B212&lineUserId=Utenant';
		const parsed = __testables.parsePostbackData(postbackData);
		const event = {
			type: 'postback',
			replyToken: 'reply-token',
			webhookEventId: 'event-id',
			source: {
				type: 'group',
				groupId: 'Cmanager',
				userId: 'Ustaff'
			},
			postback: { data: postbackData }
		};

		const payload = __testables.buildPayReviewAcceptForwardPayload(
			parsed,
			event,
			postbackData,
			'2026-06-25T04:00:00.000Z'
		) as Record<string, any>;

		expect(parsed).toMatchObject({
			act: 'PAY_REVIEW_ACCEPT',
			reviewId: 'REV-1',
			billId: 'BILL-2',
			room: 'B212',
			lineUserId: 'Utenant'
		});
		expect(payload).toMatchObject({
			source: 'line_postback',
			channel: 'payment_review',
			intent: 'pay_review_accept',
			action: 'PAY_REVIEW_ACCEPT',
			reviewId: 'REV-1',
			billId: 'BILL-2',
			room: 'B212',
			lineUserId: 'Utenant',
			clickedByUserId: 'Ustaff',
			chatId: 'Cmanager',
			postbackData
		});
		expect(payload.data.action).toBe('PAY_REVIEW_ACCEPT');
		expect(payload.events[0].postback.data).toBe(postbackData);
	});

	it('uses dedicated payment review accept webhook URL', () => {
		expect(__testables.getPayReviewAcceptWebhookUrl({})).toBe(
			'https://n8n.srv1112305.hstgr.cloud/webhook/approve-review-queue'
		);
		expect(__testables.getPayReviewAcceptWebhookUrl({
			N8N_PAY_REVIEW_ACCEPT_URL: 'https://example.com/approve-review'
		})).toBe('https://example.com/approve-review');
	});

	it('keeps pay-rent trigger worker-owned and n8n-only', () => {
		expect(__testables.PAY_RENT_SLIP_PROMPT).toBe('โปรดส่งสลิปได้เลยค่ะ');
		expect(__testables.getN8nPayRentUrl({
			N8N_PAYRENT_URL: 'https://example.com/pay-rent',
			PAYRENT_GAS_URL: 'https://script.google.com/macros/s/legacy/exec'
		})).toBe('https://example.com/pay-rent');
		expect(__testables.getN8nPayRentUrl({
			PAYRENT_GAS_URL: 'https://script.google.com/macros/s/legacy/exec'
		})).toBe('');
	});

	it('uses MM_WORKER_SECRET as the forward secret fallback', () => {
		expect(__testables.getWorkerForwardSecret({
			MM_WORKER_SECRET: 'test123'
		})).toBe('test123');
		expect(__testables.getWorkerForwardSecret({
			WORKER_SECRET: 'primary',
			MM_WORKER_SECRET: 'fallback'
		})).toBe('primary');
	});

	it('forwards legacy MM webhook with MM_WORKER_SECRET fallback', async () => {
		const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(JSON.stringify({ ok: true }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			})
		);

		try {
			const ok = await __testables.forwardToGas({
				MM_WEBHOOK_URL: 'https://example.com/mm-webhook',
				MM_WORKER_SECRET: 'test123'
			}, {
				events: [{ type: 'message' }]
			});

			expect(ok).toBe(true);
			expect(fetchMock).toHaveBeenCalledOnce();
			const [url, init] = fetchMock.mock.calls[0];
			expect(url).toBe('https://example.com/mm-webhook');
			expect(init?.method).toBe('POST');
			expect((init?.headers as Record<string, string>)['X-Worker-Secret']).toBe('test123');
			expect(JSON.parse(String(init?.body))).toMatchObject({
				workerSecret: 'test123',
				events: [{ type: 'message' }]
			});
		} finally {
			fetchMock.mockRestore();
		}
	});

	it('does not mask explicit reservation GAS JSON failures', async () => {
		const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			})
		);

		try {
			const ok = await __testables.forwardToSpecificGas({
				MM_WORKER_SECRET: 'wrong-secret'
			}, 'https://example.com/reservation-gas', {
				events: [{ type: 'message' }]
			});

			expect(ok).toBe(false);
			expect(fetchMock).toHaveBeenCalledOnce();
		} finally {
			fetchMock.mockRestore();
		}
	});

	it('acknowledges fresh and repeated booking codes before state work and forwards canonical text to reservation GAS', async () => {
		const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(JSON.stringify({ ok: true }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			})
		);
		const bookingEvent = {
			type: 'message',
			replyToken: 'reply-token-booking',
			webhookEventId: 'event-booking-code',
			timestamp: Date.now(),
			source: {
				type: 'user',
				userId: 'Ubooking'
			},
			message: {
				type: 'text',
				id: 'message-booking-code',
				text: '\u200B＃ＭＭ ５２２\u2060'
			}
		};
		const repeatedBookingEvent = {
			...bookingEvent,
			replyToken: 'reply-token-booking-repeat',
			webhookEventId: 'event-booking-code-repeat',
			message: {
				...bookingEvent.message,
				id: 'message-booking-code-repeat',
				text: '#mm522'
			}
		};
		const mockEnv = {
			...env,
			LINE_ACCESS_TOKEN: 'line-token',
			LINE_CHANNEL_SECRET: 'line-secret',
			CONFIRMBOOKING_URL: 'https://example.com/reservation-gas',
			MM_WORKER_SECRET: 'test123',
			N8N_CHAT_LOG_URL: 'https://example.com/chat-log'
		};

		try {
			const bodyText = JSON.stringify({ events: [bookingEvent, repeatedBookingEvent] });
			const signatureKey = await crypto.subtle.importKey(
				'raw',
				new TextEncoder().encode('line-secret'),
				{ name: 'HMAC', hash: 'SHA-256' },
				false,
				['sign']
			);
			const signatureBuffer = await crypto.subtle.sign(
				'HMAC',
				signatureKey,
				new TextEncoder().encode(bodyText)
			);
			const signature = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)));
			const request = new Request<unknown, IncomingRequestCfProperties>('http://example.com/webhook', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					'x-line-signature': signature
				},
				body: bodyText
			});
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, mockEnv, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(200);
			const replyCallIndex = fetchMock.mock.calls.findIndex(([url]) =>
				String(url).includes('/v2/bot/message/reply')
			);
			const gasCallIndex = fetchMock.mock.calls.findIndex(([url]) =>
				String(url) === 'https://example.com/reservation-gas'
			);
			const replyCalls = fetchMock.mock.calls.filter(([url]) =>
				String(url).includes('/v2/bot/message/reply')
			);
			const gasCalls = fetchMock.mock.calls.filter(([url]) =>
				String(url) === 'https://example.com/reservation-gas'
			);
			expect(replyCallIndex).toBeGreaterThanOrEqual(0);
			expect(gasCallIndex).toBeGreaterThanOrEqual(0);
			expect(replyCallIndex).toBeLessThan(gasCallIndex);
			expect(replyCalls).toHaveLength(2);
			expect(gasCalls).toHaveLength(2);

			const replyBody = JSON.parse(String(fetchMock.mock.calls[replyCallIndex][1]?.body));
			expect(replyBody.replyToken).toBe('reply-token-booking');
			expect(replyBody.messages[0].text).toContain('#MM522');
			for (const gasCall of gasCalls) {
				const gasBody = JSON.parse(String(gasCall[1]?.body));
				expect(gasBody.workerSecret).toBe('test123');
				expect(gasBody.events[0].message.text).toBe('#MM522');
			}
		} finally {
			fetchMock.mockRestore();
		}
	});

	it('pushes an explicit fallback when reservation GAS rejects a booking code', async () => {
		const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
			const url = String(input);
			if (url === 'https://example.com/reservation-gas') {
				return new Response(JSON.stringify({ ok: false, error: 'temporary_failure' }), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				});
			}
			return new Response(JSON.stringify({ ok: true }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		});
		const bookingEvent = {
			type: 'message',
			replyToken: 'reply-token-booking-failure',
			webhookEventId: 'event-booking-code-failure',
			timestamp: Date.now(),
			source: { type: 'user', userId: 'Ubookingfailure' },
			message: { type: 'text', id: 'message-booking-code-failure', text: '#MM523' }
		};
		const mockEnv = {
			...env,
			LINE_ACCESS_TOKEN: 'line-token',
			LINE_CHANNEL_SECRET: 'line-secret',
			CONFIRMBOOKING_URL: 'https://example.com/reservation-gas',
			MM_WORKER_SECRET: 'test123',
			N8N_CHAT_LOG_URL: 'https://example.com/chat-log'
		};

		try {
			const bodyText = JSON.stringify({ events: [bookingEvent] });
			const signatureKey = await crypto.subtle.importKey(
				'raw',
				new TextEncoder().encode('line-secret'),
				{ name: 'HMAC', hash: 'SHA-256' },
				false,
				['sign']
			);
			const signatureBuffer = await crypto.subtle.sign(
				'HMAC',
				signatureKey,
				new TextEncoder().encode(bodyText)
			);
			const signature = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)));
			const request = new Request<unknown, IncomingRequestCfProperties>('http://example.com/webhook', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					'x-line-signature': signature
				},
				body: bodyText
			});
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, mockEnv, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(200);
			const pushCall = fetchMock.mock.calls.find(([url]) =>
				String(url).includes('/v2/bot/message/push')
			);
			expect(pushCall).toBeTruthy();
			const pushBody = JSON.parse(String(pushCall?.[1]?.body));
			expect(pushBody.to).toBe('Ubookingfailure');
			expect(pushBody.messages[0].text).toContain('#MM523');
			expect(pushBody.messages[0].text).toContain('ระบบตรวจสอบการจองขัดข้อง');
		} finally {
			fetchMock.mockRestore();
		}
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

	it('builds a room-specific cleaning management acknowledgement', () => {
		expect(__testables.buildCleaningManagementAckText('a101')).toBe(
			'รับคำสั่งทำความสะอาดห้อง A101 แล้วค่ะ กำลังส่งงานให้ทีมทำความสะอาด'
		);
	});

	it('normalizes cleaning payment reasons to dedicated action key', () => {
		expect(__testables.normalizePenaltyReason('จ่ายค่าทำความสะอาด')).toBe('CLEANING_PAYMENT');
		expect(__testables.normalizePenaltyReason('ชำระค่าทำความสะอาด')).toBe('CLEANING_PAYMENT');
	});

	it('groups optional payment services together and removes checkout payment', () => {
		const flex = __testables.buildPaymentOptionsFlex() as Record<string, any>;
		const serialized = JSON.stringify(flex);
		const sections = flex.contents.body.contents.slice(1) as Array<Record<string, any>>;
		const firstSection = JSON.stringify(sections[0]);
		const secondSection = JSON.stringify(sections[1]);

		expect(sections).toHaveLength(2);
		expect(sections[0].contents[0].text).toBe('ชำระบิลทั่วไป');
		expect(sections[1].contents[0].text).toBe('บริการเพิ่มเติม / เช่าเพิ่ม');
		expect(serialized).toContain('ลืม/ทำกุญแจหาย');
		expect(serialized).toContain('เช่ากุญแจเพิ่ม');
		expect(serialized).toContain('#DC2626');
		expect(serialized).toContain('#2563EB');
		expect(serialized).toContain('"text":"ชำระค่าลืมกุญแจ"');
		expect(serialized).toContain('"text":"เช่ากุญแจเพิ่ม"');
		expect(serialized).not.toContain('"text":"ชำระค่าเช่ากุญแจ"');
		expect(firstSection).not.toContain('ชำระค่าทำความสะอาด');
		expect(secondSection.indexOf('ชำระค่าทำความสะอาด')).toBeLessThan(secondSection.indexOf('ชำระค่าเช่าที่จอดรถ'));
		expect(secondSection.indexOf('ชำระค่าเช่าที่จอดรถ')).toBeLessThan(secondSection.indexOf('เช่ากุญแจเพิ่ม'));
		expect(serialized).not.toContain('ชำระค่าเช็คเอาท์');
		expect(serialized).not.toContain('ย้ายออกและเช็คเอาท์');
	});

	it('routes new key payment menu text to the same payment reasons', () => {
		expect(__testables.detectPresetOtherPaymentReason('ลืม/ทำกุญแจหาย')).toBe('KEY_FORGOT');
		expect(__testables.detectPresetOtherPaymentReason('เช่ากุญแจเพิ่ม')).toBe('KEY_RENT');
		expect(__testables.detectPresetOtherPaymentReason('ชำระค่าลืมกุญแจ')).toBe('KEY_FORGOT');
		expect(__testables.detectPresetOtherPaymentReason('ชำระค่าเช่ากุญแจ')).toBe('KEY_RENT');
	});

	it('maps internal payment reasons to Thai labels', () => {
		expect(__testables.paymentReasonLabel('KEY_RENT')).toBe('ค่าเช่ากุญแจ/คีย์การ์ดเพิ่ม');
		expect(__testables.paymentReasonLabel('KEY_FORGOT')).toBe('ค่าลืม/ทำกุญแจหาย');
		expect(__testables.paymentReasonLabel('CLEANING_PAYMENT')).toBe('ค่าทำความสะอาด');
	});

	it('clears all user payment states when starting a new payment flow', () => {
		const keys = __testables.getPaymentStateKeys({
			source: {
				type: 'user',
				userId: 'Utenant'
			}
		}) as string[];

		expect(keys).toContain('Utenant:Utenant:penalty_flow');
		expect(keys).toContain('Utenant:Utenant:payrent_flow');
		expect(keys).toContain('Utenant:Utenant:keyrent_flow');
		expect(keys).toContain('Utenant:Utenant:checkout_cash_flow');
		expect(keys).toContain('bill-manual:payment:Utenant');
	});

	it('uses OTHERS as the generic penalty slip type while preserving typed categories', () => {
		expect(__testables.normalizePenaltySlipType('penalty')).toBe('OTHERS');
		expect(__testables.normalizePenaltySlipType('Others_payment')).toBe('Others_payment');
		expect(__testables.normalizePenaltySlipReason('penalty', 'จอดรถ')).toBe('OTHERS');
		expect(__testables.normalizePenaltySlipReason('Others_payment', 'ชำระค่าทำความสะอาด')).toBe('CLEANING_PAYMENT');
		expect(__testables.normalizePenaltyFlowReason('จอดรถ')).toBe('จอดรถ');
		expect(__testables.normalizePenaltyFlowReason('ชำระค่าทำความสะอาด')).toBe('CLEANING_PAYMENT');
	});

	it('keeps key-forgot payment slips on the legacy Others_Slip webhook contract', () => {
		const envConfig = {
			N8N_KEY_FORGOT_WEBHOOK_URL: 'https://example.com/key-forgot',
			PENALTY_WEBHOOK_URL: 'https://example.com/penalty'
		};

		expect(__testables.getPenaltyWebhook(envConfig)).toBe('https://example.com/penalty');
		expect(__testables.getPenaltyWebhook(envConfig, 'key_forgot')).toBe('https://example.com/penalty');
		expect(__testables.normalizePenaltySlipType('Others_payment')).toBe('Others_payment');
		expect(__testables.normalizePenaltySlipReason('Others_payment', 'KEY_FORGOT')).toBe('KEY_FORGOT');
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

	it('builds 10-minute bill manual payment state from BILL_PAY_CLICK postback', () => {
		const postbackData = 'action=BILL_PAY_CLICK&billId=BILL-20260602-4821&room=A101';
		const parsed = __testables.parseQueryString(postbackData);
		const state = __testables.buildBillManualPaymentState(
			{
				type: 'postback',
				replyToken: 'reply-token',
				webhookEventId: 'event-id',
				timestamp: 1780403946983,
				source: {
					type: 'user',
					userId: 'Utenant'
				},
				postback: { data: postbackData }
			} as any,
			parsed,
			postbackData,
			Date.parse('2026-06-02T15:30:00.000Z')
		) as Record<string, any>;

		expect(__testables.isBillManualPayClick(parsed)).toBe(true);
		expect(__testables.getBillManualPaymentStateKey('Utenant')).toBe('bill-manual:payment:Utenant');
		expect(__testables.BILL_MANUAL_PAYMENT_TTL_SECONDS).toBe(600);
		expect(state).toMatchObject({
			source: 'LINE_WORKER',
			stateType: 'bill_manual_payment',
			action: 'BILL_PAY_CLICK',
			lineUserId: 'Utenant',
			chatId: 'Utenant',
			sourceType: 'user',
			replyToken: 'reply-token',
			postbackData,
			billId: 'BILL-20260602-4821',
			room: 'A101',
			timestamp: 1780403946983,
			clickedAt: '2026-06-02T15:30:00.000Z',
			expiresAt: '2026-06-02T15:40:00.000Z',
			webhookEventId: 'event-id'
		});
	});

	it('builds bill manual slip webhook payload from active KV state', () => {
		const state = {
			action: 'BILL_PAY_CLICK',
			lineUserId: 'Utenant',
			billId: 'BILL-20260602-4821',
			room: 'A101',
			postbackData: 'action=BILL_PAY_CLICK&billId=BILL-20260602-4821&room=A101',
			clickedAt: '2026-06-02T15:30:00.000Z',
			expiresAt: '2026-06-02T15:40:00.000Z'
		};
		const payload = __testables.buildBillManualSlipPayload(
			{
				type: 'message',
				replyToken: 'reply-token',
				timestamp: 1780404246983,
				source: {
					type: 'user',
					userId: 'Utenant'
				},
				message: {
					type: 'image',
					id: 'image-message-id'
				}
			} as any,
			state,
			'2026-06-02T15:35:00.000Z'
		) as Record<string, any>;

		expect(payload).toMatchObject({
			source: 'LINE_WORKER',
			eventType: 'image',
			action: 'BILL_SLIP_RECEIVED',
			lineUserId: 'Utenant',
			chatId: 'Utenant',
			sourceType: 'user',
			replyToken: 'reply-token',
			imageMessageId: 'image-message-id',
			timestamp: 1780404246983,
			receivedAt: '2026-06-02T15:35:00.000Z',
			billId: 'BILL-20260602-4821',
			room: 'A101',
			clickedAt: '2026-06-02T15:30:00.000Z',
			expiresAt: '2026-06-02T15:40:00.000Z',
			postbackData: 'action=BILL_PAY_CLICK&billId=BILL-20260602-4821&room=A101'
		});
		expect(payload.event.message.id).toBe('image-message-id');
	});

	it('uses bill-manual n8n webhook URL by default and env override when provided', () => {
		expect(__testables.getN8nBillManualWebhookUrl({} as any)).toBe(
			'https://n8n.srv1112305.hstgr.cloud/webhook/bill-manual-received'
		);
		expect(__testables.getN8nBillManualWebhookUrl({
			N8N_BILL_MANUAL_WEBHOOK_URL: 'https://example.com/custom-bill-manual'
		} as any)).toBe('https://example.com/custom-bill-manual');
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

	it('does not let another user key-rent photo state capture a checkin slip', () => {
		const state = {
			mode: 'WAITING_KEY_PHOTO',
			startedByUserId: 'U-key-rent-manager'
		};

		expect(__testables.isKeyRentWaitingPhotoStateForUser(state, 'U-checkin-manager')).toBe(false);
		expect(__testables.isKeyRentWaitingPhotoStateForUser(state, 'U-key-rent-manager')).toBe(true);
	});

	it('keeps checkin slip state active for 30 minutes', () => {
		const now = Date.now();
		expect(__testables.isCheckinFlowStateActive({ ts: now - (2 * 60 * 1000) }, now)).toBe(true);
		expect(__testables.isCheckinFlowStateActive({ ts: now - (30 * 60 * 1000) }, now)).toBe(false);
		expect(__testables.isCheckinFlowStateActive(null, now)).toBe(false);
	});

	it('uses MM_WORKER_SECRET to authenticate checkin keycard webhook requests', () => {
		expect(__testables.getWorkerForwardSecret({
			MM_WORKER_SECRET: 'checkin-secret'
		} as any)).toBe('checkin-secret');
		expect(__testables.getWorkerForwardSecret({
			WORKER_SECRET: 'primary-secret',
			MM_WORKER_SECRET: 'fallback-secret'
		} as any)).toBe('primary-secret');
	});

	it('embeds LINE image data in checkin keycard photo payloads', async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = vi.fn(async () => new Response(
			new Uint8Array([1, 2, 3]),
			{ status: 200, headers: { 'content-type': 'image/png' } }
		)) as typeof fetch;

		try {
			const payload = await __testables.enrichCheckinKeycardPhotoPayload(
				{ LINE_ACCESS_TOKEN: 'line-token' } as any,
				{
					intent: 'checkin_keycard_photo',
					imageMessageId: 'image-message-id'
				}
			) as Record<string, any>;

			expect(payload.imageDataUrl).toBe('data:image/png;base64,AQID');
			expect(payload.imageContentType).toBe('image/png');
			expect(payload.image).toMatchObject({
				messageId: 'image-message-id',
				contentType: 'image/png',
				dataUrlField: 'imageDataUrl'
			});
			expect(globalThis.fetch).toHaveBeenCalledWith(
				'https://api-data.line.me/v2/bot/message/image-message-id/content',
				expect.objectContaining({
					headers: { Authorization: 'Bearer line-token' }
				})
			);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it('clears only the current user workflow states before starting checkin', async () => {
		const currentUserId = 'U-current';
		const otherUserId = 'U-other';
		const groupId = 'C-manager-group';
		const currentStateKey = `${groupId}:${currentUserId}`;
		const values = new Map<string, any>([
			[`active_flow:${currentUserId}`, { phase: 'await_slip' }],
			[`booking_flow:${currentUserId}`, { phase: 'await_id' }],
			[`checkin_flow:${currentUserId}`, { roomId: 'A101' }],
			[`bill-manual:payment:${currentUserId}`, { billId: 'BILL-1' }],
			[`reg_id:${currentUserId}`, { action: 'ask_roomid' }],
			[`changeLine:${currentUserId}`, { state: 'WAIT_ROOM' }],
			[`parking:outsider-phone:${currentUserId}`, { state: 'WAITING_PARKING_OUTSIDER_PHONE' }],
			[`${currentStateKey}:moveout_flow`, { step: 'confirm' }],
			[`${currentStateKey}:penalty_flow`, { reason: 'OTHERS' }],
			[`${currentStateKey}:payrent_flow`, { ts: Date.now() }],
			[`${currentStateKey}:keyrent_flow`, { ts: Date.now() }],
			[`checkin:keycard:waiting-photo:user:${currentUserId}`, { managerUserId: currentUserId }],
			[`checkin:keycard:waiting-photo:${groupId}:${currentUserId}`, { managerUserId: currentUserId }],
			[`checkin:keycard:waiting-photo:${groupId}:_latest`, { managerUserId: currentUserId }],
			[`keyrent:waiting-photo:${groupId}`, { startedByUserId: currentUserId }],
			[`active_flow:${otherUserId}`, { phase: 'await_slip' }]
		]);
		const mockEnv = {
			KV: {
				get: async (key: string) => values.get(key) ?? null,
				delete: async (key: string) => {
					values.delete(key);
				}
			}
		};
		const event = {
			source: {
				type: 'group',
				groupId,
				userId: currentUserId
			}
		};

		const clearedKeys = await __testables.clearUserWorkflowStatesForCheckin(mockEnv, event);

		expect(clearedKeys).toContain(`active_flow:${currentUserId}`);
		expect(clearedKeys).toContain(`checkin:keycard:waiting-photo:${groupId}:_latest`);
		expect(clearedKeys).toContain(`keyrent:waiting-photo:${groupId}`);
		expect(values.has(`active_flow:${currentUserId}`)).toBe(false);
		expect(values.has(`active_flow:${otherUserId}`)).toBe(true);
	});

	it('does not clear a group payment state owned by another sender', async () => {
		const currentUserId = 'U-current';
		const otherUserId = 'U-other';
		const groupId = 'C-manager-group';
		const currentStateKey = `${groupId}:${currentUserId}`;
		const groupPaymentKey = `checkout2:waiting-slip:${groupId}`;
		const values = new Map<string, any>([
			[`${currentStateKey}:payrent_flow`, { ts: Date.now(), userId: currentUserId }],
			[groupPaymentKey, { ts: Date.now(), userId: otherUserId, reason: 'CHECKOUT2' }]
		]);
		const mockEnv = {
			KV: {
				get: async (key: string) => values.get(key) ?? null,
				delete: async (key: string) => {
					values.delete(key);
				}
			}
		};
		const event = {
			source: {
				type: 'group',
				groupId,
				userId: currentUserId
			}
		};

		const clearedKeys = await __testables.clearUserWorkflowStatesForEvent(
			mockEnv,
			event,
			'new_command'
		);

		expect(clearedKeys).not.toContain(groupPaymentKey);
		expect(values.has(`${currentStateKey}:payrent_flow`)).toBe(false);
		expect(values.get(groupPaymentKey)).toMatchObject({ userId: otherUserId });
	});

	it('clears stale image commands before starting a key-forgot payment', async () => {
		const userId = 'U-tenant';
		const stateKey = `${userId}:${userId}`;
		const values = new Map<string, any>([
			[`active_flow:${userId}`, { flowType: 'reservation', phase: 'await_slip' }],
			[`booking_flow:${userId}`, { phase: 'await_slip' }],
			[`checkin_flow:${userId}`, { roomId: 'B206', ts: Date.now() }],
			[`${stateKey}:payrent_flow`, { ts: Date.now() }],
			[`${stateKey}:keyrent_flow`, { ts: Date.now() }],
			[`${stateKey}:checkout_cash_flow`, { ts: Date.now() }],
			[`bill-manual:payment:${userId}`, { billId: 'BILL-1' }]
		]);
		const mockEnv = {
			KV: {
				get: async (key: string) => values.get(key) ?? null,
				delete: async (key: string) => {
					values.delete(key);
				}
			}
		};
		const event = { source: { type: 'user', userId } };

		const clearedKeys = await __testables.clearUserWorkflowStatesForEvent(
			mockEnv,
			event,
			'key_forgot'
		);

		expect(clearedKeys).toContain(`active_flow:${userId}`);
		expect(clearedKeys).toContain(`booking_flow:${userId}`);
		expect(clearedKeys).toContain(`checkin_flow:${userId}`);
		expect(clearedKeys).toContain(`${stateKey}:checkout_cash_flow`);
		expect(values.size).toBe(0);
	});

	it('makes reservation confirmation replace stale payment image commands', async () => {
		const userId = 'U-booking';
		const stateKey = `${userId}:${userId}`;
		const values = new Map<string, any>([
			[`${stateKey}:payrent_flow`, { ts: Date.now() }],
			[`${stateKey}:penalty_flow`, { ts: Date.now(), reason: 'KEY_FORGOT' }],
			[`checkin_flow:${userId}`, { ts: Date.now(), roomId: 'A312' }]
		]);
		const mockEnv = {
			KV: {
				get: async (key: string) => {
					const value = values.get(key) ?? null;
					return typeof value === 'string' ? JSON.parse(value) : value;
				},
				put: async (key: string, value: string) => {
					values.set(key, value);
				},
				delete: async (key: string) => {
					values.delete(key);
				}
			}
		};
		const event = { source: { type: 'user', userId } };

		const flow = await __testables.replaceWithReservationFlow(mockEnv, event, {
			phase: 'await_slip',
			code: '#MM519'
		}) as Record<string, any>;

		expect(values.has(`${stateKey}:payrent_flow`)).toBe(false);
		expect(values.has(`${stateKey}:penalty_flow`)).toBe(false);
		expect(values.has(`checkin_flow:${userId}`)).toBe(false);
		expect(flow).toMatchObject({
			flowType: 'reservation',
			phase: 'await_slip',
			code: '#MM519',
			scopeType: 'user',
			userId
		});
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
		expect(__testables.requiresCoAdminShortcutPermission(shortcut)).toBe(false);
		expect(__testables.isCoAdminAllowedLineUserId('U-not-on-admin-list')).toBe(false);
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

	it('falls back to the group CHECKOUT2 slip state when the image sender key is unavailable', () => {
		const now = 1784118600000;
		const groupEvent = {
			source: {
				type: 'group',
				groupId: 'C-manager-group'
			}
		};
		const groupFlow = {
			ts: now - 1000,
			chatId: 'C-manager-group',
			userId: 'U-manager',
			type: 'Others_payment',
			reason: 'CHECKOUT2',
			categories: 'CHECKOUT2',
			roomId: 'A101'
		};

		expect(__testables.getCheckout2GroupWaitingSlipKey(groupEvent)).toBe(
			'checkout2:waiting-slip:C-manager-group'
		);
		expect(__testables.selectPenaltyFlowForImage(null, groupFlow, 'C-manager-group', now)).toMatchObject({
			flow: groupFlow,
			active: true,
			directActive: false,
			checkout2GroupActive: true
		});
		expect(__testables.selectPenaltyFlowForImage(null, groupFlow, 'C-other-group', now).active).toBe(false);
	});

	it('arms regular checkout transfer under both user and group keys', async () => {
		const values = new Map<string, string>();
		const mockEnv = {
			KV: {
				get: async (key: string, type?: string) => {
					const value = values.get(key) ?? null;
					return type === 'json' && value ? JSON.parse(value) : value;
				},
				put: async (key: string, value: string) => {
					values.set(key, value);
				},
				delete: async (key: string) => {
					values.delete(key);
				}
			}
		};
		const event = {
			source: {
				type: 'group',
				groupId: 'C-manager-group',
				userId: 'U-manager'
			}
		};

		const result = await __testables.armCheckoutTransferSlipFlow(mockEnv, event, {
			reason: 'CHECKOUT',
			roomId: 'A101'
		}) as Record<string, any>;

		expect(result.flow).toMatchObject({
			chatId: 'C-manager-group',
			userId: 'U-manager',
			type: 'Others_payment',
			reason: 'CHECKOUT',
			categories: 'CHECKOUT',
			roomId: 'A101'
		});
		expect(JSON.parse(values.get('C-manager-group:U-manager:penalty_flow') || '{}')).toMatchObject({
			reason: 'CHECKOUT',
			roomId: 'A101'
		});
		expect(JSON.parse(values.get('checkout2:waiting-slip:C-manager-group') || '{}')).toMatchObject({
			reason: 'CHECKOUT',
			roomId: 'A101'
		});
	});

	it('parses CHECKOUT2 payment text with a room id', () => {
		expect(__testables.parseCheckoutPaymentText('ชำระค่าเช็คเอาท์สอง a101')).toMatchObject({
			reason: 'CHECKOUT2',
			roomId: 'A101'
		});
		expect(__testables.parseCheckoutPaymentText('จ่ายค่าcheckout2 room B514')).toMatchObject({
			reason: 'CHECKOUT2',
			roomId: 'B514'
		});
		expect(__testables.parseCheckoutPaymentText('ชำระค่าเช็คเอาท์ A202')).toMatchObject({
			reason: 'CHECKOUT',
			roomId: 'A202'
		});
		expect(__testables.parseCheckoutPaymentText('ชำระค่าเช็คเอาท์สอง')).toMatchObject({
			reason: 'CHECKOUT2',
			roomId: ''
		});
	});

	it('arms checkout cash flow from postback button data and captures amount/image payload', () => {
		const postbackData = 'act=CHECKOUT_CASH&roomId=A101&lineUserId=Utenant';
		const data = __testables.parseQueryString(postbackData);
		const event = {
			type: 'postback',
			replyToken: 'reply-token',
			webhookEventId: 'event-postback',
			source: {
				type: 'group',
				groupId: 'CcheckoutGroup',
				userId: 'Uoperator'
			},
			postback: { data: postbackData }
		};
		const imageEvent = {
			type: 'message',
			replyToken: 'reply-token-2',
			webhookEventId: 'event-image',
			source: {
				type: 'group',
				groupId: 'CcheckoutGroup',
				userId: 'Uoperator'
			},
			message: {
				type: 'image',
				id: 'image-message-id'
			}
		};

		const flow = __testables.buildCheckoutCashFlowState(data, event, postbackData, 123456) as Record<string, any>;
		const nextFlow = __testables.buildCheckoutCashAmountState(flow, 1500, 123999) as Record<string, any>;
		const payload = __testables.buildCheckoutCashImagePayload(
			imageEvent,
			nextFlow,
			'2026-06-16T10:00:00.000Z'
		) as Record<string, any>;

		expect(__testables.isCheckoutCashPaymentPostback(data)).toBe(true);
		expect(flow).toMatchObject({
			mode: 'WAIT_CHECKOUT_CASH_AMOUNT',
			ts: 123456,
			chatId: 'CcheckoutGroup',
			userId: 'Uoperator',
			tenantLineUserId: 'Utenant',
			roomId: 'A101',
			action: 'CHECKOUT_CASH',
			checkoutType: 'CHECKOUT',
			categories: 'CHECKOUT',
			paymentMethod: 'CASH',
			postbackData
		});
		expect(__testables.parseCheckoutCashAmount('1500')).toBe(1500);
		expect(__testables.parseCheckoutCashAmount('1,500 บาท')).toBe(1500);
		expect(__testables.parseCheckoutCashAmount('abc')).toBe(null);
		expect(nextFlow).toMatchObject({
			mode: 'WAIT_CHECKOUT_CASH_IMAGE',
			amount: 1500,
			amountText: '1,500',
			ts: 123999
		});
		expect(payload).toMatchObject({
			source: 'line_message',
			intent: 'checkout_cash_payment_image',
			action: 'CHECKOUT_CASH',
			channel: 'checkout_cash',
			checkoutType: 'CHECKOUT',
			categories: 'CHECKOUT',
			paymentMethod: 'CASH',
			roomId: 'A101',
			room: 'A101',
			amount: 1500,
			amountText: '1,500',
			tenantLineUserId: 'Utenant',
			lineUserId: 'Uoperator',
			operatorLineUserId: 'Uoperator',
			chatId: 'CcheckoutGroup',
			sourceType: 'group',
			imageMessageId: 'image-message-id',
			postbackData,
			webhookEventId: 'event-image',
			receivedAt: '2026-06-16T10:00:00.000Z'
		});
	});

	it('routes CHECKOUT_CASH2 through checkout cash flow with CHECKOUT2 labels', () => {
		const postbackData = 'act=CHECKOUT_CASH2&roomId=A202&lineUserId=Utenant2';
		const data = __testables.parseQueryString(postbackData);
		const event = {
			type: 'postback',
			replyToken: 'reply-token',
			webhookEventId: 'event-postback-2',
			source: {
				type: 'group',
				groupId: 'CcheckoutGroup',
				userId: 'Uoperator'
			},
			postback: { data: postbackData }
		};
		const imageEvent = {
			type: 'message',
			replyToken: 'reply-token-3',
			webhookEventId: 'event-image-2',
			source: {
				type: 'group',
				groupId: 'CcheckoutGroup',
				userId: 'Uoperator'
			},
			message: {
				type: 'image',
				id: 'image-message-id-2'
			}
		};

		const flow = __testables.buildCheckoutCashFlowState(data, event, postbackData, 223456) as Record<string, any>;
		const nextFlow = __testables.buildCheckoutCashAmountState(flow, 2500, 223999) as Record<string, any>;
		const payload = __testables.buildCheckoutCashImagePayload(
			imageEvent,
			nextFlow,
			'2026-06-17T10:00:00.000Z'
		) as Record<string, any>;

		expect(__testables.isCheckoutCashPaymentPostback(data)).toBe(true);
		expect(flow).toMatchObject({
			mode: 'WAIT_CHECKOUT_CASH_AMOUNT',
			chatId: 'CcheckoutGroup',
			userId: 'Uoperator',
			tenantLineUserId: 'Utenant2',
			roomId: 'A202',
			action: 'CHECKOUT_CASH2',
			checkoutType: 'CHECKOUT2',
			categories: 'CHECKOUT2',
			paymentMethod: 'CASH',
			postbackData
		});
		expect(payload).toMatchObject({
			source: 'line_message',
			intent: 'checkout_cash_payment_image',
			action: 'CHECKOUT_CASH2',
			channel: 'checkout_cash',
			checkoutType: 'CHECKOUT2',
			categories: 'CHECKOUT2',
			paymentMethod: 'CASH',
			roomId: 'A202',
			room: 'A202',
			amount: 2500,
			amountText: '2,500',
			tenantLineUserId: 'Utenant2',
			lineUserId: 'Uoperator',
			operatorLineUserId: 'Uoperator',
			chatId: 'CcheckoutGroup',
			sourceType: 'group',
			imageMessageId: 'image-message-id-2',
			postbackData,
			webhookEventId: 'event-image-2',
			receivedAt: '2026-06-17T10:00:00.000Z'
		});
	});

	it('uses dedicated checkout cash webhook before penalty fallback', () => {
		expect(__testables.getCheckoutCashWebhook({
			N8N_CHECKOUT_CASH_WEBHOOK_URL: 'https://example.com/checkout-cash',
			PENALTY_WEBHOOK_URL: 'https://example.com/penalty'
		})).toBe('https://example.com/checkout-cash');
		expect(__testables.getCheckoutCashWebhook({
			N8N_CHECKOUT_CASH_WEBHOOK_URL: 'https://example.com/checkout-cash',
			N8N_CHECKOUT_CASH2_WEBHOOK_URL: 'https://example.com/co-admin-cash-receiver',
			PENALTY_WEBHOOK_URL: 'https://example.com/penalty'
		}, { action: 'CHECKOUT_CASH2' })).toBe('https://example.com/co-admin-cash-receiver');
		expect(__testables.getCheckoutCashWebhook({
			PENALTY_WEBHOOK_URL: 'https://example.com/penalty'
		})).toBe('https://example.com/penalty');
		expect(__testables.getCheckoutCashWebhook({}, { action: 'CHECKOUT_CASH2' }))
			.toBe('https://n8n.srv1112305.hstgr.cloud/webhook/co-admin-cash-receiver');
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
		expect(__testables.requiresCoAdminShortcutPermission(coOutcomeShortcut)).toBe(true);
		expect(__testables.requiresCoAdminShortcutPermission(doneShortcut)).toBe(true);
		expect(__testables.requiresCoAdminShortcutPermission(statusShortcut)).toBe(true);
		expect(__testables.requiresCoAdminShortcutPermission(readyShortcut)).toBe(true);
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

	it('classifies every workflow-starting text command as a state replacement', () => {
		const examples = [
			['คีย์ A301 100', 'key_forgot'],
			['#MM521', 'booking_code'],
			['#pb123', 'prebook_code'],
			['ชำระค่าเช่าห้อง', 'pay_rent'],
			['ลงทะเบียนไอดี', 'registration'],
			['เปลี่ยนไอดีผู้เช่า', 'tenant_id_change']
		];

		for (const [text, kind] of examples) {
			expect(__testables.classifyTextCommand(text)).toMatchObject({
				kind,
				statePolicy: __testables.TEXT_COMMAND_REPLACE_FLOW
			});
		}
	});

	it('normalizes visually identical booking codes before command routing', () => {
		expect(__testables.normalizeCommandText('\u200B＃ＭＭ ５２１\u2060')).toBe('#MM 521');
		expect(__testables.parseBookingCodeCommand('\u200B＃ＭＭ ５２１\u2060')).toBe('#MM521');
		expect(__testables.classifyTextCommand('\u200B＃ＭＭ ５２１\u2060')).toMatchObject({
			kind: 'booking_code',
			statePolicy: __testables.TEXT_COMMAND_REPLACE_FLOW
		});
	});

	it('lets information keywords bypass a workflow without canceling it', () => {
		expect(__testables.classifyTextCommand('บริการที่จอดรถ')).toMatchObject({
			kind: 'parking_info',
			statePolicy: __testables.TEXT_COMMAND_BYPASS_FLOW
		});
		expect(__testables.classifyTextCommand('รหัส wifi', {
			fastReply: [{ type: 'text', text: 'wifi' }]
		})).toMatchObject({
			kind: 'quick_keyword',
			statePolicy: __testables.TEXT_COMMAND_BYPASS_FLOW
		});
		expect(__testables.classifyTextCommand('A301')).toBeNull();
	});

	it('allows states to consume only the exact input type they await', () => {
		const bookingRoute = __testables.classifyTextCommand('#MM521');

		expect(__testables.shouldTextStateConsumeInput(
			__testables.TEXT_STATE_CHECKOUT_AMOUNT,
			'1,500'
		)).toBe(true);
		expect(__testables.shouldTextStateConsumeInput(
			__testables.TEXT_STATE_CHECKOUT_AMOUNT,
			'คีย์ A301 100'
		)).toBe(false);
		expect(__testables.shouldTextStateConsumeInput(
			__testables.TEXT_STATE_CHECKOUT_IMAGE,
			'#MM521'
		)).toBe(false);
		expect(__testables.shouldTextStateConsumeInput(
			__testables.TEXT_STATE_PARKING_PHONE,
			'0812345678'
		)).toBe(true);
		expect(__testables.shouldTextStateConsumeInput(
			__testables.TEXT_STATE_REGISTRATION_ROOM,
			'A301'
		)).toBe(true);
		expect(__testables.shouldTextStateConsumeInput(
			__testables.TEXT_STATE_TENANT_CHANGE_ROOM,
			'B514'
		)).toBe(true);
		expect(__testables.shouldTextStateConsumeInput(
			__testables.TEXT_STATE_PENALTY_REASON,
			'เสียงดัง'
		)).toBe(true);
		expect(__testables.shouldTextStateConsumeInput(
			__testables.TEXT_STATE_PENALTY_REASON,
			'#MM521',
			bookingRoute
		)).toBe(false);
		expect(__testables.shouldTextStateConsumeInput(
			__testables.TEXT_STATE_PAYMENT_IMAGE,
			'ข้อความอะไรก็ได้'
		)).toBe(false);
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

	it('replies to วิธีจอง with the plain screening question', async () => {
		const messages = await __testables.quickKeywordReply('วิธีจอง', env, '') as Array<Record<string, any>>;

		expect(messages).toHaveLength(1);
		expect(messages[0].text).toBe('รบกวนสอบถามได้ไหมครับว่าตอนนี้ทำอาชีพอะไรอยู่ และต้องการเข้าอยู่เมื่อไหร่');
		expect(messages[0]).not.toHaveProperty('quickReply');
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

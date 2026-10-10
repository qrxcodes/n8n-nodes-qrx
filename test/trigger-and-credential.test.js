'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { QrxTrigger } = require('../dist/nodes/QrxTrigger/QrxTrigger.node.js');
const { QrxApi } = require('../dist/credentials/QrxApi.credentials.js');
const { code, pollContext } = require('./helpers');

const trigger = new QrxTrigger();
const list = (codes) => ({ object: 'list', data: codes, hasMore: false, nextCursor: null });

describe('QRX Trigger', () => {
	it('is a polling trigger with no inputs', () => {
		assert.equal(trigger.description.polling, true);
		assert.deepEqual(trigger.description.inputs, []);
		assert.equal(trigger.description.name, 'qrxTrigger');
	});

	it('returns the newest ready code when tested by hand', async () => {
		const context = pollContext({
			mode: 'manual',
			respond: () =>
				list([code({ id: 'new', status: 'processing', imageUrl: null }), code({ id: 'ready' })]),
		});
		const result = await trigger.poll.call(context);
		assert.deepEqual(
			result[0].map((i) => i.json.id),
			['ready'],
		);
		assert.equal(context.calls[0].url, '/v1/codes');
		assert.equal(context.calls[0].qs.limit, 100);
	});

	it('triggers once for each code that becomes ready after activation', async () => {
		const staticData = {};
		let codes = [
			code({ id: 'old2', createdAt: '2026-10-09T10:00:00.000Z' }),
			code({ id: 'old1', createdAt: '2026-10-09T09:00:00.000Z' }),
		];
		const poll = () => trigger.poll.call(pollContext({ staticData, respond: () => list(codes) }));

		// First poll only records where things stand.
		assert.equal(await poll(), null);
		assert.equal(staticData.since, '2026-10-09T10:00:00.000Z');

		// A new code starts processing: nothing yet.
		codes = [
			code({
				id: 'a',
				status: 'processing',
				imageUrl: null,
				createdAt: '2026-10-10T01:00:00.000Z',
			}),
			...codes,
		];
		assert.equal(await poll(), null);

		// It finishes and another one finishes too: both trigger, oldest first.
		codes = [
			code({ id: 'b', createdAt: '2026-10-10T02:00:00.000Z' }),
			code({ id: 'a', createdAt: '2026-10-10T01:00:00.000Z' }),
			...codes.slice(1),
		];
		const result = await poll();
		assert.deepEqual(
			result[0].map((i) => i.json.id),
			['a', 'b'],
		);

		// Nothing new: nothing triggers again.
		assert.equal(await poll(), null);
	});

	it('ignores failed codes and codes made before activation', async () => {
		const staticData = {};
		const processing = { status: 'processing', imageUrl: null };
		let codes = [
			code({ id: 'newest', ...processing, createdAt: '2026-10-09T10:00:00.000Z' }),
			code({ id: 'older', ...processing, createdAt: '2026-10-09T09:00:00.000Z' }),
		];
		const poll = () => trigger.poll.call(pollContext({ staticData, respond: () => list(codes) }));
		await poll();

		codes = [
			code({ id: 'bad', status: 'failed', imageUrl: null, createdAt: '2026-10-10T01:00:00.000Z' }),
			code({ id: 'newest', ...processing, createdAt: '2026-10-09T10:00:00.000Z' }),
			code({ id: 'older', createdAt: '2026-10-09T09:00:00.000Z' }),
		];
		assert.equal(await poll(), null);
	});

	it('can return the raw code', async () => {
		const raw = code({ id: 'ready' });
		const context = pollContext({
			mode: 'manual',
			params: { simplify: false },
			respond: () => list([raw]),
		});
		const result = await trigger.poll.call(context);
		assert.deepEqual(result[0][0].json, raw);
	});

	it('starts from an empty account', async () => {
		const staticData = {};
		let codes = [];
		const poll = () => trigger.poll.call(pollContext({ staticData, respond: () => list(codes) }));
		assert.equal(await poll(), null);
		codes = [code({ id: 'first' })];
		const result = await poll();
		assert.deepEqual(
			result[0].map((i) => i.json.id),
			['first'],
		);
	});
});

describe('QRX API credential', () => {
	const credential = new QrxApi();

	it('sends the key as a bearer token', () => {
		assert.equal(credential.name, 'qrxApi');
		assert.deepEqual(credential.authenticate, {
			type: 'generic',
			properties: { headers: { Authorization: '=Bearer {{$credentials.apiKey}}' } },
		});
		const apiKey = credential.properties.find((p) => p.name === 'apiKey');
		assert.equal(apiKey.typeOptions.password, true);
		assert.equal(apiKey.required, true);
	});

	it('is tested against the account endpoint', () => {
		assert.deepEqual(credential.test.request, {
			baseURL: 'https://qrx.codes',
			url: '/v1/account',
			method: 'GET',
		});
	});
});

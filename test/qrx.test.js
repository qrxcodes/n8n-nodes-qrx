'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { NodeApiError } = require('n8n-workflow');

const { Qrx } = require('../dist/nodes/Qrx/Qrx.node.js');
const { code, executeContext, fakeClock, httpError, problem } = require('./helpers');

const node = new Qrx();
const run = (context) => node.execute.call(context);

const createParams = (overrides = {}) => ({
	resource: 'code',
	operation: 'create',
	prompt: 'A lighthouse on a cliff at sunset',
	destination: ' https://example.com/menu ',
	waitForCompletion: true,
	timeout: 300,
	options: {},
	...overrides,
});

describe('description', () => {
	it('mentions a paid plan wherever changing a link is offered', () => {
		const operations = node.description.properties.find(
			(p) => p.name === 'operation' && p.displayOptions.show.resource[0] === 'code',
		);
		const changeLink = operations.options.find((o) => o.value === 'update');
		assert.equal(changeLink.name, 'Change Link');
		assert.match(changeLink.description, /on a paid plan/);
		const destination = node.description.properties.find(
			(p) => p.name === 'destination' && p.displayOptions.show.operation[0] === 'update',
		);
		assert.match(destination.description, /on a paid plan/);
	});

	it('uses the QRX API credential', () => {
		assert.deepEqual(node.description.credentials, [{ name: 'qrxApi', required: true }]);
	});
});

describe('Create', () => {
	let clock;
	afterEach(() => clock?.restore());

	it('returns the finished code from a single long-polled request', async () => {
		const context = executeContext({
			params: createParams({ options: { style: 'a64c5' } }),
			respond: () => code(),
		});
		const [[item]] = await run(context);

		assert.equal(context.calls.length, 1);
		const [call] = context.calls;
		assert.equal(call.credentialName, 'qrxApi');
		assert.equal(call.method, 'POST');
		assert.equal(call.baseURL, 'https://qrx.codes');
		assert.equal(call.url, '/v1/codes');
		assert.deepEqual(call.body, {
			prompt: 'A lighthouse on a cliff at sunset',
			destination: 'https://example.com/menu',
			style: 'a64c5',
		});
		assert.equal(call.qs.wait, 25);
		assert.match(call.headers['Idempotency-Key'], /^n8n-[0-9a-f-]{36}$/);
		assert.equal(item.json.status, 'succeeded');
		assert.deepEqual(item.pairedItem, { item: 0 });
		assert.equal(item.binary, undefined);
	});

	it('leaves out an empty style', async () => {
		const context = executeContext({
			params: createParams({ options: { style: '' } }),
			respond: () => code(),
		});
		await run(context);
		assert.equal('style' in context.calls[0].body, false);
	});

	it('keeps polling until the code finishes', async () => {
		clock = fakeClock();
		let polls = 0;
		const context = executeContext({
			params: createParams(),
			respond: (options) => {
				clock.advance(25_000); // each long poll holds for its full wait
				if (options.method === 'POST') return code({ status: 'processing', imageUrl: null });
				polls++;
				return polls < 3 ? code({ status: 'processing', imageUrl: null }) : code();
			},
		});
		const [[item]] = await run(context);

		assert.equal(item.json.status, 'succeeded');
		assert.deepEqual(
			context.calls.map((c) => `${c.method} ${c.url}`),
			['POST /v1/codes', 'GET /v1/codes/k7m2qz', 'GET /v1/codes/k7m2qz', 'GET /v1/codes/k7m2qz'],
		);
		assert.deepEqual(
			context.calls.map((c) => c.qs.wait),
			[25, 25, 25, 25],
		);
	});

	it('fails with the code id when the timeout runs out', async () => {
		clock = fakeClock();
		const context = executeContext({
			params: createParams({ timeout: 60 }),
			respond: (options) => {
				clock.advance(options.qs.wait * 1000);
				return code({ status: 'processing', imageUrl: null });
			},
		});

		await assert.rejects(run(context), (error) => {
			assert.match(error.message, /not ready after 60 seconds/);
			assert.match(error.description, /k7m2qz/);
			return true;
		});
		// 25 + 25 + 10 seconds of waiting, then the deadline.
		assert.deepEqual(
			context.calls.map((c) => c.qs.wait),
			[25, 25, 10],
		);
	});

	it('fails when the code fails', async () => {
		const context = executeContext({
			params: createParams(),
			respond: () =>
				code({ status: 'failed', imageUrl: null, error: { message: 'It did not scan' } }),
		});
		await assert.rejects(run(context), /could not make a QR code that scans: It did not scan/);
	});

	it('returns at once without waiting when asked', async () => {
		const context = executeContext({
			params: createParams({ waitForCompletion: false }),
			respond: () => code({ status: 'processing', imageUrl: null }),
		});
		const [[item]] = await run(context);
		assert.equal(context.calls.length, 1);
		assert.equal(context.calls[0].qs.wait, undefined);
		assert.equal(item.json.status, 'processing');
	});

	it('downloads the image into a binary property', async () => {
		const context = executeContext({
			params: createParams({ options: { downloadImage: true, binaryPropertyName: 'qr' } }),
			respond: () => code(),
		});
		const [[item]] = await run(context);
		assert.equal(context.downloads.length, 1);
		assert.equal(context.downloads[0].url, 'https://qrx.codes/media/premium/k7m2qz.png');
		assert.equal(context.downloads[0].encoding, 'arraybuffer');
		assert.equal(item.binary.qr.fileName, 'qrx-k7m2qz.png');
		assert.equal(item.binary.qr.mimeType, 'image/png');
	});

	it('retries a server error with the same idempotency key', async () => {
		const context = executeContext({
			params: createParams(),
			respond: (_options, n) => {
				if (n === 1) {
					throw httpError(
						503,
						problem(503, 'unavailable', 'Temporarily unavailable', 'Try again'),
						{
							'retry-after': '0.01',
						},
					);
				}
				return code();
			},
		});
		const [[item]] = await run(context);
		assert.equal(item.json.status, 'succeeded');
		assert.equal(context.calls.length, 2);
		assert.equal(
			context.calls[0].headers['Idempotency-Key'],
			context.calls[1].headers['Idempotency-Key'],
		);
	});

	it('does not retry when the daily allowance is used up', async () => {
		const context = executeContext({
			params: createParams(),
			respond: () => {
				throw httpError(
					429,
					problem(429, 'daily-limit', 'Daily code limit reached', 'No codes are left today.'),
				);
			},
		});
		await assert.rejects(run(context), (error) => {
			assert.ok(error instanceof NodeApiError);
			assert.equal(error.message, 'Daily code limit reached');
			assert.equal(error.httpCode, '429');
			return true;
		});
		assert.equal(context.calls.length, 1);
	});

	it('reports field errors from an invalid request', async () => {
		const context = executeContext({
			params: createParams({ destination: 'not a url' }),
			respond: () => {
				throw httpError(
					400,
					problem(400, 'invalid-request', 'Invalid request', 'destination is not a URL', {
						errors: [{ field: 'destination', message: 'must be an http:// or https:// URL' }],
					}),
				);
			},
		});
		await assert.rejects(run(context), (error) => {
			assert.equal(error.message, 'Invalid request');
			assert.match(error.description, /destination: must be an http/);
			assert.match(error.description, /req_test/);
			return true;
		});
	});

	it('returns the error as an item when continue on fail is on', async () => {
		const context = executeContext({
			params: createParams(),
			continueOnFail: true,
			items: [{ json: {} }, { json: {} }],
			respond: (_options, n) => {
				if (n === 1)
					throw httpError(
						400,
						problem(400, 'invalid-request', 'Invalid request', 'prompt is required'),
					);
				return code();
			},
		});
		const [items] = await run(context);
		assert.equal(items.length, 2);
		assert.equal(items[0].json.error, 'Invalid request');
		assert.deepEqual(items[0].pairedItem, { item: 0 });
		assert.equal(items[1].json.status, 'succeeded');
		assert.deepEqual(items[1].pairedItem, { item: 1 });
	});
});

describe('Simplify', () => {
	it('returns the essential fields by default', async () => {
		const context = executeContext({
			params: { resource: 'code', operation: 'get', codeId: 'k7m2qz', options: {} },
			respond: () =>
				code({ status: 'failed', imageUrl: null, error: { message: 'It did not scan' } }),
		});
		const [[item]] = await run(context);
		assert.deepEqual(Object.keys(item.json).sort(), [
			'createdAt',
			'destination',
			'error',
			'id',
			'imageUrl',
			'pageUrl',
			'prompt',
			'shortUrl',
			'status',
			'style',
		]);
		assert.equal(item.json.error, 'It did not scan');
	});

	it('returns the raw code when turned off', async () => {
		const raw = code();
		const context = executeContext({
			params: {
				resource: 'code',
				operation: 'get',
				codeId: 'k7m2qz',
				simplify: false,
				options: {},
			},
			respond: () => raw,
		});
		const [[item]] = await run(context);
		assert.deepEqual(item.json, raw);
	});
});

describe('Get', () => {
	it('gets a code by id', async () => {
		const context = executeContext({
			params: { resource: 'code', operation: 'get', codeId: ' k7m2qz ', options: {} },
			respond: () => code(),
		});
		const [[item]] = await run(context);
		assert.equal(context.calls[0].method, 'GET');
		assert.equal(context.calls[0].url, '/v1/codes/k7m2qz');
		assert.equal(item.json.id, 'k7m2qz');
	});

	it('does not download an image for a code that is not ready', async () => {
		const context = executeContext({
			params: {
				resource: 'code',
				operation: 'get',
				codeId: 'k7m2qz',
				options: { downloadImage: true },
			},
			respond: () => code({ status: 'processing', imageUrl: null }),
		});
		const [[item]] = await run(context);
		assert.equal(context.downloads.length, 0);
		assert.equal(item.binary, undefined);
	});

	it('asks for a code when none is chosen', async () => {
		const context = executeContext({
			params: { resource: 'code', operation: 'get', codeId: '  ', options: {} },
			respond: () => code(),
		});
		await assert.rejects(run(context), /'QR Code' parameter is empty/);
		assert.equal(context.calls.length, 0);
	});

	it('explains a missing code', async () => {
		const context = executeContext({
			params: { resource: 'code', operation: 'get', codeId: 'nope', options: {} },
			respond: () => {
				throw httpError(404, problem(404, 'not-found', 'Not found', 'You have no code nope.'));
			},
		});
		await assert.rejects(run(context), (error) => {
			assert.equal(error.message, 'Not found');
			assert.match(error.description, /You have no code nope/);
			return true;
		});
		assert.equal(context.calls.length, 1);
	});
});

describe('Get Many', () => {
	const page = (ids, nextCursor) => ({
		object: 'list',
		data: ids.map((id) => code({ id })),
		hasMore: nextCursor !== null,
		nextCursor,
	});

	it('follows the cursor when returning all', async () => {
		const context = executeContext({
			params: { resource: 'code', operation: 'getAll', returnAll: true },
			respond: (options) => (options.qs.cursor ? page(['c3'], null) : page(['c1', 'c2'], 'cur-1')),
		});
		const [items] = await run(context);
		assert.deepEqual(
			items.map((i) => i.json.id),
			['c1', 'c2', 'c3'],
		);
		assert.deepEqual(
			context.calls.map((c) => c.qs),
			[{ limit: 100 }, { limit: 100, cursor: 'cur-1' }],
		);
	});

	it('stops at the limit', async () => {
		const context = executeContext({
			params: { resource: 'code', operation: 'getAll', returnAll: false, limit: 2 },
			respond: () => page(['c1', 'c2'], 'cur-1'),
		});
		const [items] = await run(context);
		assert.equal(items.length, 2);
		assert.equal(context.calls.length, 1);
		assert.equal(context.calls[0].qs.limit, 2);
	});
});

describe('Change Link', () => {
	it('sends the new destination', async () => {
		const context = executeContext({
			params: {
				resource: 'code',
				operation: 'update',
				codeId: 'k7m2qz',
				destination: 'https://example.com/new',
			},
			respond: () => code({ destination: 'https://example.com/new' }),
		});
		const [[item]] = await run(context);
		assert.equal(context.calls[0].method, 'PATCH');
		assert.equal(context.calls[0].url, '/v1/codes/k7m2qz');
		assert.deepEqual(context.calls[0].body, { destination: 'https://example.com/new' });
		assert.equal(item.json.destination, 'https://example.com/new');
	});

	it('says a paid plan is needed, without naming a plan', async () => {
		const context = executeContext({
			params: {
				resource: 'code',
				operation: 'update',
				codeId: 'k7m2qz',
				destination: 'https://example.com/new',
			},
			respond: () => {
				throw httpError(
					403,
					problem(
						403,
						'plan-required',
						'Needs the Starter plan',
						'Changing where a code points needs the Starter plan.',
					),
				);
			},
		});
		await assert.rejects(run(context), (error) => {
			assert.match(error.message, /needs a paid plan/);
			assert.match(error.description, /on a paid plan/);
			assert.doesNotMatch(`${error.message} ${error.description}`, /Starter/);
			return true;
		});
		assert.equal(context.calls.length, 1);
	});

	it('handles errors n8n has already wrapped', async () => {
		const { NODE } = require('./helpers');
		const context = executeContext({
			params: {
				resource: 'code',
				operation: 'update',
				codeId: 'k7m2qz',
				destination: 'https://example.com/new',
			},
			respond: () => {
				const raw = httpError(
					403,
					problem(
						403,
						'plan-required',
						'Needs the Starter plan',
						'Changing where a code points needs the Starter plan.',
					),
				);
				throw new NodeApiError(NODE, raw);
			},
		});
		await assert.rejects(run(context), /needs a paid plan/);
	});
});

describe('QR code list search', () => {
	it('lists codes by prompt, filters them and pages with the cursor', async () => {
		const context = executeContext({
			params: {},
			respond: () => ({
				object: 'list',
				data: [
					code({ id: 'aaa111', prompt: 'A lighthouse on a cliff at sunset' }),
					code({ id: 'bbb222', prompt: 'x'.repeat(80), pageUrl: 'https://qrx.codes/view/bbb222' }),
				],
				hasMore: true,
				nextCursor: 'cur-2',
			}),
		});
		const all = await node.methods.listSearch.searchCodes.call(context, undefined, 'cur-1');
		assert.deepEqual(context.calls[0].qs, { limit: 100, cursor: 'cur-1' });
		assert.equal(all.paginationToken, 'cur-2');
		assert.equal(all.results[0].name, 'A lighthouse on a cliff at sunset (aaa111)');
		assert.equal(all.results[0].value, 'aaa111');
		assert.equal(all.results[1].name, `${'x'.repeat(57)}... (bbb222)`);
		assert.equal(all.results[1].url, 'https://qrx.codes/view/bbb222');

		const filtered = await node.methods.listSearch.searchCodes.call(context, 'LIGHTHOUSE');
		assert.deepEqual(
			filtered.results.map((r) => r.value),
			['aaa111'],
		);
	});
});

describe('Account', () => {
	it('gets the account', async () => {
		const account = { object: 'account', plan: 'free', features: { changeDestination: false } };
		const context = executeContext({
			params: { resource: 'account', operation: 'get' },
			respond: () => account,
		});
		const [[item]] = await run(context);
		assert.equal(context.calls[0].url, '/v1/account');
		assert.deepEqual(item.json, account);
	});
});

describe('Style list', () => {
	it('offers no style first, then the styles by name', async () => {
		const context = executeContext({
			params: {},
			respond: () => ({
				object: 'list',
				data: [
					{ id: '06184', object: 'style', name: 'Cartoon', previewUrl: null },
					{ id: 'a64c5', object: 'style', name: 'Anime', previewUrl: null },
				],
				hasMore: false,
				nextCursor: null,
			}),
		});
		const options = await node.methods.loadOptions.getStyles.call(context);
		assert.equal(context.calls[0].url, '/v1/styles');
		assert.deepEqual(options, [
			{ name: 'None', value: '' },
			{ name: 'Anime', value: 'a64c5' },
			{ name: 'Cartoon', value: '06184' },
		]);
	});
});

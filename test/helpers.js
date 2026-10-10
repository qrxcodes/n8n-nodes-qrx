'use strict';

// Minimal stand-ins for the contexts n8n passes to a node, with the HTTP layer mocked.

const NODE = {
	id: 'node-1',
	name: 'QRX',
	type: 'n8n-nodes-qrx.qrx',
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
};

/** An error shaped like the one n8n's HTTP helper throws for a non-2xx answer. */
function httpError(status, body, headers = {}) {
	const error = new Error(`Request failed with status code ${status}`);
	error.response = { status, data: body, headers };
	return error;
}

function problem(status, code, title, detail, extra = {}) {
	return {
		type: `https://qrx.codes/developers/docs/errors#${code}`,
		title,
		status,
		detail,
		requestId: 'req_test',
		...extra,
	};
}

function code(overrides = {}) {
	return {
		id: 'k7m2qz',
		object: 'code',
		status: 'succeeded',
		type: 'url',
		prompt: 'A lighthouse on a cliff at sunset',
		style: null,
		destination: 'https://example.com/menu',
		shortUrl: 'https://qrx.to/k7m2qz',
		imageUrl: 'https://qrx.codes/media/premium/k7m2qz.png',
		pageUrl: 'https://qrx.codes/view/k7m2qz',
		error: null,
		createdAt: '2026-10-08T01:23:45.000Z',
		...overrides,
	};
}

/**
 * `respond(options, call)` answers each authenticated request: return a value to
 * answer with it, or throw to fail the request. Every request is recorded in `calls`.
 */
function mockHttp(respond) {
	const calls = [];
	const httpRequestWithAuthentication = async function (credentialName, options) {
		const call = { credentialName, ...options };
		calls.push(call);
		return respond(options, calls.length, call);
	};
	return { calls, httpRequestWithAuthentication };
}

function executeContext({
	params,
	items = [{ json: {} }],
	respond,
	continueOnFail = false,
	image,
}) {
	const http = mockHttp(respond);
	const downloads = [];
	const context = {
		calls: http.calls,
		downloads,
		getInputData: () => items,
		getNode: () => NODE,
		getExecutionId: () => 'exec-1',
		continueOnFail: () => continueOnFail,
		getNodeParameter(name, itemIndex, fallback) {
			const values = typeof params === 'function' ? params(itemIndex) : params;
			if (Object.prototype.hasOwnProperty.call(values, name)) return values[name];
			if (fallback !== undefined) return fallback;
			throw new Error(`Could not get parameter "${name}"`);
		},
		helpers: {
			httpRequestWithAuthentication: http.httpRequestWithAuthentication,
			async httpRequest(options) {
				downloads.push(options);
				return image ?? new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer;
			},
			async prepareBinaryData(buffer, fileName, mimeType) {
				return {
					data: Buffer.from(buffer).toString('base64'),
					fileName,
					mimeType,
					fileSize: String(buffer.length),
				};
			},
			returnJsonArray: (data) => data.map((json) => ({ json })),
		},
	};
	return context;
}

function pollContext({ respond, mode = 'trigger', staticData = {}, params = {} }) {
	const http = mockHttp(respond);
	return {
		calls: http.calls,
		staticData,
		getNode: () => ({ ...NODE, name: 'QRX Trigger', type: 'n8n-nodes-qrx.qrxTrigger' }),
		getMode: () => mode,
		getWorkflowStaticData: () => staticData,
		getNodeParameter: (name, fallback) => (name in params ? params[name] : fallback),
		helpers: {
			httpRequestWithAuthentication: http.httpRequestWithAuthentication,
			returnJsonArray: (data) => data.map((json) => ({ json })),
		},
	};
}

/** Replaces Date.now with a clock the test moves forward; returns the controls. */
function fakeClock(start = Date.parse('2026-10-10T00:00:00Z')) {
	const realNow = Date.now;
	let now = start;
	Date.now = () => now;
	return {
		advance(ms) {
			now += ms;
		},
		restore() {
			Date.now = realNow;
		},
	};
}

module.exports = { NODE, code, executeContext, fakeClock, httpError, pollContext, problem };

import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	INode,
	IPollFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, sleep } from 'n8n-workflow';

export const QRX_BASE_URL = 'https://qrx.codes';

/**
 * How long each request asks the API to hold open while a code finishes (the API allows
 * up to 50). Kept short so proxies between n8n and QRX do not cut the request off.
 */
export const MAX_WAIT_SECONDS = 25;

const MAX_ATTEMPTS = 3;
const MAX_RETRY_DELAY_MS = 10_000;

type QrxContext = IExecuteFunctions | ILoadOptionsFunctions | IPollFunctions;

export interface QrxCode extends IDataObject {
	id: string;
	object: 'code';
	status: string;
	type: string;
	prompt: string;
	style: string | null;
	destination: string | null;
	shortUrl: string | null;
	imageUrl: string | null;
	pageUrl: string;
	error: { message: string } | null;
	createdAt: string;
}

export interface QrxList<T> extends IDataObject {
	object: 'list';
	data: T[];
	hasMore: boolean;
	nextCursor: string | null;
}

interface Problem {
	type?: string;
	title?: string;
	status?: number;
	detail?: string;
	requestId?: string;
	errors?: Array<{ field: string; message: string }>;
}

interface RequestOptions {
	body?: IDataObject;
	qs?: IDataObject;
	headers?: Record<string, string>;
	/** Seconds the API may hold the request open (the `wait` query parameter). */
	waitSeconds?: number;
	itemIndex?: number;
}

/** `succeeded` and `failed` are final; the API says to treat any other status as still in progress. */
export function isFinished(code: QrxCode): boolean {
	return code.status === 'succeeded' || code.status === 'failed';
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asProblem(value: unknown): Problem | undefined {
	if (typeof value === 'string') {
		try {
			return asProblem(JSON.parse(value));
		} catch {
			return undefined;
		}
	}
	if (isObject(value) && (typeof value.title === 'string' || typeof value.detail === 'string')) {
		return value as Problem;
	}
	return undefined;
}

/** Walks the error and its causes for the HTTP status, problem body and headers. */
function inspectError(error: unknown): {
	status?: number;
	problem?: Problem;
	headers?: Record<string, unknown>;
} {
	let status: number | undefined;
	let problem: Problem | undefined;
	let headers: Record<string, unknown> | undefined;
	let current: unknown = error;
	for (let depth = 0; depth < 5 && isObject(current); depth++) {
		const response = isObject(current.response) ? current.response : undefined;
		const context = isObject(current.context) ? current.context : undefined;
		problem ??= asProblem(response?.data) ?? asProblem(response?.body) ?? asProblem(context?.data);
		headers ??= isObject(response?.headers) ? response.headers : undefined;
		if (status === undefined) {
			const candidate = response?.status ?? response?.statusCode ?? current.httpCode;
			const parsed = Number(candidate);
			if (candidate !== undefined && candidate !== null && Number.isInteger(parsed) && parsed > 0) {
				status = parsed;
			}
		}
		current = current.cause;
	}
	status ??= problem?.status;
	return { status, problem, headers };
}

function problemCode(problem: Problem | undefined): string | undefined {
	const type = problem?.type;
	return type?.includes('#') ? type.slice(type.lastIndexOf('#') + 1) : undefined;
}

function isRetryable(status: number | undefined, problem: Problem | undefined): boolean {
	if (status === undefined) return true; // network failure, timeout
	if (status === 409) return true; // idempotency key still in progress
	if (status === 429) return problemCode(problem) !== 'daily-limit';
	return status >= 500;
}

function retryDelayMs(headers: Record<string, unknown> | undefined, attempt: number): number {
	const retryAfter = Number(headers?.['retry-after'] ?? headers?.['Retry-After']);
	const ms =
		Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt;
	return Math.min(ms, MAX_RETRY_DELAY_MS);
}

/** Turns an API failure into a NodeApiError carrying QRX's problem title and detail. */
export function toNodeApiError(node: INode, error: unknown, itemIndex?: number): NodeApiError {
	const { status, problem } = inspectError(error);
	const code = problemCode(problem);

	let message = problem?.title;
	let description = problem?.detail;
	if (code === 'plan-required') {
		message = "Changing a QR code's link needs a paid plan";
		description =
			"Changing where a QR code's link points is available on a paid plan. See https://qrx.codes for plans.";
	} else if (code === 'unauthorized') {
		message = 'The QRX API key was not accepted';
		description =
			`${problem?.detail ?? ''} Check the key in the QRX API credential, or create one at https://qrx.codes/developers/keys.`.trim();
	} else if (code === 'invalid-request' && problem?.errors?.length) {
		description = problem.errors.map((e) => `${e.field}: ${e.message}`).join('; ');
	}
	if (description && problem?.requestId) {
		description = `${description} (request ${problem.requestId})`;
	}

	const errorResponse: JsonObject = problem
		? (problem as unknown as JsonObject)
		: { message: error instanceof Error ? error.message : String(error) };
	return new NodeApiError(node, errorResponse, {
		message,
		description,
		httpCode: status === undefined ? undefined : String(status),
		itemIndex,
	});
}

/**
 * Calls the QRX REST API with the QRX API credential. Retries network failures, rate
 * limits and server errors a couple of times; every call the node makes is safe to
 * repeat (code creation carries an Idempotency-Key).
 */
export async function qrxApiRequest<T = IDataObject>(
	this: QrxContext,
	method: IHttpRequestMethods,
	path: string,
	{ body, qs, headers, waitSeconds, itemIndex }: RequestOptions = {},
): Promise<T> {
	const query: IDataObject = { ...(qs ?? {}) };
	if (waitSeconds !== undefined) query.wait = waitSeconds;

	const options: IHttpRequestOptions = {
		method,
		baseURL: QRX_BASE_URL,
		url: path,
		headers: { Accept: 'application/json', ...(headers ?? {}) },
		qs: query,
		json: true,
		// Leave room past the server-side wait before giving up on the connection.
		timeout: ((waitSeconds ?? 0) + 30) * 1000,
	};
	if (body !== undefined) options.body = body;

	for (let attempt = 1; ; attempt++) {
		try {
			return (await this.helpers.httpRequestWithAuthentication.call(this, 'qrxApi', options)) as T;
		} catch (error) {
			const { status, problem, headers: responseHeaders } = inspectError(error);
			if (attempt >= MAX_ATTEMPTS || !isRetryable(status, problem)) {
				throw toNodeApiError(this.getNode(), error, itemIndex);
			}
			await sleep(retryDelayMs(responseHeaders, attempt));
		}
	}
}

/** The fields most workflows need, for the Simplify option. */
export function simplifyCode(code: QrxCode): IDataObject {
	return {
		id: code.id,
		status: code.status,
		prompt: code.prompt,
		style: code.style,
		destination: code.destination,
		shortUrl: code.shortUrl,
		imageUrl: code.imageUrl,
		pageUrl: code.pageUrl,
		error: code.error?.message ?? null,
		createdAt: code.createdAt,
	};
}

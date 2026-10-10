import { randomUUID } from 'crypto';
import type {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodeListSearchResult,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError, sleep } from 'n8n-workflow';

import { accountOperations, codeFields, codeOperations, resourceProperty } from './descriptions';
import type { QrxCode, QrxList } from './GenericFunctions';
import { isFinished, MAX_WAIT_SECONDS, qrxApiRequest, simplifyCode } from './GenericFunctions';

const PAGE_SIZE = 100;

/** If a long poll answers this quickly without a final status, pause before asking again. */
const MIN_POLL_INTERVAL_MS = 1000;
const POLL_BACKOFF_MS = 2000;

async function createCode(this: IExecuteFunctions, itemIndex: number): Promise<QrxCode> {
	const prompt = this.getNodeParameter('prompt', itemIndex) as string;
	const destination = (this.getNodeParameter('destination', itemIndex) as string).trim();
	const waitForCompletion = this.getNodeParameter('waitForCompletion', itemIndex, true) as boolean;
	const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;

	const body: IDataObject = { prompt, destination };
	if (typeof options.style === 'string' && options.style !== '') body.style = options.style;

	// One key per item: a retry of this request can never make a second code.
	const headers = { 'Idempotency-Key': `n8n-${randomUUID()}` };

	if (!waitForCompletion) {
		return (await qrxApiRequest.call(this, 'POST', '/v1/codes', {
			body,
			headers,
			itemIndex,
		})) as QrxCode;
	}

	const timeoutSeconds = this.getNodeParameter('timeout', itemIndex, 300) as number;
	const deadline = Date.now() + timeoutSeconds * 1000;
	const remainingWait = () =>
		Math.min(MAX_WAIT_SECONDS, Math.max(0, Math.floor((deadline - Date.now()) / 1000)));

	let code = (await qrxApiRequest.call(this, 'POST', '/v1/codes', {
		body,
		headers,
		waitSeconds: remainingWait(),
		itemIndex,
	})) as QrxCode;

	while (!isFinished(code)) {
		const waitSeconds = remainingWait();
		if (waitSeconds <= 0) {
			throw new NodeOperationError(
				this.getNode(),
				`The QR code was not ready after ${timeoutSeconds} seconds`,
				{
					itemIndex,
					description: `Its ID is ${code.id}. Use the Get operation to fetch it once it is ready, or raise the timeout.`,
				},
			);
		}
		const startedAt = Date.now();
		code = (await qrxApiRequest.call(this, 'GET', `/v1/codes/${encodeURIComponent(code.id)}`, {
			waitSeconds,
			itemIndex,
		})) as QrxCode;
		if (!isFinished(code) && Date.now() - startedAt < MIN_POLL_INTERVAL_MS) {
			await sleep(POLL_BACKOFF_MS);
		}
	}

	if (code.status === 'failed') {
		throw new NodeOperationError(
			this.getNode(),
			code.error?.message
				? `QRX could not make a QR code that scans: ${code.error.message}`
				: 'QRX could not make a QR code that scans',
			{
				itemIndex,
				description: `Try again, perhaps with a different prompt or style. QR code ID ${code.id}.`,
			},
		);
	}
	return code;
}

async function listCodes(this: IExecuteFunctions, itemIndex: number): Promise<QrxCode[]> {
	const returnAll = this.getNodeParameter('returnAll', itemIndex, false) as boolean;
	const limit = returnAll ? Infinity : (this.getNodeParameter('limit', itemIndex, 50) as number);

	const codes: QrxCode[] = [];
	let cursor: string | null = null;
	do {
		const qs: IDataObject = { limit: Math.min(PAGE_SIZE, limit - codes.length) };
		if (cursor) qs.cursor = cursor;
		const page: QrxList<QrxCode> = (await qrxApiRequest.call(this, 'GET', '/v1/codes', {
			qs,
			itemIndex,
		})) as QrxList<QrxCode>;
		codes.push(...page.data);
		cursor = page.hasMore ? page.nextCursor : null;
	} while (cursor && codes.length < limit);

	return codes.slice(0, limit);
}

function getCodeId(this: IExecuteFunctions, itemIndex: number): string {
	const value = this.getNodeParameter('codeId', itemIndex, '', { extractValue: true });
	const codeId = (
		typeof value === 'string' ? value : String((value as IDataObject).value ?? '')
	).trim();
	if (!codeId) {
		throw new NodeOperationError(this.getNode(), "The 'QR Code' parameter is empty", {
			itemIndex,
			description: 'Pick a QR code from the list, or enter its ID or link.',
		});
	}
	return codeId;
}

async function toItem(
	this: IExecuteFunctions,
	code: QrxCode,
	itemIndex: number,
): Promise<INodeExecutionData> {
	const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;
	const simplify = this.getNodeParameter('simplify', itemIndex, true) as boolean;
	const item: INodeExecutionData = {
		json: simplify ? simplifyCode(code) : code,
		pairedItem: { item: itemIndex },
	};
	if (options.downloadImage === true && code.status === 'succeeded' && code.imageUrl) {
		const image = (await this.helpers.httpRequest({
			method: 'GET',
			url: code.imageUrl,
			encoding: 'arraybuffer',
			json: false,
		})) as ArrayBuffer;
		const propertyName = (options.binaryPropertyName as string) || 'data';
		item.binary = {
			[propertyName]: await this.helpers.prepareBinaryData(
				Buffer.from(image),
				`qrx-${code.id}.png`,
				'image/png',
			),
		};
	}
	return item;
}

export class Qrx implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'QRX',
		name: 'qrx',
		icon: { light: 'file:qrx.svg', dark: 'file:qrx.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Create art QR codes that scan, and manage their links, with QRX',
		defaults: {
			name: 'QRX',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'qrxApi',
				required: true,
			},
		],
		properties: [resourceProperty, ...accountOperations, ...codeOperations, ...codeFields],
	};

	methods = {
		listSearch: {
			async searchCodes(
				this: ILoadOptionsFunctions,
				filter?: string,
				paginationToken?: string,
			): Promise<INodeListSearchResult> {
				const qs: IDataObject = { limit: PAGE_SIZE };
				if (paginationToken) qs.cursor = paginationToken;
				const page = (await qrxApiRequest.call(this, 'GET', '/v1/codes', {
					qs,
				})) as QrxList<QrxCode>;
				const needle = filter?.trim().toLowerCase();
				const results = page.data
					.filter(
						(code) =>
							!needle ||
							code.id.toLowerCase().includes(needle) ||
							code.prompt.toLowerCase().includes(needle),
					)
					.map((code) => ({
						name: `${code.prompt.length > 60 ? `${code.prompt.slice(0, 57)}...` : code.prompt} (${code.id})`,
						value: code.id,
						url: code.pageUrl,
					}));
				return {
					results,
					paginationToken: page.hasMore ? (page.nextCursor ?? undefined) : undefined,
				};
			},
		},
		loadOptions: {
			async getStyles(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const styles = (await qrxApiRequest.call(this, 'GET', '/v1/styles')) as QrxList<{
					id: string;
					name: string;
				}>;
				return [
					{ name: 'None', value: '' },
					...styles.data
						.map((style) => ({ name: style.name, value: style.id }))
						.sort((a, b) => a.name.localeCompare(b.name)),
				];
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;

				if (resource === 'account' && operation === 'get') {
					const account = (await qrxApiRequest.call(this, 'GET', '/v1/account', {
						itemIndex: i,
					})) as IDataObject;
					returnData.push({ json: account, pairedItem: { item: i } });
				} else if (resource === 'code' && operation === 'create') {
					const code = await createCode.call(this, i);
					returnData.push(await toItem.call(this, code, i));
				} else if (resource === 'code' && operation === 'get') {
					const codeId = getCodeId.call(this, i);
					const code = (await qrxApiRequest.call(
						this,
						'GET',
						`/v1/codes/${encodeURIComponent(codeId)}`,
						{ itemIndex: i },
					)) as QrxCode;
					returnData.push(await toItem.call(this, code, i));
				} else if (resource === 'code' && operation === 'getAll') {
					const codes = await listCodes.call(this, i);
					const simplify = this.getNodeParameter('simplify', i, true) as boolean;
					returnData.push(
						...codes.map((code) => ({
							json: simplify ? simplifyCode(code) : code,
							pairedItem: { item: i },
						})),
					);
				} else if (resource === 'code' && operation === 'update') {
					const codeId = getCodeId.call(this, i);
					const destination = (this.getNodeParameter('destination', i) as string).trim();
					const code = (await qrxApiRequest.call(
						this,
						'PATCH',
						`/v1/codes/${encodeURIComponent(codeId)}`,
						{
							body: { destination },
							itemIndex: i,
						},
					)) as QrxCode;
					const simplify = this.getNodeParameter('simplify', i, true) as boolean;
					returnData.push({ json: simplify ? simplifyCode(code) : code, pairedItem: { item: i } });
				} else {
					throw new NodeOperationError(
						this.getNode(),
						`The operation "${operation}" is not supported for "${resource}"`,
						{ itemIndex: i },
					);
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				if (error instanceof NodeApiError) {
					throw new NodeApiError(this.getNode(), error as unknown as JsonObject, { itemIndex: i });
				}
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}

		return [returnData];
	}
}

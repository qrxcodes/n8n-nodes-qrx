import type {
	IDataObject,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IPollFunctions,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import type { QrxCode, QrxList } from '../Qrx/GenericFunctions';
import { simplifyProperty } from '../Qrx/descriptions';
import { isFinished, qrxApiRequest, simplifyCode } from '../Qrx/GenericFunctions';

/** How many of the newest codes each poll looks at. */
const POLL_PAGE_SIZE = 100;

interface PollState extends IDataObject {
	/** `createdAt` of the newest code when the trigger started; older codes never trigger. */
	since?: string;
	/** IDs of finished codes in the last poll's page, so each code triggers once. */
	seen?: string[];
}

export class QrxTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'QRX Trigger',
		name: 'qrxTrigger',
		icon: { light: 'file:../Qrx/qrx.svg', dark: 'file:../Qrx/qrx.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{"New QR code ready"}}',
		description: 'Starts the workflow when a new QR code in your QRX account is ready',
		defaults: {
			name: 'QRX Trigger',
		},
		polling: true,
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'qrxApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Event',
				name: 'event',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'New QR Code Ready',
						value: 'codeReady',
						description:
							'A QR code created after the trigger was turned on has finished and its image is ready',
					},
				],
				default: 'codeReady',
			},
			simplifyProperty,
		],
	};

	async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
		const page = (await qrxApiRequest.call(this, 'GET', '/v1/codes', {
			qs: { limit: POLL_PAGE_SIZE },
		})) as QrxList<QrxCode>;
		const codes = page.data;
		const simplify = this.getNodeParameter('simplify', true) as boolean;
		const output = (ready: QrxCode[]) =>
			this.helpers.returnJsonArray(ready.map((code) => (simplify ? simplifyCode(code) : code)));

		if (this.getMode() === 'manual') {
			const newest = codes.find((code) => code.status === 'succeeded');
			return newest ? [output([newest])] : null;
		}

		const state = this.getWorkflowStaticData('node') as PollState;
		const finishedIds = codes.filter(isFinished).map((code) => code.id);

		if (state.since === undefined) {
			// First poll after activation: remember where we are and trigger on nothing.
			state.since = codes[0]?.createdAt ?? new Date(0).toISOString();
			state.seen = finishedIds;
			return null;
		}

		const since = Date.parse(state.since);
		const seen = new Set(state.seen ?? []);
		const ready = codes.filter(
			(code) =>
				code.status === 'succeeded' && !seen.has(code.id) && Date.parse(code.createdAt) >= since,
		);
		// The page is newest first and codes are only added, so anything that falls off
		// the page will never be listed again and need not be remembered.
		state.seen = finishedIds;

		if (ready.length === 0) return null;
		return [output(ready.reverse())];
	}
}

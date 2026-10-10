import type { INodeProperties } from 'n8n-workflow';

export const resourceProperty: INodeProperties = {
	displayName: 'Resource',
	name: 'resource',
	type: 'options',
	noDataExpression: true,
	options: [
		{ name: 'Account', value: 'account' },
		{ name: 'QR Code', value: 'code' },
	],
	default: 'code',
};

export const accountOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['account'] } },
		options: [
			{
				name: 'Get',
				value: 'get',
				description: "Retrieve the account's plan, daily allowance, features and rate limits",
				action: 'Get account',
			},
		],
		default: 'get',
	},
];

export const codeOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['code'] } },
		options: [
			{
				name: 'Change Link',
				value: 'update',
				description:
					"Point a QR code's link somewhere else, on a paid plan. Printed codes follow at once.",
				action: 'Change QR code link',
			},
			{
				name: 'Create',
				value: 'create',
				description: 'Make an art QR code from a prompt and a link, and wait until it is ready',
				action: 'Create QR code',
			},
			{
				name: 'Get',
				value: 'get',
				description: "Retrieve a QR code's status and, once it is ready, its image",
				action: 'Get QR code',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: "List the account's QR codes, newest first",
				action: 'Get many QR codes',
			},
		],
		default: 'create',
	},
];

export const simplifyProperty: INodeProperties = {
	displayName: 'Simplify',
	name: 'simplify',
	type: 'boolean',
	default: true,
	description: 'Whether to return a simplified version of the response instead of the raw data',
};

const downloadImageOptions: INodeProperties[] = [
	{
		displayName: 'Download Image',
		name: 'downloadImage',
		type: 'boolean',
		default: false,
		description:
			'Whether to download the PNG into a binary field once the QR code is ready, for example to attach it to an email or upload it',
	},
	{
		displayName: 'Put Image in Field',
		name: 'binaryPropertyName',
		type: 'string',
		default: 'data',
		description: 'The name of the binary field to put the image in',
		displayOptions: { show: { downloadImage: [true] } },
	},
];

export const codeFields: INodeProperties[] = [
	// create
	{
		displayName: 'Prompt',
		name: 'prompt',
		type: 'string',
		typeOptions: { rows: 3 },
		required: true,
		default: '',
		placeholder: 'e.g. A lighthouse on a cliff at sunset',
		description: 'What the picture should show',
		displayOptions: { show: { resource: ['code'], operation: ['create'] } },
	},
	{
		displayName: 'Destination URL',
		name: 'destination',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. https://example.com/menu',
		description:
			'Where scans go: an absolute http:// or https:// URL. The QR code holds a short qrx.to link that forwards here.',
		displayOptions: { show: { resource: ['code'], operation: ['create'] } },
	},
	{
		displayName: 'Wait for Completion',
		name: 'waitForCompletion',
		type: 'boolean',
		default: true,
		description:
			"Whether to wait until the QR code is ready before the node finishes. Codes are usually ready in under a minute. When off, the node returns at once with the status 'processing'.",
		displayOptions: { show: { resource: ['code'], operation: ['create'] } },
	},
	{
		displayName: 'Timeout (Seconds)',
		name: 'timeout',
		type: 'number',
		typeOptions: { minValue: 10, maxValue: 1800 },
		default: 300,
		description: 'How long to wait for the QR code before the node stops waiting',
		displayOptions: {
			show: { resource: ['code'], operation: ['create'], waitForCompletion: [true] },
		},
	},

	// get, update
	{
		displayName: 'QR Code',
		name: 'codeId',
		type: 'resourceLocator',
		required: true,
		default: { mode: 'list', value: '' },
		description: 'The QR code to use',
		displayOptions: { show: { resource: ['code'], operation: ['get', 'update'] } },
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				placeholder: 'Select a QR code...',
				typeOptions: { searchListMethod: 'searchCodes', searchable: true },
			},
			{
				displayName: 'By ID',
				name: 'id',
				type: 'string',
				placeholder: 'e.g. k7m2qz',
				validation: [
					{
						type: 'regex',
						properties: {
							regex: '^[A-Za-z0-9-]{1,64}$',
							errorMessage: 'Not a valid QR code ID',
						},
					},
				],
			},
			{
				displayName: 'By URL',
				name: 'url',
				type: 'string',
				placeholder: 'e.g. https://qrx.to/k7m2qz',
				validation: [
					{
						type: 'regex',
						properties: {
							regex: '^https?://(?:www\\.)?(?:qrx\\.to|qrx\\.codes/view)/[A-Za-z0-9-]+',
							errorMessage:
								'Use a short link (https://qrx.to/…) or a page link (https://qrx.codes/view/…)',
						},
					},
				],
				extractValue: {
					type: 'regex',
					regex: '^https?://(?:www\\.)?(?:qrx\\.to|qrx\\.codes/view)/([A-Za-z0-9-]+)',
				},
			},
		],
	},
	{
		displayName: 'New Destination URL',
		name: 'destination',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. https://example.com/new-menu',
		description:
			"Where scans go from now on. Changing a QR code's link is available on a paid plan. The printed code stays the same.",
		displayOptions: { show: { resource: ['code'], operation: ['update'] } },
	},

	// getAll
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
		displayOptions: { show: { resource: ['code'], operation: ['getAll'] } },
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 50,
		description: 'Max number of results to return',
		displayOptions: { show: { resource: ['code'], operation: ['getAll'], returnAll: [false] } },
	},

	{
		...simplifyProperty,
		displayOptions: {
			show: { resource: ['code'], operation: ['create', 'get', 'getAll', 'update'] },
		},
	},

	// options
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: { resource: ['code'], operation: ['create'] } },
		options: [
			...downloadImageOptions,
			{
				displayName: 'Style Name or ID',
				name: 'style',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getStyles' },
				default: '',
				description:
					'The style to paint the picture in. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
		],
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: { resource: ['code'], operation: ['get'] } },
		options: downloadImageOptions,
	},
];

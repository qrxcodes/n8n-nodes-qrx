import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class QrxApi implements ICredentialType {
	name = 'qrxApi';

	displayName = 'QRX API';

	icon: Icon = { light: 'file:../nodes/Qrx/qrx.svg', dark: 'file:../nodes/Qrx/qrx.dark.svg' };

	documentationUrl = 'https://github.com/qrxcodes/n8n-nodes-qrx#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			placeholder: 'qrx_live_...',
			description:
				'Create a key at <a href="https://qrx.codes/developers/keys" target="_blank">qrx.codes/developers/keys</a>. Keys start with qrx_.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://qrx.codes',
			url: '/v1/account',
			method: 'GET',
		},
	};
}

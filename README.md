# n8n-nodes-qrx

This is an n8n community node. It lets you use [QRX](https://qrx.codes) in your n8n workflows.

QRX paints a QR code into artwork from a description and a link, then checks that it scans before handing it over, so every code it returns works. Each code holds a short `qrx.to` link that forwards to your destination.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/) workflow automation platform.

[Installation](#installation)
[Operations](#operations)
[Credentials](#credentials)
[Compatibility](#compatibility)
[Usage](#usage)
[Resources](#resources)
[Version history](#version-history)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation. The package name is `n8n-nodes-qrx`.

## Operations

**QRX** node:

- **QR Code**
  - **Create**: make an art QR code from a prompt and a destination URL. The node waits until the code is ready (usually under a minute) and returns it with its image URL, short link and page link. It can also download the PNG into a binary field.
  - **Get**: get a QR code's status and, once it is ready, its image.
  - **Get Many**: list the account's QR codes, newest first.
  - **Change Link**: point a QR code's link somewhere else, on a paid plan. Printed codes follow at once, because the code itself never changes.
- **Account**
  - **Get**: the account's plan, daily allowance, features and rate limits.

**QRX Trigger** node:

- **New QR Code Ready**: starts the workflow when a QR code created after the trigger was turned on is ready.

## Credentials

You need a QRX account and an API key. A free account works.

1. Sign in at [qrx.codes](https://qrx.codes).
2. Create a key at [qrx.codes/developers/keys](https://qrx.codes/developers/keys). Keys start with `qrx_`.
3. In n8n, create a **QRX API** credential and paste the key into **API Key**.

The node sends the key as `Authorization: Bearer <key>`. n8n checks the credential by reading the account (`GET /v1/account`).

## Compatibility

Built with the `n8n-node` CLI against `n8n-workflow` 2.x. CI installs the package into the current n8n Docker image and checks that n8n loads both nodes and the credential. Self-hosted n8n needs Node.js 20 or later.

## Usage

### Create a QR code

Set **Prompt** to what the picture should show and **Destination URL** to where scans should go (an `http://` or `https://` URL). Optionally pick a **Style** under **Options**.

With **Wait for Completion** on (the default), the node holds requests open while QRX paints and checks the code, and returns once it is ready. If the code is not ready within **Timeout (Seconds)** (default 300), the node stops and its message gives the code's ID, so you can fetch it later with **Get**. Turn **Wait for Completion** off to return at once with the status `processing`.

Turn on **Options → Download Image** to put the PNG in a binary field (`data` by default), ready for an email attachment, a cloud drive upload or a chat message.

Every code made through the node counts toward your account's plan, as codes made in the app do. Each create request carries an idempotency key, so a retry after a network failure never makes a second code.

### Output

By default (**Simplify** on) each QR code comes out as:

```json
{
  "id": "k7m2qz",
  "status": "succeeded",
  "prompt": "A lighthouse on a cliff at sunset",
  "style": null,
  "destination": "https://example.com/menu",
  "shortUrl": "https://qrx.to/k7m2qz",
  "imageUrl": "https://qrx.codes/media/premium/k7m2qz.png",
  "pageUrl": "https://qrx.codes/view/k7m2qz",
  "error": null,
  "createdAt": "2026-10-08T01:23:45.000Z"
}
```

Turn **Simplify** off for the full response from the QRX API.

### Choosing a QR code

**Get** and **Change Link** take a QR code from a list, by ID (`k7m2qz`) or by link (`https://qrx.to/k7m2qz` or `https://qrx.codes/view/k7m2qz`).

### Change a QR code's link

Changing where a QR code's link points is available on a paid plan. On other plans the node stops with a message saying so. Use **Account → Get** and check `features.changeDestination` to branch on it.

### Trigger

The trigger polls the newest 100 codes in the account at the interval you set and fires once for each code that becomes ready. Codes made before the trigger was turned on are skipped. Use **Fetch Test Event** to get the newest ready code while building the workflow.

### Example workflow

[`examples/Create an art QR code from a form and email it (QRX).json`](examples/) collects a picture description, a link and an email address with an n8n Form, creates the QR code and emails the PNG with Gmail. Import it with **Workflows → Import from File**.

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- [QRX developer docs](https://qrx.codes/developers)
- [QRX REST API reference (OpenAPI)](https://qrx.codes/v1/openapi.json)

## Version history

### 0.1.0

First release: Create, Get, Get Many and Change Link for QR codes, Get for the account, and the QRX Trigger.

## Licence

[MIT](LICENSE)

# Releasing

Releases are published to npm by the [Publish workflow](.github/workflows/publish.yml) when a version tag is pushed. It uses npm trusted publishing (OIDC), so there is no npm token in the repository, and npm adds the provenance attestation that n8n requires for verified community nodes.

## Release a version

```bash
npm version 0.2.0 --no-git-tag-version   # updates package.json and package-lock.json
# add the version to CHANGELOG.md and the README's version history
git commit -am "Release 0.2.0"
git push origin main
git tag v0.2.0
git push origin v0.2.0
```

The workflow fails before publishing if the tag does not match the `package.json` version, and skips publishing if that version is already on npm. It runs in the `npm` GitHub environment, so a release waits for approval if that environment has required reviewers.

Do not run `npm publish` locally: `prepublishOnly` stops it, because a local publish has no provenance.

## First release (owner, once)

### 1. Create the npm package

npm trusted publishing can only be added to a package that already exists, so publish an empty placeholder first, as was done for `@qrxcodes/mcp` (`0.0.0-stage`). In an empty folder outside this repository, create `package.json` with the following. npm refuses `0.0.0-*` versions for a new package, so use `0.0.1-stage`:

```json
{
  "name": "n8n-nodes-qrx",
  "version": "0.0.1-stage",
  "description": "Placeholder for the QRX n8n node. Install 0.1.0 or later.",
  "license": "MIT",
  "repository": { "type": "git", "url": "git+https://github.com/qrxcodes/n8n-nodes-qrx.git" }
}
```

Then, in that folder:

```bash
npm login
npm publish --tag stage
```

The placeholder has no code and no `n8n-community-node-package` keyword, so n8n never lists it.

### 2. Add the trusted publisher

On npmjs.com, open **n8n-nodes-qrx → Settings → Trusted publishing** and add a **GitHub Actions** publisher:

- Organization or user: `qrxcodes`
- Repository: `n8n-nodes-qrx`
- Workflow filename: `publish.yml`
- Environment name: `npm`
- Allowed actions: tick **npm publish**

A new trusted publisher expires unless it publishes successfully within 2 days, so push the first tag straight after.

Optional: in **Settings → Publishing access**, choose **Require two-factor authentication and disallow tokens**. Trusted publishing keeps working. Optional: in the GitHub repository's **Settings → Environments → npm**, add required reviewers to approve each release.

### 3. Push the first tag

`package.json` is already at `0.1.0`:

```bash
git checkout main && git pull
git tag v0.1.0
git push origin v0.1.0
```

Watch the **Publish** run in the Actions tab. Then check it on npm (the version page shows a provenance badge) and run n8n's own check, which must pass:

```bash
npx @n8n/scan-community-package n8n-nodes-qrx
```

Optionally mark the placeholders as deprecated so nobody installs it:

```bash
npm deprecate n8n-nodes-qrx@"<0.1.0" "Placeholder. Install 0.1.0 or later."
```

### 4. Submit for verification in the n8n Creator Portal

1. Sign up or sign in at [creators.n8n.io/nodes](https://creators.n8n.io/nodes).
2. Submit `n8n-nodes-qrx` for verification. Use:
   - npm package: `n8n-nodes-qrx`
   - Repository: `https://github.com/qrxcodes/n8n-nodes-qrx`
   - Documentation: the README (`https://github.com/qrxcodes/n8n-nodes-qrx#readme`)
   - Description: `Create art QR codes that scan, and manage their links, with QRX.`
   - A QRX API key for the reviewers, if the form asks for test access (a free account is enough for everything but Change Link, which is on a paid plan).
3. n8n reviews the package against its verification guidelines. Once verified, it can be installed from the nodes panel, including on n8n Cloud.

### 5. Add the template to awesome-n8n-templates

[enescingoz/awesome-n8n-templates](https://github.com/enescingoz/awesome-n8n-templates) takes templates by pull request. Do this after the npm release, so people who import the template can install the node.

1. Fork the repository.
2. Copy [`examples/Create an art QR code from a form and email it (QRX).json`](examples/) into its `Forms_and_Surveys/` folder.
3. In its `README.md`, add this row at the end of the table under "How do I automate forms and surveys with n8n?":

   ```
   | Create an art QR code from a form and email it (QRX) | An n8n Form collects a picture description, a link and an email address; QRX paints a scannable QR code into the picture and Gmail sends the PNG. Needs the QRX community node (n8n-nodes-qrx). | Marketing | [Link to Template](Forms_and_Surveys/Create%20an%20art%20QR%20code%20from%20a%20form%20and%20email%20it%20(QRX).json) |
   ```

4. Open the pull request with the title `Add QRX art QR code form template` and a one-line description, such as "Form to art QR code to email, using the QRX community node."

The template can also be submitted to n8n's own template library at [n8n.io/workflows](https://n8n.io/workflows) (sign in, **Submit a workflow**) once the node is verified.

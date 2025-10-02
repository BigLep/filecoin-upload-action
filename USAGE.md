# Usage Guide

This action supports multiple modes of operation. **The two-workflow pattern is recommended for all use cases.**

## Recommended: `build` + `upload` (Two-Workflow Pattern)

✅ **This is the secure default pattern.**

**Use Case**: All PRs (including forks), maximum security

This splits the action into two separate workflows with a security boundary. `build` is the default mode, so you only need to specify `mode: upload` in the second workflow.

📁 **[See complete examples →](../examples/two-workflow-pattern/)**

### Workflow 1: Build (Untrusted)

```yaml
# .github/workflows/build-pr.yml
name: Build PR Content

on:
  pull_request:  # Runs on fork PRs

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.pull_request.head.sha }}

      - name: Build your site
        run: npm run build

      # Build mode: compute CAR, no secrets needed
      # The action automatically saves PR context and generates artifact names
      - name: Build CAR file
        uses: sgtpooki/filecoin-upload-action@v1
        with:
          mode: build
          path: dist
```

### Workflow 2: Upload (Trusted)

```yaml
# .github/workflows/upload-to-filecoin.yml
name: Upload to Filecoin

on:
  workflow_run:
    workflows: ["Build PR Content"]
    types: [completed]

jobs:
  upload:
    if: ${{ github.event.workflow_run.conclusion == 'success' }}
    runs-on: ubuntu-latest
    steps:
      # Upload mode: automatically finds artifacts, downloads context, and comments on PR
      # The action handles everything - just provide secrets and limits!
      - name: Upload to Filecoin
        uses: sgtpooki/filecoin-upload-action@v1
        with:
          mode: upload
          walletPrivateKey: ${{ secrets.WALLET_PRIVATE_KEY }}
          minDays: "30"   # Ensure 30 days of funding; HARDCODED - not from PR!
          maxTopUp: "0.10"  # 10 cents, or 0.10 USDFC; HARDCODED - not from PR!
```

**Security**:
- ✅ Fork PRs can trigger builds
- ✅ Secrets only in second workflow
- ✅ Financial parameters hardcoded in trusted workflow
- ✅ PR code never sees wallet private key
- ✅ Upload workflow runs from main branch (PR can't modify hardcoded values)

**Important**: The `workflow_run` trigger always uses the workflow file from your default branch (main), NOT from the PR branch. This means even if a PR tries to modify the hardcoded `minDays` or `maxTopUp` values in the upload workflow, those changes won't take effect until the PR is merged. This is a key security feature!

---

## Alternative: `mode: all` (Single Workflow - Not Recommended)

⚠️ **Security Warning**: This mode is less secure. Only use if you fully trust all contributors and don't accept fork PRs.

**Use Case**: Same-repo PRs only, no fork support

This is the simplest mode - everything happens in one workflow. **You must explicitly set `mode: all`** to use this pattern.

📁 **[See complete example →](../examples/single-workflow/upload.yml)**

```yaml
name: Upload to Filecoin

on:
  pull_request:
  push:
    branches: [main]

jobs:
  upload:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Build your site
        run: npm run build

      - name: Upload to Filecoin
        uses: sgtpooki/filecoin-upload-action@v1
        with:
          mode: all  # ⚠️ Must explicitly opt-in to single-workflow pattern
          walletPrivateKey: ${{ secrets.WALLET_PRIVATE_KEY }}
          path: dist
          minDays: "30"
          maxTopUp: "0.10"
```

**Security**:
- ✅ Safe for same-repo PRs from trusted contributors
- ❌ NOT safe for fork PRs
- ⚠️ PR authors can modify workflow file before merging

---

## Input Reference

### `mode`
- **Type**: `string`
- **Default**: `build` (secure default)
- **Options**: `build` (default, secure), `upload` (for trusted workflows), `all` (single-workflow, use with caution)
- **Description**: Controls action behavior. Default is `build` to encourage the secure two-workflow pattern.

### `walletPrivateKey`
- **Type**: `string`
- **Required**: Yes for `all` and `upload` modes, No for `build` mode
- **Description**: Wallet private key for Filecoin uploads

### `path`
- **Type**: `string`
- **Default**: `dist`
- **Required**: Yes for `all` and `build` modes, No for `upload` mode
- **Description**: Path to content to upload

### `minDays`
- **Type**: `string`
- **Default**: `"10"`
- **Security**: Hardcode in upload workflow when using two-workflow pattern

### `maxTopUp`
- **Type**: `string`
- **Security**: Always set this to limit spending, especially in two-workflow pattern

---

## Outputs

All modes provide these outputs:

- `ipfs_root_cid`: IPFS Root CID
- `data_set_id`: Synapse Data Set ID
- `piece_cid`: Filecoin Piece CID
- `provider_id`: Storage Provider ID
- `provider_name`: Storage Provider Name
- `car_path`: Path to CAR file
- `upload_status`: Status (`uploaded`, `reused-cache`, `reused-artifact`, or `build-only`)


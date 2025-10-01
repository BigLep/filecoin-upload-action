# Filecoin Pin Upload Action

Composite GitHub Action that packs a file or directory into a UnixFS CAR, uploads it to Filecoin, and publishes artifacts and metadata for easy reuse.

## Usage

```yaml
jobs:
  upload:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      actions: read        # required for artifact reuse
      pull-requests: write # optional, only if you want PR comments
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20.x
      - run: npm ci && npm run build
      - name: Upload to Filecoin
        uses: sgtpooki/filecoin-upload-action@<commit-sha>
        with:
          walletPrivateKey: ${{ secrets.FILECOIN_WALLET_KEY }}
          path: dist
          minDays: 10
          maxTopUp: ${{ github.event_name == 'pull_request' && '0.0001' || '0.01' }}
          providerAddress: "0xa3971A7234a3379A1813d9867B531e7EeB20ae07"
```

Always pin to a commit SHA (or release tag) for supply-chain safety.

## Inputs

| Name | Required | Default | Description |
| --- | --- | --- | --- |
| `walletPrivateKey` | ✅ | — | Wallet private key used to fund uploads. |
| `path` | | `dist` | Directory or file to package as a CAR. |
| `minDays` | | `10` | Minimum runway (days) to keep current spend alive. |
| `minBalance` | | — | Minimum USDFC balance to keep deposited. |
| `maxTopUp` | | — | Maximum additional deposit (USDFC) allowed in this run. |
| `token` | | `USDFC` | Payment token. Currently only USDFC is supported. |
| `withCDN` | | `false` | Request CDN in the storage context. |
| `providerAddress` | | `0xa3971…` | Override storage provider address. |
| `github_token` | | `${{ github.token }}` | Token used for GitHub API calls (PR comments, artifact lookups). |

Outputs include the IPFS root CID, dataset ID, piece CID, provider info, artifact paths, and upload status (`uploaded`, `reused-cache`, or `reused-artifact`).

## Security & Permissions Checklist

- Pin the action by commit SHA.
- Grant `actions: read` if you want artifact reuse (cache fallback) to work.
- Protect workflow files with CODEOWNERS/branch protection.
- Cap spend with `maxTopUp`, especially on `pull_request` events. Forks do not get secrets by default, so uploads there will skip funding.
- Consider gating deposits with Environments that require approval.
- If you need main-branch workflows for PRs, use a two-step model (`pull_request` build → `workflow_run` upload) rather than `pull_request_target`.

## Two-Step (Prepare/Upload) Pattern

The action supports a split workflow:

1. **Prepare (no secrets)**
   ```yaml
   - uses: sgtpooki/filecoin-upload-action@<sha>
     with:
       mode: prepare
       path: dist
       artifactName: filecoin-pin-${{ github.run_id }}-${{ github.sha }}
   ```

2. **Upload (trusted)**
   ```yaml
   - uses: actions/download-artifact@v4
     with:
       name: filecoin-pin-${{ github.event.workflow_run.run_id }}-${{ github.event.workflow_run.head_sha }}
       path: filecoin-pin-artifacts
   - uses: sgtpooki/filecoin-upload-action@<sha>
     with:
       mode: upload
       prebuiltCarPath: filecoin-pin-artifacts/upload.car
       walletPrivateKey: ${{ secrets.FILECOIN_WALLET_KEY }}
       minDays: 10
       minBalance: "5"
       maxTopUp: "50"
   ```

This keeps secrets out of PR builds while still providing a deterministic preview.

## Caching & Artifacts

- Cache key: `filecoin-pin-v1-${root_cid}` enables reuse for identical content.
- Artifacts: `filecoin-pin-artifacts/upload.car` and `filecoin-pin-artifacts/upload.json` are published for each run.
- PR comments (optional) include the IPFS root CID, dataset ID, piece CID, and preview link.

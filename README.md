# Filecoin Pin Upload Action

Composite GitHub Action that packs a file or directory into a UnixFS CAR, uploads it to Filecoin, and publishes artifacts and metadata for easy reuse.

## Quick Start

The action uses a **secure two-workflow pattern** by default. This currently works for same-repo PRs only (fork PR support temporarily disabled).

**Step 1: Build workflow** (runs on PR, no secrets):
```yaml
# .github/workflows/build-pr.yml
name: Build PR Content
on: pull_request

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npm run build
      - uses: sgtpooki/filecoin-upload-action@v1
        with:
          path: dist
          # mode: build is the default (secure)
```

**Step 2: Upload workflow** (runs after build, has secrets):
```yaml
# .github/workflows/upload-to-filecoin.yml
name: Upload to Filecoin
on:
  workflow_run:
    workflows: ["Build PR Content"]
    types: [completed]

jobs:
  upload:
    if: github.event.workflow_run.conclusion == 'success'
    runs-on: ubuntu-latest
    permissions:
      actions: read
      pull-requests: write
    steps:
      - uses: sgtpooki/filecoin-upload-action@v1
        with:
          mode: upload
          walletPrivateKey: ${{ secrets.FILECOIN_WALLET_KEY }}
          minDays: "30"
          maxTopUp: "0.10"  # Hardcoded limit (0.10 USDFC = 10 cents)
```

**Versioning**: This action uses [Semantic Release](https://semantic-release.gitbook.io/) for automated versioning. Use version tags like `@v1`, `@v1.0.0`, or commit SHAs for supply-chain safety.

## Inputs

### Core Configuration

| Name | Required | Default | Description |
| --- | --- | --- | --- |
| `mode` | | `build` | Action mode: `build` (default, secure - CAR only), `upload` (upload from artifact), or `all` (single-workflow, use with caution) |
| `path` | | `dist` | Directory or file to package as a CAR. Required for `all` and `build` modes |
| `walletPrivateKey` | ✅* | — | Wallet private key. *Required for `all` and `upload` modes, not needed for `build` |

### Financial Controls

| Name | Required | Default | Description |
| --- | --- | --- | --- |
| `minDays` | | `10` | Minimum runway (days) to keep current spend alive |
| `maxTopUp` | | — | Maximum additional deposit (USDFC) allowed in this run. **Strongly recommended for security** |
| `minBalance` | | — | Minimum USDFC balance to keep deposited |

### Optional/Advanced

| Name | Required | Default | Description |
| --- | --- | --- | --- |
| `github_token` | | `${{ github.token }}` | Token used for GitHub API calls (PR comments, artifact lookups) |
| `providerAddress` | | `0xa3971…` | Override storage provider address |
| `token` | | `USDFC` | Payment token. Currently only USDFC is supported |
| `withCDN` | | `false` | Request CDN in the storage context |
| `artifact_name` | | — | Override artifact name for manual testing. Leave empty for auto-detection |

Outputs include the IPFS root CID, dataset ID, piece CID, provider info, artifact paths, and upload status (`uploaded`, `reused-cache`, `reused-artifact`, or `build-only`).

## Security & Permissions Checklist

- ✅ Pin the action by version tag or commit SHA
- ✅ Grant `actions: read` if you want artifact reuse (cache fallback) to work
- ✅ Protect workflow files with CODEOWNERS/branch protection
- ✅ **Always** cap spend with `maxTopUp`, especially on `pull_request` events
- ✅ **Never** use `pull_request_target` - use the two-workflow pattern instead
- ✅ When using two-workflow pattern, **hardcode** `minDays` and `maxTopUp` in the upload workflow
- ✅ Enable **branch protection** on main to require reviews for workflow changes
- ✅ Use **CODEOWNERS** to require security team approval for workflow modifications
- ⚠️ Consider gating deposits with Environments that require approval

## Usage

The action uses a secure two-workflow pattern by default. This currently works for **same-repo PRs only** (fork PR support temporarily disabled).

Split your CI into untrusted build + trusted upload workflows.

**Security Note**: The `workflow_run` trigger always executes the workflow file from your main branch, not from the PR. Even if a PR modifies the upload workflow to change hardcoded limits, those changes won't apply until the PR is merged.

## Current Limitations & Future Plans

**⚠️ Fork PR Support Temporarily Disabled**

- **Current**: Only same-repo PRs and direct pushes to main are supported
- **PR Commenting**: Still works, but shows different message for fork PRs
- **Reason**: Limit non-maintainer PR actors from draining funds from unaware repo owners.

**🔄 Planned Restorations:**
- Fork PR support will be re-enabled in a future version

**See [examples/two-workflow-pattern/](./examples/two-workflow-pattern/)** for complete, ready-to-use workflow files.

## Releases & Versioning

This action uses [Semantic Release](https://semantic-release.gitbook.io/) for automated versioning based on [Conventional Commits](https://www.conventionalcommits.org/).

### Available Versions

- **`@v1`** - Latest v1.x.x release (recommended for most users)
- **`@v1.0.0`** - Specific version (recommended for production)
- **`@<commit-sha>`** - Specific commit (maximum security)

### Version Bumps

- **Patch** (`1.0.0` → `1.0.1`): Bug fixes, docs, refactoring
- **Minor** (`1.0.0` → `1.1.0`): New features
- **Major** (`1.0.0` → `2.0.0`): Breaking changes

### Release Process

Releases are automatically created when changes are pushed to `main` with conventional commit messages. See [CONTRIBUTING.md](./CONTRIBUTING.md) for commit message guidelines.

## Documentation

- **[examples/two-workflow-pattern/](./examples/two-workflow-pattern/)** - Ready-to-use workflow files (recommended)
- **[USAGE.md](./USAGE.md)** - Complete usage guide with all patterns
- **[FLOW.md](./FLOW.md)** - Internal architecture & how the action works under the hood
- **[examples/README.md](./examples/README.md)** - Detailed setup instructions
- **[CONTRIBUTING.md](./CONTRIBUTING.md)** - How to contribute and commit message guidelines

## Caching & Artifacts

- Cache key: `filecoin-pin-v1-${ipfs_root_cid}` enables reuse for identical content.
- Artifacts: `filecoin-pin-artifacts/upload.car` and `filecoin-pin-artifacts/upload.json` are published for each run.
- PR comments (optional) include the IPFS root CID, dataset ID, piece CID, and preview link.

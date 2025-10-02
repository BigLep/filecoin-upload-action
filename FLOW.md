# Filecoin Upload Action - Internal Flow Documentation

This document explains how the action works internally, the different modes, and why each step exists.

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Three Modes of Operation](#three-modes-of-operation)
- [Build Mode Flow](#build-mode-flow)
- [Upload Mode Flow](#upload-mode-flow)
- [Artifact Strategy](#artifact-strategy)
- [Caching & Deduplication](#caching--deduplication)
- [Common Scenarios](#common-scenarios)

---

## Architecture Overview

The action is designed to support **untrusted fork PRs** by separating content building (no secrets) from Filecoin uploading (has secrets).

```
┌─────────────────────┐
│   Build Mode        │  Runs on PR (no secrets needed)
│   - Creates CAR     │
│   - Saves context   │
│   - Uploads artifact│
└──────────┬──────────┘
           │ Artifact: filecoin-build-{run_id}
           ▼
┌─────────────────────┐
│   Upload Mode       │  Runs on main via workflow_run (has secrets)
│   - Downloads CAR   │
│   - Uploads to FC   │
│   - Comments on PR  │
└─────────────────────┘
```

**Key Insight**: The artifact is the security boundary. Untrusted PR code runs in build mode, trusted workflow code runs in upload mode.

---

## Three Modes of Operation

### 1. `mode: build` (Default - Secure)

**Purpose**: Create CAR file and save build context without needing wallet secrets.

**Triggers**: Pull request workflows, pushes to main

**What it does**:
- Packs content into a CAR file (IPFS format)
- Saves build context (Root CID, PR info, etc.) to `action-context/context.json`
- Copies the CAR into `action-context/` so action context + content live together
- Uploads the `action-context/` directory as a GitHub Actions artifact

**What it outputs**:
- Artifact: `filecoin-build-{run_id}` or `filecoin-build-pr-{pr_number}`
- Contains: CAR file + `context.json`

**Secrets needed**: None ✅

---

### 2. `mode: upload` (Trusted Workflow)

**Purpose**: Download the build artifact and upload to Filecoin.

**Triggers**: `workflow_run` trigger from build workflow

**What it does**:
1. Downloads the build artifact
2. Extracts build context (Root CID, PR number, etc.)
3. Checks cache/previous uploads for this content
4. If not cached: Uploads CAR to Filecoin
5. Saves upload action context for future reuse
6. Comments on PR with results

**Secrets needed**:
- `walletPrivateKey` (required)
- `github_token` (for PR comments, auto-provided)

---

### 3. `mode: all` (Unsafe - Single Workflow)

**Purpose**: Build and upload in a single workflow step.

**When to use**: Trusted same-repo PRs only (not fork PRs)

**Security warning**: PR authors can modify financial parameters before merge.

---

## Architecture Overview

The action follows SOLID principles with clear separation of concerns:

### `action.yml` Responsibilities:
- Set up environment (Node.js, dependencies)
- Call `run.mjs` once - it orchestrates based on mode

### `run.mjs` Responsibilities (Orchestrator):
- Read `mode` input and route to appropriate handler
- Manage basic action context
- Handle cleanup on errors

### `build.js` Responsibilities:
- `runBuild()` function: Create CAR, determine artifact name, save context, normalize for upload
- Handle all build-mode specific logic
- Manage PR action context extraction and context updates
- Upload build artifacts via GitHub API

### `upload.js` Responsibilities:
- `runUpload()` function: Detect artifact, download artifact, check for reuse, upload to Filecoin if needed
- Handle all upload-mode specific logic
- Manage artifact download via GitHub API
- Manage reuse detection (cache + artifacts)
- Handle Filecoin upload and payment processing
- Comment on PR with upload results
- Save/restore cache via GitHub API
- Upload result artifacts via GitHub API

### `comment-pr.js` Responsibilities:
- `commentOnPR()` function: Post or update PR comments with upload results
- Handle PR detection from context or GitHub events
- Manage comment creation and updates

### `artifacts.js` Responsibilities:
- `uploadBuildArtifact()` function: Upload build artifacts via GitHub API
- `uploadResultArtifact()` function: Upload result artifacts (CAR + action context) via GitHub API
- `saveCache()` function: Save cache via GitHub API
- `restoreCache()` function: Restore cache via GitHub API
- Handle all GitHub Actions artifact operations

### Benefits of This Architecture:
1. **SOLID principles**: Single responsibility for each module
2. **Easier to test**: Each module can be tested independently
3. **Easier to read**: Clear separation of concerns
4. **Maintainable**: Changes to build logic don't affect upload logic
5. **Reusable**: Functions can be imported and used elsewhere

---

## Build Mode Flow

### Step-by-step breakdown:

```
1. Set up Node.js
   └─> Ensures we have Node 24+

2. Install dependencies
   └─> Installs filecoin-pin and other packages
   └─> Uses cache for faster runs

3. Run action (run.mjs → build.js)
   ├─> run.mjs reads mode='build' input
   ├─> Calls build.js runBuild() function
   ├─> Creates CAR file from content directory
   ├─> Determines artifact name based on event (PR number when available, otherwise run ID)
   ├─> Updates context with PR metadata (if applicable)
   ├─> Normalizes context (copies CAR to action-context/)
   ├─> Saves everything to action-context/context.json
   └─> Outputs: ipfs_root_cid, car_path, artifact_name

4. Upload build artifact (handled by build.js)
   └─> Uploads entire action-context/ directory via GitHub API
   └─> Artifact name determined by build.js
   └─> Contains: CAR file + context.json
```

**Final artifact structure:**
```
filecoin-build-{id}/
  ├── context.json
  └── <car filename>.car
```

---

## Upload Mode Flow

### Step-by-step breakdown:

```
1. Set up Node.js + dependencies
   └─> Same as build mode

2. Run action (run.mjs → upload.js)
   ├─> run.mjs reads mode='upload' input
   ├─> Calls upload.js runUpload() function
   ├─> Determines artifact name based on workflow_run context
   ├─> Downloads build artifact via GitHub API
   ├─> Extracts artifact to ./action-context/
   ├─> Restores cache (if available) via GitHub API
   ├─> Loads context from action-context/context.json
   ├─> Checks for reusable uploads (cache or previous artifacts)
   ├─> If reusable: Validates balances and exits
   ├─> If not reusable: Uploads CAR to Filecoin
   ├─> Handles payments (minDays, maxTopUp)
   ├─> Creates result artifacts (CAR + metadata)
   ├─> Saves cache via GitHub API
   ├─> Uploads result artifacts via GitHub API
   ├─> Comments on PR with upload results
   └─> Outputs: all upload details
```

---

## Artifact Strategy

We use **TWO types of artifacts** for different purposes:

### 1. Build Artifacts: `filecoin-build-*`

**Purpose**: Transfer build output from build phase to upload phase

**Created in**: Build mode
**Downloaded in**: Upload mode
**Lifetime**: Short (1 day retention)
**Contains**:
- CAR file (the actual content)
- `context.json` (combined build metadata)

**Naming**:
- PR builds: `filecoin-build-pr-123` (when running on pull_request event)
- Merge builds: `filecoin-build-pr-123` (when running on push event from merged PR)
- Other builds: `filecoin-build-18171771267` (fallback to run ID)

### 2. Upload Artifacts: `filecoin-pin-{CID}`

**Purpose**: Content deduplication across builds

**Created in**: Upload mode (after successful upload)
**Downloaded in**: Next upload of same content
**Lifetime**: Default retention
**Contains**:
- Upload metadata (piece CID, data set ID, provider info)
- CAR file (for reference)

**Naming**: `filecoin-pin-bafybeiabc...` (uses IPFS Root CID)

**Why this exists**: If you build the same content twice (e.g., rebuild without changes), we can detect it's the same CID and reuse the previous upload without paying again!

### Artifact Naming Logic

The build mode uses intelligent artifact naming to ensure consistency between build and upload phases:

**Build Mode Logic** (in `build.js`):
1. **Manual override**: If `artifact_name` input is provided, use it
2. **Pull request events**: Use `filecoin-build-pr-{PR_NUMBER}`
3. **Push events**: Check commit message for "Merge pull request #X" pattern
   - If found: Use `filecoin-build-pr-{PR_NUMBER}`
   - If not found: Use `filecoin-build-{RUN_ID}`

**Upload Mode Logic** (in `upload.js`):
1. **Manual override**: If `artifact_name` input is provided, use it
2. **Workflow run context**: Extract PR number from `workflow_run.pull_requests[0].number`
   - If found: Look for `filecoin-build-pr-{PR_NUMBER}`
   - If not found: Look for `filecoin-build-{BUILD_WORKFLOW_RUN_ID}`
3. **Fallback**: Use `filecoin-build-{BUILD_WORKFLOW_RUN_ID}` (not current upload run ID)

**Why this matters**: The two-workflow pattern can run build mode on different events (pull_request, push after merge), but upload mode always runs on workflow_run. This logic ensures both modes use the same artifact name regardless of the trigger event.

---

## Caching & Deduplication

The action has **THREE layers** of deduplication:

### Layer 1: Actions Cache (fastest)

```yaml
Key: filecoin-v1-{root_cid}
Path: action-context/
```

**When it helps**:
- Same content built in the same repository
- Cache survives across workflow runs
- Fastest (restores entire action-context with context.json and CAR)

**When it doesn't help**:
- Different repositories
- Cache expired (7 day default)

---

### Layer 2: Artifact by CID (cross-run deduplication)

```
Searches for: filecoin-pin-{root_cid}
Downloads and merges into action-context/context.json
```

**When it helps**:
- Content was uploaded before but cache expired
- Works across different branches
- Survives longer than cache (default retention)

**When it doesn't help**:
- Artifact expired (default retention)
- Different repository

---

### Layer 3: Fresh Upload (no match found)

```
Uploads to Filecoin, creates new filecoin-pin-{cid} artifact
```

**Always works**: Uploads fresh to Filecoin

---

## Common Scenarios

### Scenario 1: First PR from a fork

```
1. PR opened → Build workflow runs (build mode)
   └─> Creates: filecoin-build-pr-123 artifact

2. Build completes → Upload workflow runs (upload mode)
   ├─> Downloads: filecoin-build-pr-123
   ├─> Cache MISS (new content)
   ├─> Previous artifact MISS (new content)
   ├─> Uploads to Filecoin ✅
   ├─> Creates: filecoin-pin-{cid} artifact
   └─> Comments on PR with CID
```

---

### Scenario 2: Rebuild same PR (no code changes)

```
1. PR updated → Build workflow runs
   └─> Creates: filecoin-build-pr-123 artifact (overwrites)
   └─> Same Root CID (content unchanged)

2. Upload workflow runs
   ├─> Downloads: filecoin-build-pr-123
   ├─> Cache HIT! ✅
   └─> Reuses previous upload metadata
   └─> No upload needed, no money spent 💰
```

---

### Scenario 3: Push to main

```
1. Merge PR → Build workflow runs (push event)
   └─> Creates: filecoin-build-18171771267 artifact

2. Upload workflow runs
   ├─> Downloads: filecoin-build-18171771267
   ├─> Cache HIT (same content as PR)
   └─> Reuses! No re-upload needed
   └─> No PR comment (not a PR)
```

---

### Scenario 4: Content already uploaded before

```
1. Build workflow creates artifact
2. Upload workflow runs
   ├─> Cache MISS (expired or different branch)
   ├─> Searches artifacts for: filecoin-pin-{cid}
   ├─> Artifact FOUND! ✅
   ├─> Downloads previous upload metadata
   └─> Reuses without uploading
```

---

## File Structure Reference

### During Build Mode:

```
workspace/
  ├── dist/                          # Your build output
  └── action-context/        # Created by action
      ├── context.json         # build context
      └── filecoin-pin-add-*.car     # CAR file
```

### During Upload Mode:

```
workspace/
  ├── action-context/                # Unified working directory
  │   ├── context.json               # Combined build+upload context (all metadata here)
  │   └── *.car                      # CAR file (from build or restored)
```

---

## Key Scripts

All JavaScript modules for the composite action live in `src/`.

### `src/update-build-context.js`

**When**: Build mode, immediately after the artifact name is determined
**Purpose**: Gather artifact and PR metadata from GitHub-provided environment variables and merge them into the combined context via `mergeAndSaveContext`
**Inputs**:
- `ARTIFACT_NAME` environment variable from the preceding step
- `GITHUB_RUN_ID`, `GITHUB_EVENT_NAME`, and `GITHUB_EVENT_PATH` supplied by the runner

### `src/context-load.js`

**When**: At the start of the action, and after restoring artifacts in upload mode
**Purpose**: Read `action-context/context.json` and expose structured outputs with `context_*` prefixes
**Outputs include**:
- `context_root_cid`, `context_car_filename`, `context_artifact_name`
- PR metadata (`context_pr_number`, `context_pr_sha`, etc.) when available
- Upload metadata (`context_piece_cid`, `context_data_set_id`, `context_upload_status`)

These outputs drive cache keys, artifact reuse detection, and PR commenting without needing bespoke helper scripts.

---

### `src/run.mjs`

**Phases**:
1. `ACTION_PHASE=compute`: Create CAR file only
2. `ACTION_PHASE=upload`: Upload to Filecoin
3. `ACTION_PHASE=from-cache`: Used internally when `context.json` already contains upload metadata (triggered automatically by the runner).

**What it does**:
- Reads the full composite input set from the JSON blob provided by `action.yml` (stored in `INPUTS_JSON` or passed as argv) so we no longer export individual `INPUT_*` variables per step
- Calls `filecoin-pin` library
- Handles Synapse initialization
- Manages payments/deposits
- Creates upload metadata
- Merges every phase's result back into `action-context/context.json` via `mergeAndSaveContext`, so later steps, caches, and artifacts all reference the same JSON

---

## Debugging Tips

### Check what artifact was created:

Look for: `Using artifact name: filecoin-build-XXXXX`

### Check if cache was used:

Look for: `Cache hit for: filecoin-pin-v1-{cid}`

### Check if previous artifact was found:

Look for: `Artifact FOUND` or `artifact_id != ''` in logs

### Check upload metadata:

After upload, check the artifact: `filecoin-pin-{cid}`

---

## Security Notes

### Why workflow_run is safe:

- `workflow_run` always executes workflow from **default branch**
- Even if PR modifies `.github/workflows/upload.yml`, changes are **ignored**
- Modified workflow only runs **after PR is merged** (at which point author is trusted)

### Why build mode is safe:

- No secrets exposed to PR code
- Only creates artifacts, doesn't spend money
- Worst case: malicious CAR file (content moderation issue, not security issue)

### Financial protection:

- `minDays` and `maxTopUp` hardcoded in upload workflow
- PR cannot modify these values (they're in main branch only)
- Wallet can only be drained by amount in `maxTopUp`

---

## Maintenance Checklist

When modifying this action:

- [ ] Update this FLOW.md if logic changes
- [ ] Update AGENTS.md if AI should know about changes
- [ ] Update USAGE.md if user-facing behavior changes
- [ ] Update examples/ if workflow patterns change
- [ ] Test with fork PR to ensure security boundary holds
- [ ] Test cache/artifact reuse scenarios

---

Last updated: 2025-10-01

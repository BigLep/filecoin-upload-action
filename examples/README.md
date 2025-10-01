# Workflow Examples

This directory contains example workflows for using the Filecoin Upload Action in different scenarios.

## 📂 Directory Structure

```
examples/
├── README.md                     # This file
├── single-workflow/              # Simple, same-repo PRs only
│   └── upload.yml
└── two-workflow-pattern/         # Secure fork PR support
    ├── build-pr.yml              # Untrusted build workflow
    └── upload-to-filecoin.yml    # Trusted upload workflow
```

## 🚀 Quick Start

### Recommended: Two-Workflow Pattern

✅ **This is the recommended and default pattern.**

**Use when:**
- You accept PRs from forks
- You want maximum security
- You want the secure default behavior

**Setup:**
1. Copy both files from `two-workflow-pattern/` to `.github/workflows/` in your repo
2. Set `WALLET_PRIVATE_KEY` secret in your repository settings
3. Update the build steps in `build-pr.yml` to match your project
4. Adjust hardcoded `minDays` and `maxTopUp` in `upload-to-filecoin.yml` to your needs

**That's it!** The action automatically handles:
- ✅ Saving PR metadata during build
- ✅ Retrieving PR metadata during upload
- ✅ Commenting on the PR with results

**Security:** ✅ Fork PRs can build but never access secrets. Financial parameters are hardcoded in the trusted workflow.

**This is the only pattern shown in the main README.** The single-workflow pattern is available but not recommended.

⚠️ **Security Warning**: Only use if you fully trust all contributors and don't accept fork PRs.

**Use when:**
- You only accept PRs from the same repository (not forks)
- You fully trust all contributors with write access
- You understand the security implications

**Setup:**
1. Copy `single-workflow/upload.yml` to `.github/workflows/` in your repo
2. Set `WALLET_PRIVATE_KEY` secret in your repository settings
3. Update the build steps to match your project
4. **Important**: The example includes `mode: all` to explicitly opt into this pattern

**Security:** ⚠️ Do not use this pattern if you accept fork PRs. Same-repo PRs can modify workflow files before merging.

**Note:** This pattern is intentionally not documented in the main README to encourage use of the secure two-workflow pattern.

---

## 📝 Usage Instructions

### 1. Copy Workflow Files

**Recommended:** Copy the two-workflow pattern files:

```bash
cp examples/two-workflow-pattern/*.yml .github/workflows/
```

### 2. Configure Secrets

Add the following secret to your repository (Settings → Secrets and variables → Actions):

- `WALLET_PRIVATE_KEY` - Your Filecoin wallet private key with USDFC funds

### 3. Customize Build Steps

Update the build section in the workflow to match your project:

```yaml
- name: Build
  run: |
    npm install
    npm run build
    # Output should go to 'dist' directory
```

### 4. Adjust Financial Parameters

Set these in `upload-to-filecoin.yml` (hardcoded for security):

```yaml
minDays: "30"    # Ensure 30 days of funding
maxTopUp: "0.10" # 10 cents max per run (0.10 USDFC)
```

### 5. Update Action Version

Replace `sgtpooki/filecoin-upload-action@v1` with the actual action reference:

```yaml
uses: sgtpooki/filecoin-upload-action@v1.0.0  # Pin to a specific version
```

---

## 🔒 Security Considerations

### Single Workflow Pattern

**Risks:**
- Same-repo contributors can modify workflow files in PRs
- Contributors can change spending limits before merging
- No protection against malicious same-repo PRs

**Mitigations:**
- Enable branch protection on main
- Require code review for all PRs
- Use CODEOWNERS for workflow files
- Set GitHub Environments with approval requirements

### Two-Workflow Pattern

**Protection:**
- ✅ Fork PRs never see secrets
- ✅ Financial limits hardcoded in main branch
- ✅ `workflow_run` always uses main branch workflow
- ✅ Only build artifacts cross trust boundary

**Additional Mitigations:**
- Enable branch protection on main
- Require code review for workflow file changes
- Use CODEOWNERS for `.github/workflows/*`

---

## 🧪 Testing

### Test Single Workflow
1. Create a branch in your repo
2. Make a change to trigger the build
3. Open a PR
4. Workflow should run and upload to Filecoin
5. PR should get a comment with IPFS CID

### Test Two-Workflow Pattern
1. Fork your repo (or have someone else do it)
2. Make changes in the fork
3. Open a PR from the fork
4. Both workflows should run in sequence
5. Build workflow should complete with no secrets
6. Upload workflow should complete and comment on PR
7. Verify fork PR cannot access secrets

---

## 📚 Additional Resources

- [Full Usage Guide](../USAGE.md) - Complete documentation
- [Main README](../README.md) - Action overview and inputs

---

## 🧪 Testing Your Setup

### Test with Same-Repo PR
1. Create a branch in your repo
2. Make a small change and open a PR
3. Both workflows should run automatically
4. Check for PR comment with IPFS CID

### Test with Fork PR
1. Fork your repo (or have someone else fork it)
2. Make changes in the fork
3. Open PR from the fork to your main repo
4. Both workflows should run
5. Comment should appear on the PR

### Verify Security
- ✅ Fork PR should NOT see `WALLET_PRIVATE_KEY` in logs
- ✅ Fork PR cannot modify `minDays` or `maxTopUp` values (they're hardcoded in main branch)
- ✅ Only the build output crosses the trust boundary

---

## 🆘 Troubleshooting

### "Artifact not found" in upload workflow
- Build workflow must complete successfully first
- Artifact retention is 1 day by default (artifacts auto-named by action)

### "No PR context" in workflow_run
- PR metadata is automatically handled by the action
- Ensure build workflow ran on `pull_request` event
- Check that PR metadata artifact was created in build step

### Comments not appearing on PR
- Verify `pull-requests: write` permission is granted
- Check `github_token` is provided to the action (auto-provided by default)
- PR number is automatically detected from metadata
- Look for errors in the "Comment on PR" step

### Secrets not available
- Fork PRs: This is expected and secure! Use two-workflow pattern.
- Same-repo PRs: Check repository secret settings
- Workflow files: Verify secret names match exactly

---

## 💡 Tips

1. **Pin action versions** - Use `@v1.0.0` instead of `@main` for stability
2. **Start conservative** - Set low `maxTopUp` limits initially
3. **Monitor costs** - Check your wallet balance regularly
4. **Test with forks** - Create a test fork to verify security
5. **Use CODEOWNERS** - Require security team review for workflow changes


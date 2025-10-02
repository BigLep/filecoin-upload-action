# Contributing to Filecoin Upload Action

Thank you for contributing to the Filecoin Upload Action! This project uses [Semantic Release](https://semantic-release.gitbook.io/) for automated versioning and releases based on [Conventional Commits](https://www.conventionalcommits.org/).

## Commit Message Format

We use conventional commits to automatically determine version bumps and generate changelogs. Please follow this format:

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

### Types

- **feat**: A new feature (triggers minor version bump)
- **fix**: A bug fix (triggers patch version bump)
- **perf**: A performance improvement (triggers patch version bump)
- **refactor**: Code refactoring (triggers patch version bump)
- **docs**: Documentation changes (triggers patch version bump)
- **style**: Code style changes (triggers patch version bump)
- **test**: Adding or updating tests (triggers patch version bump)
- **build**: Build system changes (triggers patch version bump)
- **ci**: CI/CD changes (triggers patch version bump)
- **chore**: Maintenance tasks (triggers patch version bump)
- **revert**: Reverting a previous commit (triggers patch version bump)

### Breaking Changes

To trigger a major version bump, include `BREAKING CHANGE:` in the footer or use `!` after the type:

```
feat!: remove deprecated API
```

or

```
feat: add new API

BREAKING CHANGE: The old API has been removed
```

### Examples

```bash
# New feature
git commit -m "feat: add support for custom storage providers"

# Bug fix
git commit -m "fix: handle empty directory uploads correctly"

# Breaking change
git commit -m "feat!: change default provider address

BREAKING CHANGE: The default provider address has changed from 0x123... to 0x456..."

# Documentation
git commit -m "docs: update security best practices section"

# Performance improvement
git commit -m "perf: optimize CAR file creation for large directories"
```

## Release Process

Releases are automatically created when you push to the `main` branch with conventional commits. The release process:

1. **Analyzes commits** since the last release
2. **Determines version bump** (patch/minor/major)
3. **Updates package.json** and creates a git tag
4. **Generates changelog** from commit messages
5. **Creates GitHub release** with release notes
6. **Tests the release** to ensure it works

### Manual Release

You can trigger a manual release using the GitHub Actions workflow:

1. Go to Actions → Release
2. Click "Run workflow"
3. This will analyze commits and create a release if needed

### Dry Run

To see what would be released without actually creating a release:

```bash
npm run dry-run
```

## Development Workflow

1. **Create a feature branch** from `main`
2. **Make your changes** with conventional commit messages
3. **Test your changes** locally
4. **Create a pull request** to `main`
5. **Merge the PR** - this will trigger the release process

## Testing

Before submitting a PR, please:

1. Run linting: `npm run lint`
2. Run type checking: `npm run typecheck`
3. Test the action locally if possible

## Security

This action handles sensitive operations (wallet private keys, filecoin uploads). Please:

- Follow the security guidelines in the main README
- Test changes thoroughly
- Consider security implications of any changes
- Use conventional commits to clearly describe security-related changes

## Questions?

If you have questions about contributing, please:

1. Check the existing issues and discussions
2. Create a new issue with the "question" label
3. Join the discussions in the repository

Thank you for helping make this action better! 🚀

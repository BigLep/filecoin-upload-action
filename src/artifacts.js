import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { Octokit } from '@octokit/rest'
import { getInput } from './inputs.js'

/**
 * Upload build artifact using GitHub API
 */
export async function uploadBuildArtifact(workspace, artifactName, retentionDays = 1) {
  const token = process.env.GITHUB_TOKEN || getInput('github_token')
  const repoFull = process.env.GITHUB_REPOSITORY

  if (!token || !repoFull) {
    throw new Error('GitHub token and repository required for artifact upload')
  }

  const [owner, repo] = repoFull.split('/')
  const octokit = new Octokit({ auth: token })

  // Create zip file from action-context directory
  const contextDir = join(workspace, 'action-context')
  const zipPath = join(contextDir, 'artifact.zip')

  // Use zip command to create archive
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const execFileAsync = promisify(execFile)

  await execFileAsync('zip', ['-r', zipPath, '.'], { cwd: contextDir })

  // Read zip file
  const zipBuffer = await fs.readFile(zipPath)

  // Upload artifact
  const { data: artifact } = await octokit.rest.actions.createArtifact({
    owner,
    repo,
    artifact_id: artifactName,
    size: zipBuffer.length,
  })

  // Upload the file content
  await octokit.rest.actions.uploadArtifact({
    owner,
    repo,
    artifact_id: artifactName,
    body: zipBuffer,
  })

  // Cleanup zip file
  try { await fs.unlink(zipPath) } catch {}

  console.log(`Uploaded build artifact: ${artifactName}`)
}

/**
 * Upload result artifact (CAR + metadata) using GitHub API
 */
export async function uploadResultArtifact(workspace, artifactName, carPath, metadataPath) {
  const token = process.env.GITHUB_TOKEN || getInput('github_token')
  const repoFull = process.env.GITHUB_REPOSITORY

  if (!token || !repoFull) {
    throw new Error('GitHub token and repository required for artifact upload')
  }

  const [owner, repo] = repoFull.split('/')
  const octokit = new Octokit({ auth: token })

  // Create zip file containing CAR and metadata
  const zipPath = join(workspace, 'result-artifact.zip')

  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const execFileAsync = promisify(execFile)

  // Add files to zip
  await execFileAsync('zip', ['-j', zipPath, carPath, metadataPath])

  // Read zip file
  const zipBuffer = await fs.readFile(zipPath)

  // Upload artifact
  const { data: artifact } = await octokit.rest.actions.createArtifact({
    owner,
    repo,
    artifact_id: artifactName,
    size: zipBuffer.length,
  })

  // Upload the file content
  await octokit.rest.actions.uploadArtifact({
    owner,
    repo,
    artifact_id: artifactName,
    body: zipBuffer,
  })

  // Cleanup zip file
  try { await fs.unlink(zipPath) } catch {}

  console.log(`Uploaded result artifact: ${artifactName}`)
}

/**
 * Save cache using GitHub API
 */
export async function saveCache(workspace, cacheKey, contextPath) {
  const token = process.env.GITHUB_TOKEN || getInput('github_token')
  const repoFull = process.env.GITHUB_REPOSITORY

  if (!token || !repoFull) {
    console.log('Skipping cache save: no GitHub token')
    return
  }

  const [owner, repo] = repoFull.split('/')
  const octokit = new Octokit({ auth: token })

  // Create zip file from context directory
  const zipPath = join(contextPath, 'cache.zip')

  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const execFileAsync = promisify(execFile)

  await execFileAsync('zip', ['-r', zipPath, '.'], { cwd: contextPath })

  // Read zip file
  const zipBuffer = await fs.readFile(zipPath)

  // Upload as cache artifact
  const artifactName = `cache-${cacheKey}`
  const { data: artifact } = await octokit.rest.actions.createArtifact({
    owner,
    repo,
    artifact_id: artifactName,
    size: zipBuffer.length,
  })

  // Upload the file content
  await octokit.rest.actions.uploadArtifact({
    owner,
    repo,
    artifact_id: artifactName,
    body: zipBuffer,
  })

  // Cleanup zip file
  try { await fs.unlink(zipPath) } catch {}

  console.log(`Saved cache: ${cacheKey}`)
}

/**
 * Restore cache using GitHub API
 */
export async function restoreCache(workspace, cacheKey, contextPath) {
  const token = process.env.GITHUB_TOKEN || getInput('github_token')
  const repoFull = process.env.GITHUB_REPOSITORY

  if (!token || !repoFull) {
    console.log('Skipping cache restore: no GitHub token')
    return false
  }

  const [owner, repo] = repoFull.split('/')
  const octokit = new Octokit({ auth: token })

  const artifactName = `cache-${cacheKey}`

  try {
    // List artifacts to find cache
    const artifacts = await octokit.paginate(octokit.rest.actions.listArtifactsForRepo, {
      owner,
      repo,
      per_page: 100,
    })

    const cacheArtifact = artifacts.find(a => a.name === artifactName && !a.expired)

    if (!cacheArtifact) {
      console.log(`Cache not found: ${cacheKey}`)
      return false
    }

    // Download cache artifact
    const download = await octokit.rest.actions.downloadArtifact({
      owner,
      repo,
      artifact_id: cacheArtifact.id,
      archive_format: 'zip',
    })

    // Extract to context directory
    const zipPath = join(contextPath, 'cache.zip')
    await fs.writeFile(zipPath, Buffer.from(download.data))

    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const execFileAsync = promisify(execFile)

    await execFileAsync('unzip', ['-o', zipPath, '-d', contextPath])

    // Cleanup zip file
    try { await fs.unlink(zipPath) } catch {}

    console.log(`Restored cache: ${cacheKey}`)
    return true
  } catch (error) {
    console.log(`Failed to restore cache ${cacheKey}:`, error?.message || error)
    return false
  }
}

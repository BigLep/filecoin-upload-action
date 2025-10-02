import { copyFile, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { DefaultArtifactClient } from '@actions/artifact'
import { getInput } from '@actions/core'
import { getErrorMessage } from './errors.js'

let runtimeGuardWarned = false

/**
 * Read GitHub event payload
 */
export async function readEventPayload() {
  const eventPath = process.env.GITHUB_EVENT_PATH
  if (!eventPath) return {}
  try {
    const content = await readFile(eventPath, 'utf8')
    return JSON.parse(content)
  } catch (error) {
    console.warn('Failed to read event payload:', getErrorMessage(error))
    return {}
  }
}

/**
 * Ensure the GitHub Actions runtime token is available.
 * The token is only provided when the workflow job declares `permissions: actions: write`.
 * @param {string} feature - Short description of what we are trying to do (for error messages)
 * @param {boolean} [fatal=true] - Whether missing token should throw
 * @returns {boolean} True when the token is available
 */
function ensureRuntimeToken(feature, fatal = true) {
  const token = process.env.ACTIONS_RUNTIME_TOKEN
  const resultsUrl = process.env.ACTIONS_RESULTS_URL
  if (token && resultsUrl) return true

  const message =
    `GitHub did not expose the runtime token required to ${feature}. ` +
    'Add `permissions: actions: write` to the workflow job that uses sgtpooki/filecoin-upload-action.'

  if (!runtimeGuardWarned) {
    console.warn(message)
    runtimeGuardWarned = true
  }

  if (fatal) {
    throw new Error(message)
  }

  return false
}

/**
 * Determine whether the supplied path is a directory.
 * @param {string} path
 */
async function pathIsDirectory(path) {
  try {
    const stats = await stat(path)
    return stats.isDirectory()
  } catch {
    return false
  }
}

/**
 * Safely list directory entries, returning an empty list on error.
 * @param {string} path
 * @returns {Promise<string[]>}
 */
async function safeListDir(path) {
  try {
    return await readdir(path)
  } catch {
    return []
  }
}

/**
 * Recursively copy files and directories.
 * @param {string} src
 * @param {string} dest
 */
async function copyRecursive(src, dest) {
  let stats
  try {
    stats = await stat(src)
  } catch {
    return
  }

  if (stats.isDirectory()) {
    await mkdir(dest, { recursive: true })
    const entries = await readdir(src)
    for (const entry of entries) {
      await copyRecursive(join(src, entry), join(dest, entry))
    }
    return
  }

  await mkdir(dirname(dest), { recursive: true })
  await copyFile(src, dest)
}

/**
 * Replace the target directory with the files from the source directory.
 * @param {string} sourceDir
 * @param {string} targetDir
 */
async function materializeContextDir(sourceDir, targetDir) {
  await rm(targetDir, { recursive: true, force: true })
  await mkdir(targetDir, { recursive: true })
  const entries = await readdir(sourceDir)
  for (const entry of entries) {
    await copyRecursive(join(sourceDir, entry), join(targetDir, entry))
  }
}

/**
 * Resolve the directory that holds the action-context contents within the extracted artifact.
 * @param {string} tempDir
 * @returns {Promise<string>}
 */
async function resolveContextSourceDir(tempDir) {
  const preferred = join(tempDir, 'action-context')
  if (await pathIsDirectory(preferred)) {
    return preferred
  }
  return tempDir
}

/**
 * Upload build artifact using GitHub API
 * @param {string} workspace
 * @param {string} artifactName
 * @param {number} retentionDays
 */
export async function uploadBuildArtifact(workspace, artifactName, retentionDays = 1) {
  ensureRuntimeToken(`upload build artifact ${artifactName}`)
  const artifact = new DefaultArtifactClient()
  const contextDir = join(workspace, 'action-context')

  try {
    const entries = await safeListDir(contextDir)
    if (entries.length === 0) {
      throw new Error('action-context directory is empty; nothing to upload')
    }

    const files = entries.map((entry) => join(contextDir, entry))
    console.log(`[artifact-debug] Uploading build artifact with entries: ${entries.join(', ')}`)

    const { id: artifactId } = await artifact.uploadArtifact(artifactName, files, workspace, {
      retentionDays,
      compressionLevel: 6,
    })

    console.log(`Uploaded build artifact: ${artifactName} (ID: ${artifactId})`)
  } catch (error) {
    console.error(`Failed to upload build artifact ${artifactName}:`, getErrorMessage(error))
    throw error
  }
}

/**
 * Upload result artifact (CAR + metadata) using GitHub API
 * @param {string} workspace
 * @param {string} artifactName
 * @param {string} carPath
 * @param {string} metadataPath
 */
export async function uploadResultArtifact(workspace, artifactName, carPath, metadataPath) {
  ensureRuntimeToken(`upload result artifact ${artifactName}`)
  const artifact = new DefaultArtifactClient()
  try {
    const { id: artifactId } = await artifact.uploadArtifact(artifactName, [carPath, metadataPath], workspace, {
      retentionDays: 30, // Keep result artifacts longer
      compressionLevel: 6,
    })

    console.log(`Uploaded result artifact: ${artifactName} (ID: ${artifactId})`)
  } catch (error) {
    console.error(`Failed to upload result artifact ${artifactName}:`, getErrorMessage(error))
    throw error
  }
}

/**
 * Save cache using GitHub API
 * @param {string} workspace
 * @param {string} cacheKey
 * @param {string} contextPath
 */
export async function saveCache(workspace, cacheKey, contextPath) {
  const artifactName = `cache-${cacheKey}`

  if (!ensureRuntimeToken(`save cache ${artifactName}`, false)) {
    return
  }

  const artifact = new DefaultArtifactClient()
  try {
    const entries = await safeListDir(contextPath)
    if (entries.length === 0) {
      console.log(`Cache directory empty for ${cacheKey}; skipping cache save`)
      return
    }

    const files = entries.map((entry) => join(contextPath, entry))
    console.log(`[artifact-debug] Saving cache ${cacheKey} with entries: ${entries.join(', ')}`)

    const { id: artifactId } = await artifact.uploadArtifact(artifactName, files, workspace, {
      retentionDays: 7, // Cache artifacts have shorter retention
      compressionLevel: 6,
    })

    console.log(`Saved cache: ${cacheKey} (ID: ${artifactId})`)
  } catch (error) {
    console.error(`Failed to save cache ${cacheKey}:`, getErrorMessage(error))
    // Don't throw - cache save failure shouldn't break the workflow
  }
}

/**
 * Restore cache using GitHub API
 * @param {string} workspace
 * @param {string} cacheKey
 * @param {string} buildRunId
 */
export async function restoreCache(workspace, cacheKey, buildRunId) {
  const artifactName = `cache-${cacheKey}`
  const tempDir = join(workspace, '.filecoin-cache-download')
  const ctxDir = join(workspace, 'action-context')

  try {
    if (!ensureRuntimeToken(`restore cache ${artifactName}`, false)) {
      return false
    }

    const artifact = new DefaultArtifactClient()

    await rm(tempDir, { recursive: true, force: true })
    await mkdir(tempDir, { recursive: true })

    // Get repository information
    const repoFull = process.env.GITHUB_REPOSITORY
    const token = process.env.GITHUB_TOKEN
    if (!repoFull || !token || !buildRunId) {
      console.log('Missing repository info, token, or build run ID for cache restore')
      return false
    }

    const [repositoryOwner, repositoryName] = repoFull.split('/')
    if (!repositoryOwner || !repositoryName) {
      console.log('Invalid repository format:', repoFull)
      return false
    }

    // First, get the artifact by name to get its ID from the build workflow run
    const workflowRunId = Number.parseInt(buildRunId, 10)
    if (!Number.isFinite(workflowRunId)) {
      console.log(`Invalid build run ID for cache restore: ${buildRunId}`)
      return false
    }

    const findBy = { token, workflowRunId, repositoryOwner, repositoryName }

    const artifacts = await artifact.listArtifacts({
      findBy,
    })
    const targetArtifact = artifacts.artifacts.find((a) => a.name === artifactName)

    if (!targetArtifact) {
      console.log(`Cache artifact not found: ${artifactName}`)
      return false
    }

    const _downloadResponse = await artifact.downloadArtifact(targetArtifact.id, {
      path: tempDir,
      findBy,
    })

    const sourceDir = await resolveContextSourceDir(tempDir)
    const listing = await safeListDir(sourceDir)
    console.log(`[artifact-debug] cache artifact contents: ${listing.join(', ')}`)

    await materializeContextDir(sourceDir, ctxDir)

    const ctxPath = join(ctxDir, 'context.json')
    try {
      const ctxContents = await readFile(ctxPath, 'utf8')
      console.log(`[artifact-debug] context.json from cache artifact: ${ctxContents}`)
    } catch (error) {
      console.warn('[artifact-debug] No context.json found after cache restore:', getErrorMessage(error))
    }
    await rm(tempDir, { recursive: true, force: true })

    console.log(`Restored cache: ${cacheKey}`)
    return true
  } catch (error) {
    console.log(`Failed to restore cache ${cacheKey}:`, getErrorMessage(error))
    return false
  }
}

/**
 * Download build artifact using GitHub API
 * @param {string} workspace
 * @param {string} artifactName
 * @param {string} buildRunId
 */
export async function downloadBuildArtifact(workspace, artifactName, buildRunId) {
  const ctxDir = join(workspace, 'action-context')
  const tempDir = join(workspace, '.filecoin-build-download')

  try {
    await rm(tempDir, { recursive: true, force: true })
    await mkdir(tempDir, { recursive: true })

    ensureRuntimeToken(`download artifact ${artifactName}`)
    const artifact = new DefaultArtifactClient()

    // Get repository information
    const repoFull = process.env.GITHUB_REPOSITORY
    const token = process.env.GITHUB_TOKEN
    if (!repoFull || !token || !buildRunId) {
      throw new Error('Missing repository info, token, or build run ID for artifact download')
    }

    const [repositoryOwner, repositoryName] = repoFull.split('/')
    if (!repositoryOwner || !repositoryName) {
      throw new Error(`Invalid repository format: ${repoFull}`)
    }

    // First, get the artifact by name to get its ID from the build workflow run
    const workflowRunId = Number.parseInt(buildRunId, 10)
    if (!Number.isFinite(workflowRunId)) {
      throw new Error(`Invalid workflow run ID: ${buildRunId}`)
    }

    console.log(`Fetching artifact list for workflow run ${workflowRunId} in repository ${repoFull}`)

    const findBy = { token, workflowRunId, repositoryOwner, repositoryName }

    const artifacts = await artifact.listArtifacts({
      findBy,
    })
    const targetArtifact = artifacts.artifacts.find((a) => a.name === artifactName)

    if (!targetArtifact) {
      throw new Error(`Artifact ${artifactName} not found`)
    }

    console.log(`Found ${artifacts.artifacts.length} artifact(s)`)

    const _downloadResponse = await artifact.downloadArtifact(targetArtifact.id, {
      path: tempDir,
      findBy,
    })

    const sourceDir = await resolveContextSourceDir(tempDir)
    const listing = await safeListDir(sourceDir)
    console.log(`[artifact-debug] build artifact contents: ${listing.join(', ')}`)

    await materializeContextDir(sourceDir, ctxDir)

    const ctxPath = join(ctxDir, 'context.json')
    try {
      const ctxContents = await readFile(ctxPath, 'utf8')
      console.log(`[artifact-debug] context.json from build artifact: ${ctxContents}`)
    } catch (error) {
      console.warn('[artifact-debug] No context.json found after build artifact download:', getErrorMessage(error))
    }
    await rm(tempDir, { recursive: true, force: true })

    console.log(`Downloaded and extracted artifact ${artifactName}`)
  } catch (error) {
    console.error(`Failed to download artifact ${artifactName}:`, getErrorMessage(error))
    throw error
  }
}

/**
 * Determine artifact name based on GitHub context
 * This function handles both build mode and upload mode scenarios
 * @param {any} [eventOverride] - Optional event payload override for testing
 * @returns {Promise<string>} The artifact name to use
 */
export async function determineArtifactName(eventOverride) {
  const eventName = process.env.GITHUB_EVENT_NAME || ''
  const runId = process.env.GITHUB_RUN_ID || ''

  // Manual override for testing
  const manualOverride = getInput('artifact_name')
  if (manualOverride) {
    console.log(`Using manually provided artifact name: ${manualOverride}`)
    return manualOverride
  }

  // Read event payload to get context info
  const event = eventOverride ?? (await readEventPayload())

  // Check for PR number in multiple ways to handle different event types
  let prNumber = null

  // Direct pull_request event
  if (eventName === 'pull_request' && event.pull_request?.number) {
    prNumber = event.pull_request.number
  }
  // pull_request_target event
  else if (eventName === 'pull_request_target' && event.pull_request?.number) {
    prNumber = event.pull_request.number
  }
  // Push event - check if this is a merge commit from a PR
  else if (eventName === 'push' && event.head_commit?.message) {
    // Look for "Merge pull request #X" pattern in commit message
    const mergeMatch = event.head_commit.message.match(/Merge pull request #(\d+)/)
    if (mergeMatch) {
      prNumber = parseInt(mergeMatch[1], 10)
    }
  }
  // Workflow run event - extract PR number from workflow_run context
  else if (eventName === 'workflow_run' && event.workflow_run?.pull_requests?.[0]?.number) {
    prNumber = event.workflow_run.pull_requests[0].number
  }

  // Use PR number if available, otherwise fall back to run ID
  if (prNumber) {
    const artifactName = `filecoin-build-pr-${prNumber}`
    console.log(`::notice::Auto-detected artifact name from PR: ${artifactName}`)
    return artifactName
  }

  // Fallback to run ID
  const artifactName = `filecoin-build-${runId}`
  console.log(`::notice::Using fallback artifact name: ${artifactName}`)
  return artifactName
}

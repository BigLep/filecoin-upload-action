import { access, mkdir, readFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { DefaultArtifactClient } from '@actions/artifact'
import { getErrorMessage } from './errors.js'

let runtimeGuardWarned = false

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
    const { id: artifactId } = await artifact.uploadArtifact(artifactName, [contextDir], workspace, {
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
    const { id: artifactId } = await artifact.uploadArtifact(artifactName, [contextPath], workspace, {
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

    const extractedCtxDir = join(tempDir, 'action-context')
    try {
      await access(extractedCtxDir)
    } catch (error) {
      throw new Error(`Cache artifact missing action-context directory: ${getErrorMessage(error)}`)
    }

    await rm(ctxDir, { recursive: true, force: true })
    await rename(extractedCtxDir, ctxDir)

    const ctxPath = join(ctxDir, 'context.json')
    try {
      const ctxContents = await readFile(ctxPath, 'utf8')
      console.log(`[artifact-debug] context.json from build artifact: ${ctxContents}`)
    } catch (error) {
      console.warn('[artifact-debug] No context.json found after build artifact download:', getErrorMessage(error))
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

    const extractedCtxDir = join(tempDir, 'action-context')
    try {
      await access(extractedCtxDir)
    } catch (error) {
      throw new Error(`Downloaded artifact missing action-context directory: ${getErrorMessage(error)}`)
    }

    await rm(ctxDir, { recursive: true, force: true })
    await rename(extractedCtxDir, ctxDir)

    const ctxPath = join(ctxDir, 'context.json')
    try {
      const ctxContents = await readFile(ctxPath, 'utf8')
      console.log(`[artifact-debug] context.json from cache artifact: ${ctxContents}`)
    } catch (error) {
      console.warn('[artifact-debug] No context.json found after cache restore:', getErrorMessage(error))
    }
    await rm(tempDir, { recursive: true, force: true })

    console.log(`Downloaded and extracted artifact ${artifactName}`)
  } catch (error) {
    console.error(`Failed to download artifact ${artifactName}:`, getErrorMessage(error))
    throw error
  }
}

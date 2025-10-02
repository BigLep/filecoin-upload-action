import { mkdir } from 'node:fs/promises'
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
 * @param {string} _workspace
 * @param {string} cacheKey
 * @param {string} contextPath
 * @param {string} buildRunId
 */
export async function restoreCache(_workspace, cacheKey, contextPath, buildRunId) {
  const artifactName = `cache-${cacheKey}`

  try {
    if (!ensureRuntimeToken(`restore cache ${artifactName}`, false)) {
      return false
    }

    const artifact = new DefaultArtifactClient()

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
    const artifacts = await artifact.listArtifacts({
      findBy: {
        token,
        workflowRunId: parseInt(buildRunId, 10),
        repositoryOwner,
        repositoryName,
      },
    })
    const targetArtifact = artifacts.artifacts.find((a) => a.name === artifactName)

    if (!targetArtifact) {
      console.log(`Cache artifact not found: ${artifactName}`)
      return false
    }

    const _downloadResponse = await artifact.downloadArtifact(targetArtifact.id, {
      path: contextPath,
    })

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

  try {
    await mkdir(ctxDir, { recursive: true })

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
    const artifacts = await artifact.listArtifacts({
      findBy: {
        token,
        workflowRunId: parseInt(buildRunId, 10),
        repositoryOwner,
        repositoryName,
      },
    })
    const targetArtifact = artifacts.artifacts.find((a) => a.name === artifactName)

    if (!targetArtifact) {
      throw new Error(`Artifact ${artifactName} not found`)
    }

    const _downloadResponse = await artifact.downloadArtifact(targetArtifact.id, {
      path: ctxDir,
    })

    console.log(`Downloaded and extracted artifact ${artifactName}`)
  } catch (error) {
    console.error(`Failed to download artifact ${artifactName}:`, getErrorMessage(error))
    throw error
  }
}

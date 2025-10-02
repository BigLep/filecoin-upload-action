import { constants as fsConstants } from 'node:fs'
import { access, copyFile, mkdir, readdir, readFile, unlink } from 'node:fs/promises'
import { basename, join } from 'node:path'
import pc from 'picocolors'
import pino from 'pino'
import { uploadBuildArtifact } from './artifacts.js'
import { contextWithCar, mergeAndSaveContext } from './context.js'
import { getErrorMessage } from './errors.js'
import { createCarFile } from './filecoin.js'
import { getInput } from './inputs.js'
import { writeOutputs } from './outputs.js'

// Import types for JSDoc
/**
 * @typedef {import('./types.js').CombinedContext} CombinedContext
 * @typedef {import('./types.js').ParsedInputs} ParsedInputs
 * @typedef {import('./types.js').BuildResult} BuildResult
 */

/**
 * Read GitHub event payload
 */
async function readEventPayload() {
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
 * Determine artifact name based on GitHub context
 */
async function determineArtifactName() {
  const eventName = process.env.GITHUB_EVENT_NAME || ''
  const runId = process.env.GITHUB_RUN_ID || ''

  // Manual override for testing
  const manualOverride = getInput('artifact_name')
  if (manualOverride) {
    console.log(`Using manually provided artifact name: ${manualOverride}`)
    return manualOverride
  }

  // Read event payload to get PR info
  const event = await readEventPayload()

  if (eventName === 'pull_request' && event.pull_request?.number) {
    return `filecoin-build-pr-${event.pull_request.number}`
  }
  return `filecoin-build-${runId}`
}

/**
 * Update context with PR and build metadata
 * @param {string} workspace
 * @param {string} artifactName
 */
async function updateBuildMetadata(workspace, artifactName) {
  const buildRunId = process.env.GITHUB_RUN_ID || ''
  const eventName = process.env.GITHUB_EVENT_NAME || ''
  const event = await readEventPayload()

  /** @type {Partial<CombinedContext>} */
  const payload = {
    artifact_name: artifactName,
    build_run_id: buildRunId,
    event_name: eventName,
  }

  if (event?.pull_request) {
    const pr = event.pull_request
    payload.pr = {
      number: typeof pr.number === 'number' ? pr.number : Number(pr.number) || 0,
      sha: pr?.head?.sha || '',
      title: pr?.title || '',
      author: pr?.user?.login || '',
    }
  }

  await mergeAndSaveContext(workspace, payload)
}

/**
 * Normalize context for artifact upload (copy CAR into action-context)
 * @param {string} workspace
 * @param {string} carPath
 */
async function normalizeContextForArtifact(workspace, carPath) {
  if (!carPath) {
    throw new Error('CAR path is required for normalization')
  }

  try {
    await access(carPath, fsConstants.F_OK)
  } catch {
    throw new Error(`CAR file not found at ${carPath}`)
  }

  const contextDir = join(workspace, 'action-context')
  await mkdir(contextDir, { recursive: true })

  const carName = basename(carPath)
  const destination = join(contextDir, carName)

  // Remove existing CAR files to keep context clean
  try {
    const entries = await readdir(contextDir)
    await Promise.all(
      entries
        .filter((name) => name.toLowerCase().endsWith('.car') && name !== carName)
        .map((name) => unlink(join(contextDir, name)))
    )
  } catch {
    // Ignore cleanup errors
  }

  await copyFile(carPath, destination)
  await mergeAndSaveContext(workspace, contextWithCar(workspace, destination))

  return destination
}

/**
 * Run build mode: Create CAR file, determine artifact name, save context
 */
export async function runBuild() {
  const logger = pino({ level: process.env.LOG_LEVEL || 'info' })
  const workspace = process.env.GITHUB_WORKSPACE || process.cwd()

  console.log('━━━ Build Mode: Creating CAR file ━━━')

  // Parse inputs (build mode doesn't need wallet validation)
  const { parseInputs, resolveContentPath } = await import('./inputs.js')
  const inputs = /** @type {ParsedInputs} */ (parseInputs('compute')) // Skip wallet validation for build mode
  const { contentPath } = inputs
  const targetPath = resolveContentPath(contentPath)

  // Create CAR file
  const buildResult = /** @type {BuildResult} */ (await createCarFile(targetPath, contentPath, logger))
  const { carPath, ipfsRootCid } = buildResult
  console.log(`IPFS Root CID: ${pc.bold(ipfsRootCid)}`)
  console.log(`::notice::IPFS Root CID: ${ipfsRootCid}`)

  // Determine artifact name
  const artifactName = await determineArtifactName()
  console.log(`Artifact name: ${artifactName}`)
  console.log(`::notice::Artifact name: ${artifactName}`)

  // Update context with build metadata (PR info, artifact name, etc.)
  await updateBuildMetadata(workspace, artifactName)

  // Add PR metadata annotation if this is a PR
  const event = await readEventPayload()
  if (event?.pull_request?.number) {
    console.log(`::notice::Saved PR metadata for PR #${event.pull_request.number}`)
  }

  // Normalize context: copy CAR into action-context directory
  const normalizedCarPath = await normalizeContextForArtifact(workspace, carPath)

  // Update context with CID and CAR info
  await mergeAndSaveContext(workspace, {
    ipfs_root_cid: ipfsRootCid,
  })

  // Upload build artifact
  await uploadBuildArtifact(workspace, artifactName)

  // Write outputs for action.yml
  await writeOutputs({
    ipfs_root_cid: ipfsRootCid,
    car_path: normalizedCarPath,
    artifact_name: artifactName,
    upload_status: 'build-only',
  })

  console.log('✓ Build complete. CAR and metadata saved and uploaded to artifacts')
  console.log('::notice::Build mode complete. CAR file created and saved to artifact.')
}

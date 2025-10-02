import { constants as fsConstants } from 'node:fs'
import { access, copyFile, mkdir, readdir, unlink } from 'node:fs/promises'
import { basename, join } from 'node:path'
import pc from 'picocolors'
import pino from 'pino'
import { determineArtifactName, readEventPayload, uploadBuildArtifact } from './artifacts.js'
import { contextWithCar, mergeAndSaveContext } from './context.js'
import { createCarFile } from './filecoin.js'
import { formatSize, writeOutputs } from './outputs.js'

// Import types for JSDoc
/**
 * @typedef {import('./types.js').CombinedContext} CombinedContext
 * @typedef {import('./types.js').ParsedInputs} ParsedInputs
 * @typedef {import('./types.js').BuildResult} BuildResult
 */

/**
 * Update context with PR and build context
 * @param {string} workspace
 * @param {string} artifactName
 */
async function updateBuildContext(workspace, artifactName) {
  const buildRunId = process.env.GITHUB_RUN_ID || ''
  const eventName = process.env.GITHUB_EVENT_NAME || ''
  const event = await readEventPayload()

  /** @type {Partial<CombinedContext>} */
  const payload = {
    artifact_name: artifactName,
    build_run_id: buildRunId,
    event_name: eventName,
  }

  // Handle PR context (same-repo PRs only at this point)
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

  // Check if this is a fork PR first
  const event = await readEventPayload()
  if (event?.pull_request) {
    const pr = event.pull_request
    const isForkPR = pr.head?.repo?.full_name !== pr.base?.repo?.full_name

    if (isForkPR) {
      console.log('━━━ Fork PR Detected - Building CAR but Blocking Upload ━━━')
      console.error('::error::Fork PR support is currently disabled. Only same-repo workflows are supported.')
      console.log('::notice::Building CAR file but upload will be blocked')
    }
  }

  // Parse inputs (build mode doesn't need wallet validation)
  const { parseInputs, resolveContentPath } = await import('./inputs.js')
  const inputs = /** @type {ParsedInputs} */ (parseInputs('compute')) // Skip wallet validation for build mode
  const { contentPath } = inputs
  const targetPath = resolveContentPath(contentPath)

  // Create CAR file
  const buildResult = /** @type {BuildResult} */ (await createCarFile(targetPath, contentPath, logger))
  const { carPath, ipfsRootCid, carSize } = buildResult
  console.log(`IPFS Root CID: ${pc.bold(ipfsRootCid)}`)
  console.log(`::notice::IPFS Root CID: ${ipfsRootCid}`)

  if (carSize) {
    console.log(`CAR file size: ${pc.bold(formatSize(carSize))}`)
    console.log(`::notice::CAR file size: ${formatSize(carSize)}`)
  }

  // Determine artifact name
  const artifactName = await determineArtifactName()
  console.log(`Artifact name: ${artifactName}`)
  console.log(`::notice::Artifact name: ${artifactName}`)

  // Update context with build context (PR info, artifact name, etc.)
  await updateBuildContext(workspace, artifactName)

  // Note: PR context is saved
  if (event?.pull_request?.number) {
    console.log(`::notice::PR #${event.pull_request.number} context saved`)
  }

  // Normalize context: copy CAR into action-context directory
  const normalizedCarPath = await normalizeContextForArtifact(workspace, carPath)

  // Determine upload status based on whether this is a fork PR
  const isForkPR =
    event?.pull_request && event.pull_request.head?.repo?.full_name !== event.pull_request.base?.repo?.full_name
  const uploadStatus = isForkPR ? 'fork-pr-blocked' : 'build-only'

  // Update context with CID and CAR info
  await mergeAndSaveContext(workspace, {
    ipfs_root_cid: ipfsRootCid,
    car_size: carSize,
    upload_status: uploadStatus,
  })

  // Upload build artifact
  await uploadBuildArtifact(workspace, artifactName)

  // Write outputs for action.yml
  await writeOutputs({
    ipfs_root_cid: ipfsRootCid,
    car_path: normalizedCarPath,
    artifact_name: artifactName,
    upload_status: uploadStatus,
  })

  console.log('✓ Build complete. CAR and context saved and uploaded to artifacts')
  console.log('::notice::Build mode complete. CAR file created and saved to artifact.')
}

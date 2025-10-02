import { access, copyFile, mkdir, readdir, readFile, rm, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { Octokit } from '@octokit/rest'
import { ethers } from 'ethers'
import pc from 'picocolors'
import pino from 'pino'
import {
  determineArtifactName,
  downloadBuildArtifact,
  readEventPayload,
  restoreCache,
  saveCache,
  uploadResultArtifact,
} from './artifacts.js'
import { createArtifacts } from './cache.js'
import { commentOnPR } from './comments/comment.js'
import { contextWithCar, loadContext, mergeAndSaveContext } from './context.js'
import { getErrorMessage } from './errors.js'
import { cleanupSynapse, handlePayments, initializeSynapse, uploadCarToFilecoin } from './filecoin.js'
import { getInput, parseInputs, resolveContentPath } from './inputs.js'
import { writeOutputs, writeSummary } from './outputs.js'

// Import types for JSDoc
/**
 * @typedef {import('./types.js').CombinedContext} CombinedContext
 * @typedef {import('./types.js').ParsedInputs} ParsedInputs
 * @typedef {import('./types.js').UploadResult} UploadResult
 */

/**
 * Resolve the originating build workflow run ID
 * @param {any} event - GitHub event payload
 */
function resolveBuildRunId(event) {
  const override = getInput('build_run_id')
  if (override) return override

  const envRunId = process.env.GITHUB_EVENT_WORKFLOW_RUN_ID
  if (envRunId) return envRunId

  const workflowRunId = event?.workflow_run?.id ?? event?.workflow_run?.run_id ?? event?.workflow_run?.original_run_id
  if (workflowRunId) return String(workflowRunId)

  console.warn('Unable to determine the originating build workflow run ID. Using empty string.')

  return ''
}

/**
 * Try to reuse previous upload by checking artifacts or cache
 * @param {string} workspace
 * @param {string} rootCid
 * @param {string} buildRunId
 */
async function prepareReuse(workspace, rootCid, buildRunId) {
  if (!rootCid) {
    return { found: false, source: null }
  }

  const token = process.env.GITHUB_TOKEN || getInput('github_token')
  const repoFull = process.env.GITHUB_REPOSITORY
  const ctxDir = join(workspace, 'action-context')
  const ctxPath = join(ctxDir, 'context.json')

  // Check if context already has cached data
  try {
    const text = await readFile(ctxPath, 'utf8')
    const ctx = JSON.parse(text)
    if (ctx.piece_cid && ctx.data_set_id && ctx.ipfs_root_cid === rootCid) {
      console.log('Found reusable data in existing context')
      return { found: true, source: 'context' }
    }
  } catch {
    // Ignore if context file doesn't exist
  }

  // Try to download prior artifact by CID
  if (token && repoFull) {
    const [owner, repo] = repoFull.split('/')
    if (!owner || !repo) {
      console.warn('Invalid repository format:', repoFull)
      return { found: false, source: null }
    }
    const octokit = new Octokit({ auth: token })
    const targetName = `filecoin-pin-${rootCid}`

    try {
      const artifacts = await octokit.paginate(octokit.rest.actions.listArtifactsForRepo, {
        owner,
        repo,
        per_page: 100,
      })

      const found = artifacts.find((a) => a.name === targetName && !a.expired)

      if (found) {
        console.log(`Found reusable artifact: ${targetName}`)
        const destDir = join(ctxDir, 'artifact.tmp')
        await mkdir(destDir, { recursive: true })

        // Use the artifacts.js helper to download the artifact
        await downloadBuildArtifact(workspace, targetName, buildRunId)

        // Merge artifact metadata into context
        const files = await readdir(destDir)
        const metaName =
          files.find((f) => f.toLowerCase() === 'upload.json') || files.find((f) => f.toLowerCase() === 'context.json')
        if (metaName) {
          const srcMeta = join(destDir, metaName)
          const text = await readFile(srcMeta, 'utf8')
          const meta = JSON.parse(text)

          await mergeAndSaveContext(workspace, {
            ipfs_root_cid: meta.ipfsRootCid || rootCid,
            piece_cid: meta.pieceCid,
            data_set_id: meta.dataSetId,
            provider: meta.provider,
            network: meta.network,
            preview_url: meta.previewURL,
            metadata_path: join(ctxDir, 'context.json'),
            upload_status: 'reused-artifact',
          })
        }

        // Copy CAR file
        const carName = files.find((f) => f.toLowerCase().endsWith('.car'))
        if (carName) {
          const srcCar = join(destDir, carName)
          const destCar = join(ctxDir, carName)
          // Remove other CAR files
          try {
            const existing = await readdir(ctxDir)
            await Promise.all(
              existing
                .filter((name) => name.toLowerCase().endsWith('.car') && name !== carName)
                .map((name) => unlink(join(ctxDir, name)))
            )
          } catch {
            // Ignore cleanup errors
          }
          await copyFile(srcCar, destCar)
          await mergeAndSaveContext(workspace, contextWithCar(workspace, destCar))
        }

        // Cleanup temp files
        try {
          await rm(destDir, { recursive: true, force: true })
        } catch {
          // Ignore cleanup errors
        }

        return { found: true, source: 'artifact' }
      }
    } catch (error) {
      console.warn('Failed to check for reusable artifacts:', getErrorMessage(error))
    }
  }

  return { found: false, source: null }
}

/**
 * Run upload mode: Download artifact, check reuse, upload to Filecoin if needed
 */
export async function runUpload() {
  const logger = pino({ level: process.env.LOG_LEVEL || 'info' })
  const workspace = process.env.GITHUB_WORKSPACE || process.cwd()

  console.log('━━━ Upload Mode: Uploading to Filecoin ━━━')

  // Parse inputs (upload mode needs wallet)
  /** @type {ParsedInputs} */
  const inputs = parseInputs('upload')
  const { walletPrivateKey, contentPath, minDays, maxBalance, maxTopUp, withCDN, providerAddress } = inputs
  const targetPath = resolveContentPath(contentPath)

  const event = await readEventPayload()

  // Determine which artifact to download and download it
  const buildRunId = resolveBuildRunId(event)
  const artifactName = await determineArtifactName(event, buildRunId)
  console.log(`Looking for artifact: ${artifactName}`)

  if (!buildRunId) {
    throw new Error(
      'Unable to determine the originating build workflow run ID. ' +
        'Ensure this upload workflow is triggered by workflow_run or pass build_run_id explicitly when running manually.'
    )
  }

  // Download the build artifact
  await downloadBuildArtifact(workspace, artifactName, buildRunId)

  // Context should now be loaded from downloaded artifact
  const ctxDir = join(workspace, 'action-context')
  try {
    const entries = await readdir(ctxDir)
    console.log('[artifact-debug] action-context directory entries:', entries)
  } catch (error) {
    console.warn('[artifact-debug] Failed to read action-context directory:', getErrorMessage(error))
  }
  try {
    const rawContext = await readFile(join(ctxDir, 'context.json'), 'utf8')
    console.log(`[artifact-debug] action-context/context.json raw contents: ${rawContext}`)
  } catch (error) {
    console.warn('[artifact-debug] Unable to read action-context/context.json:', getErrorMessage(error))
  }

  /** @type {Partial<CombinedContext>} */
  let ctx = await loadContext(workspace)
  console.log('[artifact-debug] Loaded context after download:', ctx)

  // Check if this was a fork PR that was blocked
  if (ctx.upload_status === 'fork-pr-blocked') {
    console.log('━━━ Fork PR Upload Blocked ━━━')
    console.log('::notice::Fork PR detected - content built but not uploaded to Filecoin, will comment on PR')

    const rootCid = ctx.ipfs_root_cid || ''

    // Write outputs indicating fork PR was blocked
    await writeOutputs({
      ipfs_root_cid: rootCid,
      data_set_id: '',
      piece_cid: '',
      provider_id: '',
      provider_name: '',
      car_path: ctx.car_path || '',
      metadata_path: join(workspace, 'action-context', 'context.json'),
      upload_status: 'fork-pr-blocked',
      cache_key: '',
    })

    await writeSummary(ctx, 'Fork PR blocked')

    // Comment on PR with the actual IPFS Root CID
    const prNumber = ctx.pr?.number
    await commentOnPR({
      ipfsRootCid: rootCid,
      dataSetId: '',
      pieceCid: '',
      uploadStatus: 'fork-pr-blocked',
      ...(prNumber !== undefined && { prNumber }),
      githubToken: process.env.GITHUB_TOKEN || getInput('github_token') || '',
      githubRepository: process.env.GITHUB_REPOSITORY || '',
    })

    console.log('✓ Fork PR blocked - PR comment posted explaining the limitation')
    return
  }

  if (!ctx.ipfs_root_cid) {
    throw new Error('No IPFS Root CID found in context. Build artifact may be missing.')
  }

  const rootCid = ctx.ipfs_root_cid
  console.log(`Root CID from context: ${rootCid}`)

  // Try to restore cache first
  const cacheKey = `filecoin-v1-${rootCid}`
  const cacheRestored = await restoreCache(workspace, cacheKey, buildRunId)

  // If cache restored, reload context
  if (cacheRestored) {
    /** @type {Partial<CombinedContext>} */
    ctx = await loadContext(workspace)
    console.log('[artifact-debug] Loaded context after cache restore:', ctx)
  }

  // Try to reuse previous upload
  const reuse = await prepareReuse(workspace, rootCid, buildRunId)

  if (reuse.found) {
    // Reload context after reuse preparation
    ctx = await loadContext(workspace)

    // Determine CAR path
    let resolvedCarPath = ctx.car_path
    if (!resolvedCarPath) {
      const ctxDir = join(workspace, 'action-context')
      const files = await readdir(ctxDir)
      const car = files.find((f) => f.toLowerCase().endsWith('.car'))
      if (car) resolvedCarPath = join(ctxDir, car)
    }

    const metadataPath = ctx.metadata_path || join(workspace, 'action-context', 'context.json')
    const uploadStatus = reuse.source === 'artifact' ? 'reused-artifact' : 'reused-cache'

    await writeOutputs({
      ipfs_root_cid: ctx.ipfs_root_cid || '',
      data_set_id: ctx.data_set_id || '',
      piece_cid: ctx.piece_cid || '',
      provider_id: ctx.provider?.id || '',
      provider_name: ctx.provider?.name || '',
      car_path: resolvedCarPath || '',
      metadata_path: metadataPath,
      upload_status: uploadStatus,
      cache_key: `filecoin-v1-${rootCid}`,
    })

    // Ensure balances are correct even when reusing
    let paymentStatus = null
    try {
      if (walletPrivateKey) {
        const synapse = await initializeSynapse(walletPrivateKey, logger)
        paymentStatus = await handlePayments(synapse, { minDays, maxBalance, maxTopUp }, logger)
      }
    } catch (error) {
      console.warn('Balance validation failed:', getErrorMessage(error))
    } finally {
      await cleanupSynapse()
    }

    // Update context with payment status if available
    if (paymentStatus) {
      await mergeAndSaveContext(workspace, {
        payment_status: {
          depositedAmount: paymentStatus?.depositedAmount ? ethers.formatUnits(paymentStatus.depositedAmount, 18) : '0',
          currentBalance: paymentStatus?.depositedAmount ? ethers.formatUnits(paymentStatus.depositedAmount, 18) : '0',
          storageRunway: paymentStatus?.runway ? `${paymentStatus.runway} days` : 'Unknown',
          depositedThisRun: paymentStatus?.depositedAmount
            ? ethers.formatUnits(paymentStatus.depositedAmount, 18)
            : '0',
        },
      })
      // Reload context after payment status update
      ctx = await loadContext(workspace)
    } else {
      console.warn('No payment status found')
    }

    await writeSummary(ctx, uploadStatus === 'reused-artifact' ? 'Reused artifact' : 'Reused cache')

    // Comment on PR
    const prNumber = ctx.pr?.number
    await commentOnPR({
      ipfsRootCid: ctx.ipfs_root_cid || '',
      dataSetId: ctx.data_set_id || '',
      pieceCid: ctx.piece_cid || '',
      uploadStatus,
      previewUrl: ctx.preview_url,
      ...(prNumber !== undefined && { prNumber }),
      githubToken: process.env.GITHUB_TOKEN || getInput('github_token') || '',
      githubRepository: process.env.GITHUB_REPOSITORY || '',
    })

    console.log(`✓ ${uploadStatus === 'reused-artifact' ? 'Reused previous artifact' : 'Reused cached upload'}`)
    console.log(`::notice::${uploadStatus === 'reused-artifact' ? 'Reused previous artifact' : 'Reused cached upload'}`)
    return
  }

  // No reuse found - perform fresh upload
  console.log('No reusable upload found. Performing fresh upload...')
  console.log('::notice::No reusable upload found. Performing fresh upload...')

  // Find CAR file in context
  let carPath = ctx.car_path
  if (
    !carPath ||
    !(await access(carPath)
      .then(() => true)
      .catch(() => false))
  ) {
    const ctxDir = join(workspace, 'action-context')
    const files = await readdir(ctxDir)
    const carFile = files.find((f) => f.toLowerCase().endsWith('.car'))
    if (!carFile) {
      throw new Error('No CAR file found in action-context')
    }
    carPath = join(ctxDir, carFile)
  }

  // Initialize Synapse and upload
  if (!walletPrivateKey) {
    throw new Error('walletPrivateKey is required for upload mode')
  }
  const synapse = await initializeSynapse(walletPrivateKey, logger)
  const paymentStatus = await handlePayments(synapse, { minDays, maxBalance, maxTopUp }, logger)

  const uploadResult = /** @type {UploadResult} */ (
    await uploadCarToFilecoin(synapse, carPath, rootCid, { withCDN, providerAddress }, logger)
  )
  const { pieceCid, pieceId, dataSetId, provider, previewURL, network } = uploadResult

  // Create metadata
  const metadata = {
    network,
    contentPath: targetPath,
    ipfsRootCid: rootCid,
    pieceCid,
    pieceId,
    dataSetId,
    provider,
    previewURL,
  }

  const { artifactCarPath, metadataPath } = await createArtifacts(workspace, carPath, metadata)

  // Update context
  await mergeAndSaveContext(workspace, {
    piece_cid: pieceCid,
    data_set_id: dataSetId,
    provider,
    preview_url: previewURL,
    upload_status: 'uploaded',
    metadata_path: metadataPath,
    car_path: artifactCarPath,
    payment_status: {
      depositedAmount: paymentStatus?.depositedAmount ? ethers.formatUnits(paymentStatus.depositedAmount, 18) : '0',
      currentBalance: paymentStatus?.depositedAmount ? ethers.formatUnits(paymentStatus.depositedAmount, 18) : '0',
      storageRunway: paymentStatus?.runway ? `${paymentStatus.runway} days` : 'Unknown',
      depositedThisRun: paymentStatus?.depositedAmount ? ethers.formatUnits(paymentStatus.depositedAmount, 18) : '0',
    },
  })

  // Save cache
  await saveCache(workspace, cacheKey, ctxDir)

  // Upload result artifact
  const resultArtifactName = `filecoin-pin-${rootCid}`
  await uploadResultArtifact(workspace, resultArtifactName, artifactCarPath, metadataPath)

  // Write outputs
  await writeOutputs({
    ipfs_root_cid: rootCid,
    data_set_id: dataSetId,
    piece_cid: pieceCid,
    provider_id: provider.id || '',
    provider_name: provider.name || '',
    car_path: artifactCarPath,
    metadata_path: metadataPath,
    upload_status: 'uploaded',
    cache_key: cacheKey,
    result_artifact_name: resultArtifactName,
  })

  console.log('\n━━━ Upload Complete ━━━')
  console.log(`Network: ${network}`)
  console.log(`IPFS Root CID: ${pc.bold(rootCid)}`)
  console.log(`Data Set ID: ${dataSetId}`)
  console.log(`::notice::Upload complete. IPFS Root CID: ${rootCid}`)
  console.log(`Piece CID: ${pieceCid}`)
  console.log(`Provider: ${provider.name || 'Unknown'} (ID ${provider.id || 'Unknown'})`)
  console.log(`Preview: ${previewURL}`)

  /** @type {Partial<CombinedContext>} */
  ctx = await loadContext(workspace)
  await writeSummary(ctx, 'Uploaded')

  // Comment on PR
  const prNumber = ctx.pr?.number
  await commentOnPR({
    ipfsRootCid: rootCid,
    dataSetId,
    pieceCid,
    uploadStatus: 'uploaded',
    previewUrl: ctx.preview_url,
    ...(prNumber !== undefined && { prNumber }),
    githubToken: process.env.GITHUB_TOKEN || getInput('github_token') || '',
    githubRepository: process.env.GITHUB_REPOSITORY || '',
  })

  await cleanupSynapse()
}

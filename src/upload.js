import { readdir, access, readFile, writeFile, copyFile, mkdir, unlink, rm, appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import pc from 'picocolors'
import pino from 'pino'
import { Octokit } from '@octokit/rest'
import { loadContext, mergeAndSaveContext, contextWithCar } from './context.js'
import { cleanupSynapse, handlePayments, initializeSynapse, uploadCarToFilecoin } from './filecoin.js'
import { createArtifacts } from './cache.js'
import { getInput, parseInputs, resolveContentPath } from './inputs.js'
import { writeOutputs, writeSummary } from './outputs.js'
import { commentOnPR } from './comment-pr.js'
import { saveCache, restoreCache, uploadResultArtifact } from './artifacts.js'

const pExecFile = promisify(execFile)

/**
 * Download build artifact using GitHub API
 */
async function downloadBuildArtifact(workspace, artifactName, buildRunId) {
  const token = process.env.GITHUB_TOKEN || getInput('github_token')
  const repoFull = process.env.GITHUB_REPOSITORY

  if (!token || !repoFull) {
    throw new Error('GitHub token and repository required for artifact download')
  }

  const [owner, repo] = repoFull.split('/')
  const octokit = new Octokit({ auth: token })

  // List artifacts for the specific run
  const { data: artifacts } = await octokit.rest.actions.listWorkflowRunArtifacts({
    owner,
    repo,
    run_id: buildRunId,
  })

  const artifact = artifacts.artifacts.find(a => a.name === artifactName && !a.expired)
  if (!artifact) {
    throw new Error(`Artifact ${artifactName} not found for run ${buildRunId}`)
  }

  // Download the artifact
  const download = await octokit.rest.actions.downloadArtifact({
    owner,
    repo,
    artifact_id: artifact.id,
    archive_format: 'zip',
  })

  // Extract to action-context directory
  const ctxDir = join(workspace, 'action-context')
  const zipPath = join(ctxDir, 'artifact.zip')
  const destDir = ctxDir

  await mkdir(ctxDir, { recursive: true })
  await writeFile(zipPath, Buffer.from(download.data))
  await pExecFile('unzip', ['-o', zipPath, '-d', destDir])

  // Cleanup zip file
  try { await unlink(zipPath) } catch {}

  console.log(`Downloaded and extracted artifact ${artifactName}`)
}

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
    console.warn('Failed to read event payload:', error?.message || error)
    return {}
  }
}

/**
 * Determine artifact name for upload mode
 */
async function determineArtifactName() {
  const runId = process.env.GITHUB_RUN_ID || ''

  // Manual override for testing
  const manualOverride = getInput('artifact_name')
  if (manualOverride) {
    console.log(`Using manually provided artifact name: ${manualOverride}`)
    return manualOverride
  }

  // Read event payload to get workflow_run info
  const event = await readEventPayload()
  const workflowRunPrNumber = event.workflow_run?.pull_requests?.[0]?.number
  const workflowRunId = event.workflow_run?.id

  if (workflowRunPrNumber) {
    return `filecoin-build-pr-${workflowRunPrNumber}`
  }
  if (workflowRunId) {
    return `filecoin-build-${workflowRunId}`
  }
  // Fallback for manual triggers
  console.warn('No artifact_name provided and no workflow_run context. Using fallback.')
  return `filecoin-build-${runId}`
}

/**
 * Try to reuse previous upload by checking artifacts or cache
 */
async function prepareReuse(workspace, rootCid) {
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
  } catch {}

  // Try to download prior artifact by CID
  if (token && repoFull) {
    const [owner, repo] = repoFull.split('/')
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
        const zipPath = join(ctxDir, 'artifact.zip')
        const destDir = join(ctxDir, 'artifact.tmp')

        const download = await octokit.rest.actions.downloadArtifact({
          owner,
          repo,
          artifact_id: found.id,
          archive_format: 'zip',
        })

        const buffer = Buffer.from(download.data)
        await mkdir(ctxDir, { recursive: true })
        await writeFile(zipPath, buffer)
        await mkdir(destDir, { recursive: true })
        await pExecFile('unzip', ['-o', zipPath, '-d', destDir])

        // Merge artifact metadata into context
        const files = await readdir(destDir)
        const metaName = files.find((f) => f.toLowerCase() === 'upload.json') || files.find((f) => f.toLowerCase() === 'context.json')
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
            previewURL: meta.previewURL,
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
          } catch {}
          await copyFile(srcCar, destCar)
          await mergeAndSaveContext(workspace, contextWithCar(workspace, destCar))
        }

        // Cleanup temp files
        try { await unlink(zipPath) } catch {}
        try { await rm(destDir, { recursive: true, force: true }) } catch {}

        return { found: true, source: 'artifact' }
      }
    } catch (error) {
      console.warn('Failed to check for reusable artifacts:', error?.message || error)
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
  const inputs = parseInputs('upload')
  const { walletPrivateKey, contentPath, minDays, minBalance, maxTopUp, withCDN, providerAddress } = inputs
  const targetPath = resolveContentPath(contentPath)

  // Determine which artifact to download and download it
  const artifactName = await determineArtifactName()
  console.log(`Looking for artifact: ${artifactName}`)

  const buildRunId = getInput('build_run_id') || process.env.GITHUB_EVENT_WORKFLOW_RUN_ID

  // Download the build artifact
  await downloadBuildArtifact(workspace, artifactName, buildRunId)

  // Context should now be loaded from downloaded artifact
  let ctx = await loadContext(workspace)

  if (!ctx.ipfs_root_cid) {
    throw new Error('No IPFS Root CID found in context. Build artifact may be missing.')
  }

  const rootCid = ctx.ipfs_root_cid
  console.log(`Root CID from context: ${rootCid}`)

  // Try to restore cache first
  const ctxDir = join(workspace, 'action-context')
  const cacheKey = `filecoin-v1-${rootCid}`
  const cacheRestored = await restoreCache(workspace, cacheKey, ctxDir)

  // If cache restored, reload context
  if (cacheRestored) {
    ctx = await loadContext(workspace)
  }

  // Try to reuse previous upload
  const reuse = await prepareReuse(workspace, rootCid)

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
    try {
      const synapse = await initializeSynapse(walletPrivateKey, logger)
      await handlePayments(synapse, { minDays, minBalance, maxTopUp }, logger)
      await cleanupSynapse()
    } catch (error) {
      console.warn('Balance validation failed:', error?.message || error)
    }

    await writeSummary({
      ...ctx,
      car_path: resolvedCarPath || ctx.car_path || '',
      metadata_path: metadataPath,
    }, uploadStatus === 'reused-artifact' ? 'Reused artifact' : 'Reused cache')

    // Comment on PR
    await commentOnPR({
      ipfsRootCid: ctx.ipfs_root_cid,
      dataSetId: ctx.data_set_id,
      pieceCid: ctx.piece_cid,
      uploadStatus,
      prNumber: ctx.pr?.number,
      githubToken: process.env.GITHUB_TOKEN || getInput('github_token'),
      githubRepository: process.env.GITHUB_REPOSITORY
    })

    console.log(`✓ ${uploadStatus === 'reused-artifact' ? 'Reused previous artifact' : 'Reused cached upload'}`)
    return
  }

  // No reuse found - perform fresh upload
  console.log('No reusable upload found. Performing fresh upload...')

  // Find CAR file in context
  let carPath = ctx.car_path
  if (!carPath || !(await access(carPath).then(() => true).catch(() => false))) {
    const ctxDir = join(workspace, 'action-context')
    const files = await readdir(ctxDir)
    const carFile = files.find((f) => f.toLowerCase().endsWith('.car'))
    if (!carFile) {
      throw new Error('No CAR file found in action-context')
    }
    carPath = join(ctxDir, carFile)
  }

  // Initialize Synapse and upload
  const synapse = await initializeSynapse(walletPrivateKey, logger)
  await handlePayments(synapse, { minDays, minBalance, maxTopUp }, logger)

  const uploadResult = await uploadCarToFilecoin(synapse, carPath, rootCid, { withCDN, providerAddress }, logger)
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
    network,
    piece_cid: pieceCid,
    data_set_id: dataSetId,
    provider,
    previewURL,
    upload_status: 'uploaded',
    metadata_path: metadataPath,
    car_path: artifactCarPath,
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
    provider_id: provider.id,
    provider_name: provider.name,
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
  console.log(`Piece CID: ${pieceCid}`)
  console.log(`Provider: ${provider.name} (ID ${provider.id})`)
  console.log(`Preview: ${previewURL}`)

  ctx = await loadContext(workspace)
  await writeSummary(ctx, 'Uploaded')

  // Comment on PR
  await commentOnPR({
    ipfsRootCid: rootCid,
    dataSetId,
    pieceCid,
    uploadStatus: 'uploaded',
    prNumber: ctx.pr?.number,
    githubToken: process.env.GITHUB_TOKEN || getInput('github_token'),
    githubRepository: process.env.GITHUB_REPOSITORY
  })

  await cleanupSynapse()
}

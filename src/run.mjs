import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readdir, access } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import pc from 'picocolors'
import pino from 'pino'
import { createArtifacts } from './cache.js'
import { loadContext, mergeAndSaveContext, contextWithCar } from './context.js'
import { handleError } from './errors.js'
import { cleanupSynapse, createCarFile, handlePayments, initializeSynapse, uploadCarToFilecoin } from './filecoin.js'
// Import our organized modules
import { parseInputs, resolveContentPath } from './inputs.js'
import { writeOutputs, writeSummary } from './outputs.js'

async function resolvePhase(workspace) {
  const explicit = process.env.ACTION_PHASE
  if (explicit) return explicit

  try {
    const ctx = await loadContext(workspace)
    if (ctx?.piece_cid && ctx?.data_set_id) {
      return 'from-cache'
    }
  } catch (error) {
    console.warn('Failed to inspect existing context to determine phase:', error?.message || error)
  }

  return 'upload'
}

async function main() {
  const logger = pino({ level: process.env.LOG_LEVEL || 'info' })

  // Resolve phase first so we can parse inputs correctly (e.g., compute skips wallet)
  const workspace = process.env.GITHUB_WORKSPACE || process.cwd()
  const phase = await resolvePhase(workspace)

  // Parse and validate inputs (pass phase to skip wallet validation in compute mode)
  const inputs = parseInputs(phase)
  const { walletPrivateKey, contentPath, minDays, minBalance, maxTopUp, withCDN, token, providerAddress } = inputs
  const targetPath = resolveContentPath(contentPath)

  // Merge minimal run metadata
  await mergeAndSaveContext(workspace, {
    event_name: process.env.GITHUB_EVENT_NAME || '',
    run_id: process.env.GITHUB_RUN_ID || '',
    repository: process.env.GITHUB_REPOSITORY || '',
    mode: process.env.INPUT_MODE || '',
    phase,
  })

  // PHASE: compute -> pack only, set outputs and exit
  if (phase === 'compute') {
    const { carPath, ipfsRootCid } = await createCarFile(targetPath, contentPath, logger)
    await mergeAndSaveContext(workspace, {
      ipfs_root_cid: ipfsRootCid,
      ...contextWithCar(workspace, carPath),
    })
    await writeOutputs({
      ipfs_root_cid: ipfsRootCid,
      car_path: carPath,
    })
    // Save context at end of compute phase
    await mergeAndSaveContext(workspace, { phase: 'compute:done' })
    return
  }

  // PHASE: from-cache -> read context and set outputs + summary
  if (phase === 'from-cache') {
    const ctx = await loadContext(workspace)

    if (!ctx.piece_cid || !ctx.data_set_id) {
      console.log('No cached metadata found in context. Proceeding without reuse.')
      return
    }

    // Determine CAR path from context or find it in action-context
    let resolvedCarPath = ctx.car_path
    if (!resolvedCarPath) {
      try {
        const ctxDir = join(workspace, 'action-context')
        const files = await readdir(ctxDir)
        const car = files.find((f) => f.toLowerCase().endsWith('.car'))
        if (car) {
          resolvedCarPath = join(ctxDir, car)
        }
      } catch (_) {
        // ignore
      }
    }

    const fromArtifact = String(process.env.FROM_ARTIFACT || '').toLowerCase() === 'true'

    const metadataPath = ctx.metadata_path || join(workspace, 'action-context', 'context.json')

    await writeOutputs({
      ipfs_root_cid: ctx.ipfs_root_cid || '',
      data_set_id: ctx.data_set_id || '',
      piece_cid: ctx.piece_cid || '',
      provider_id: ctx.provider?.id || '',
      provider_name: ctx.provider?.name || '',
      car_path: resolvedCarPath || '',
      metadata_path: metadataPath,
      upload_status: fromArtifact ? 'reused-artifact' : 'reused-cache',
    })

    // Log reuse status
    console.log(fromArtifact ? 'Reused previous artifact (no new upload)' : 'Reused cached metadata (no new upload)')

    // Ensure balances/allowances are still correct
    try {
      const synapse = await initializeSynapse(walletPrivateKey, logger)
      await handlePayments(synapse, { minDays, minBalance, maxTopUp }, logger)
    } catch (error) {
      console.warn('Balance/allowance validation on cache path failed:', error?.message || error)
    } finally {
      await cleanupSynapse()
    }

    // Summary
    const status = fromArtifact ? 'Reused artifact' : 'Reused cache'
    await writeSummary({
      ...ctx,
      car_path: resolvedCarPath || ctx.car_path || '',
      metadata_path: metadataPath,
    }, status)

    await mergeAndSaveContext(workspace, { phase: 'from-cache:done' })
    return
  }

  // PHASE: upload (or default single-phase)
  const preparedCarPath = process.env.PREPARED_CAR_PATH
  const preparedRootCid = process.env.PREPARED_ROOT_CID

  // Initialize Synapse service
  const synapse = await initializeSynapse(walletPrivateKey, logger)

  // Handle payments and top-ups
  await handlePayments(synapse, { minDays, minBalance, maxTopUp }, logger)

  // Prepare CAR and root
  let carPath = preparedCarPath
  // If a glob-like path was provided (e.g., ./action-context/*.car), resolve it
  if (carPath && carPath.includes('*')) {
    try {
      const lastSlash = carPath.lastIndexOf('/')
      const dirPart = lastSlash >= 0 ? carPath.slice(0, lastSlash) : '.'
      const absDir = join(workspace, dirPart)
      const files = await readdir(absDir)
      const carFiles = files.filter((f) => f.toLowerCase().endsWith('.car'))
      if (carFiles.length > 0) {
        carPath = join(absDir, carFiles[0])
      } else {
        throw new Error(`No CAR files found in ${absDir}`)
      }
    } catch (e) {
      console.warn('Failed to resolve CAR file from glob path:', e?.message || e)
      // Fall back to standard flow below, which will recreate the CAR if needed
      carPath = undefined
    }
  }
  let rootCidStr = preparedRootCid
  if (!carPath || !rootCidStr) {
    const { carPath: cPath, ipfsRootCid } = await createCarFile(targetPath, contentPath, logger)
    carPath = cPath
    rootCidStr = ipfsRootCid
  }

  await mergeAndSaveContext(workspace, {
    ipfs_root_cid: rootCidStr,
    ...contextWithCar(workspace, carPath),
  })

  // Upload to Filecoin
  const uploadResult = await uploadCarToFilecoin(synapse, carPath, rootCidStr, { withCDN, providerAddress }, logger)
  const { pieceCid, pieceId, dataSetId, provider, previewURL, network } = uploadResult

  // Create artifacts and metadata
  const metadata = {
    network,
    contentPath: targetPath,
    ipfsRootCid: rootCidStr,
    pieceCid,
    pieceId,
    dataSetId,
    provider,
    previewURL,
  }

  const { artifactCarPath, metadataPath } = await createArtifacts(workspace, carPath, metadata)

  // Write metadata into context
  await mergeAndSaveContext(workspace, {
    network,
    ipfsRootCid: rootCidStr,
    pieceCid,
    pieceId,
    dataSetId,
    provider,
    previewURL,
    data_set_id: dataSetId,
    piece_cid: pieceCid,
    upload_status: 'uploaded',
    metadata_path: metadataPath,
    car_path: artifactCarPath,
    phase: 'upload:done',
  })

  // Set action outputs
  await writeOutputs({
    ipfs_root_cid: rootCidStr,
    data_set_id: dataSetId,
    piece_cid: pieceCid,
    provider_id: provider.id,
    provider_name: provider.name,
    car_path: artifactCarPath,
    metadata_path: metadataPath,
    upload_status: 'uploaded',
  })

  console.log('\n━━━ Filecoin Pin Upload Complete ━━━')
  console.log(`Network: ${network}`)
  console.log(`IPFS Root CID: ${pc.bold(rootCidStr)}`)
  console.log(`Data Set ID: ${dataSetId}`)
  console.log(`Piece CID: ${pieceCid}`)
  console.log(`Provider: ${provider.name} (ID ${provider.id})`)
  console.log(`Preview: ${previewURL}`)
  console.log('Status: New upload performed')

  // Write summary using the latest context
  const updatedContext = await loadContext(workspace)
  await writeSummary(updatedContext, 'Uploaded')

  await cleanupSynapse()
}

main().catch(async (err) => {
  handleError(err, { phase: process.env.ACTION_PHASE || 'single' })
  try {
    await cleanupSynapse()
  } catch (e) {
    console.error('Cleanup failed:', e?.message || e)
  }
  process.exit(1)
})

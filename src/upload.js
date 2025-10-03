import { access } from 'node:fs/promises'
import { ethers } from 'ethers'
import { getPaymentStatus } from 'filecoin-pin/dist/synapse/payments.js'
import pc from 'picocolors'
import pino from 'pino'
import { commentOnPR } from './comments/comment.js'
import { getGlobalContext, mergeAndSaveContext } from './context.js'
import {
  calculateStorageRunway,
  cleanupSynapse,
  handlePayments,
  initializeSynapse,
  uploadCarToFilecoin,
} from './filecoin.js'
import { parseInputs } from './inputs.js'
import { writeOutputs, writeSummary } from './outputs.js'

// Import types for JSDoc
/**
 * @typedef {import('./types.js').CombinedContext} CombinedContext
 * @typedef {import('./types.js').ParsedInputs} ParsedInputs
 * @typedef {import('./types.js').UploadResult} UploadResult
 */

/**
 * Run upload phase: Upload to Filecoin using context data from build phase
 */
export async function runUpload() {
  const logger = pino({ level: process.env.LOG_LEVEL || 'info' })

  console.log('━━━ Upload Phase: Uploading to Filecoin ━━━')

  // Parse inputs (upload phase needs wallet)
  /** @type {ParsedInputs} */
  const inputs = parseInputs('upload')
  const { walletPrivateKey, contentPath, minDays, maxBalance, maxTopUp, withCDN, providerAddress } = inputs

  // Get context from build phase (already in memory from same workflow run)
  /** @type {Partial<CombinedContext>} */
  let ctx = getGlobalContext()
  console.log('[context-debug] Loaded context from build phase:', ctx)

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
      upload_status: 'fork-pr-blocked',
    })

    await writeSummary(ctx, 'Fork PR blocked')

    // Comment on PR with the actual IPFS Root CID
    await commentOnPR(ctx)

    console.log('✓ Fork PR blocked - PR comment posted explaining the limitation')
    return
  }

  if (!ctx.ipfs_root_cid) {
    throw new Error('No IPFS Root CID found in context. Build phase may have failed.')
  }

  const rootCid = ctx.ipfs_root_cid
  console.log(`Root CID from context: ${rootCid}`)

  // Get CAR file path from context
  const carPath = ctx.car_path
  if (!carPath) {
    throw new Error('No CAR file path found in context. Build phase may have failed.')
  }

  // Verify CAR file exists
  try {
    await access(carPath)
  } catch {
    throw new Error(`CAR file not found at ${carPath}`)
  }

  // Initialize Synapse and upload
  if (!walletPrivateKey) {
    throw new Error('walletPrivateKey is required for upload phase')
  }
  const synapse = await initializeSynapse(walletPrivateKey, logger)

  // Get initial payment status to track deposits
  const initialPaymentStatus = await getPaymentStatus(synapse)
  const paymentStatus = await handlePayments(synapse, { minDays, maxBalance, maxTopUp }, logger)

  const uploadResult = /** @type {UploadResult} */ (
    await uploadCarToFilecoin(synapse, carPath, rootCid, { withCDN, providerAddress }, logger)
  )
  const { pieceCid, pieceId, dataSetId, provider, previewURL, network } = uploadResult

  // Calculate the amount deposited in this run
  const initialBalance = initialPaymentStatus?.depositedAmount || 0n
  const finalBalance = paymentStatus?.depositedAmount || 0n
  const depositedThisRun = finalBalance - initialBalance

  // Update context
  await mergeAndSaveContext({
    piece_cid: pieceCid,
    piece_id: pieceId,
    data_set_id: dataSetId,
    provider,
    preview_url: previewURL,
    network,
    content_path: contentPath,
    upload_status: 'uploaded',
    payment_status: {
      depositedAmount: paymentStatus?.depositedAmount ? ethers.formatUnits(paymentStatus.depositedAmount, 18) : '0',
      currentBalance: paymentStatus?.depositedAmount ? ethers.formatUnits(paymentStatus.depositedAmount, 18) : '0',
      storageRunway: calculateStorageRunway(paymentStatus),
      depositedThisRun: ethers.formatUnits(depositedThisRun, 18),
    },
  })

  // Write outputs
  await writeOutputs({
    ipfs_root_cid: rootCid,
    data_set_id: dataSetId,
    piece_cid: pieceCid,
    provider_id: provider.id || '',
    provider_name: provider.name || '',
    car_path: carPath,
    upload_status: 'uploaded',
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
  ctx = getGlobalContext()
  await writeSummary(ctx, 'Uploaded')

  // Comment on PR
  await commentOnPR(ctx)

  await cleanupSynapse()
}

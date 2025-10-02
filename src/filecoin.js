import { promises as fs } from 'node:fs'
import { ethers } from 'ethers'
import { createCarFromPath } from 'filecoin-pin/dist/add/unixfs-car.js'
import { validatePaymentSetup } from 'filecoin-pin/dist/common/upload-flow.js'
import {
  checkAndSetAllowances,
  computeTopUpForDuration,
  depositUSDFC,
  getPaymentStatus,
} from 'filecoin-pin/dist/synapse/payments.js'
// Import filecoin-pin internals
import {
  cleanupSynapseService,
  createStorageContext,
  initializeSynapse as initSynapse,
} from 'filecoin-pin/dist/synapse/service.js'
import { getDownloadURL, uploadToSynapse } from 'filecoin-pin/dist/synapse/upload.js'
import { CID } from 'multiformats/cid'

import { ERROR_CODES, FilecoinPinError, getErrorMessage } from './errors.js'

// Import types for JSDoc
/**
 * @typedef {import('./types.js').ParsedInputs} ParsedInputs
 * @typedef {import('./types.js').BuildResult} BuildResult
 * @typedef {import('./types.js').UploadResult} UploadResult
 */

/**
 * Initialize Synapse sdk with error handling
 * @param {string} walletPrivateKey - Wallet private key
 * @param {any} logger - Logger instance
 * @returns {Promise<any>} Synapse service
 */
export async function initializeSynapse(walletPrivateKey, logger) {
  try {
    // @ts-expect-error - synapse types broken.
    return await initSynapse({ privateKey: walletPrivateKey }, logger)
  } catch (error) {
    const errorMessage = getErrorMessage(error)
    if (errorMessage.includes('invalid private key')) {
      throw new FilecoinPinError('Invalid private key format', ERROR_CODES.INVALID_PRIVATE_KEY)
    }
    throw new FilecoinPinError(`Failed to initialize Synapse: ${errorMessage}`, ERROR_CODES.NETWORK_ERROR)
  }
}

/**
 * Handle payment setup and top-ups
 * @param {any} synapse - Synapse service
 * @param {{ minDays: number, maxBalance?: bigint | undefined, maxTopUp?: bigint | undefined }} options - Payment options
 * @param {any} logger - Logger instance
 * @returns {Promise<any>} Updated payment status
 */
export async function handlePayments(synapse, options, logger) {
  const { minDays, maxBalance, maxTopUp } = options

  // Ensure WarmStorage allowances are at max
  await checkAndSetAllowances(synapse)

  // Check current payment status
  let status = await getPaymentStatus(synapse)

  // Compute top-up to satisfy minDays
  let requiredTopUp = 0n
  if (minDays > 0) {
    const { topUp } = computeTopUpForDuration(status, minDays)
    if (topUp > requiredTopUp) requiredTopUp = topUp
  }

  // Check if deposit would exceed maximum balance if specified
  if (maxBalance != null && maxBalance > 0n) {
    // Check if current balance already equals or exceeds maxBalance
    if (status.depositedAmount >= maxBalance) {
      logger.warn(
        `⚠️  Current balance (${ethers.formatUnits(status.depositedAmount, 18)} USDFC) already equals or exceeds maxBalance (${ethers.formatUnits(maxBalance, 18)} USDFC). No additional deposits will be made.`
      )
      requiredTopUp = 0n // Don't deposit anything
    } else {
      // Check if required top-up would exceed maxBalance
      const projectedBalance = status.depositedAmount + requiredTopUp
      if (projectedBalance > maxBalance) {
        // Calculate the maximum allowed top-up that won't exceed maxBalance
        const maxAllowedTopUp = maxBalance - status.depositedAmount

        if (maxAllowedTopUp <= 0n) {
          // This shouldn't happen due to the check above, but just in case
          logger.warn(
            `⚠️  Cannot deposit any amount without exceeding maxBalance (${ethers.formatUnits(maxBalance, 18)} USDFC). No additional deposits will be made.`
          )
          requiredTopUp = 0n
        } else {
          // Reduce the top-up to fit within maxBalance
          logger.warn(
            `⚠️  Required top-up (${ethers.formatUnits(requiredTopUp, 18)} USDFC) would exceed maxBalance (${ethers.formatUnits(maxBalance, 18)} USDFC). Reducing to ${ethers.formatUnits(maxAllowedTopUp, 18)} USDFC.`
          )
          requiredTopUp = maxAllowedTopUp
        }
      }
    }
  }

  if (requiredTopUp > 0n) {
    if (maxTopUp != null && requiredTopUp > maxTopUp) {
      throw new FilecoinPinError(
        `Top-up required (${ethers.formatUnits(requiredTopUp, 18)} USDFC) exceeds maxTopUp (${ethers.formatUnits(maxTopUp, 18)} USDFC)`,
        ERROR_CODES.INSUFFICIENT_FUNDS
      )
    }

    logger.info(`Depositing ${ethers.formatUnits(requiredTopUp, 18)} USDFC to Filecoin Pay ...`)
    await depositUSDFC(synapse, requiredTopUp)
    status = await getPaymentStatus(synapse)
  }

  return status
}

/**
 * Create CAR file from content path
 * @param {string} targetPath - Path to content
 * @param {string} contentPath - Original content path for logging
 * @param {any} logger - Logger instance
 * @returns {Promise<BuildResult>} CAR file info
 */
export async function createCarFile(targetPath, contentPath, logger) {
  try {
    const stat = await fs.stat(targetPath)
    const isDirectory = stat.isDirectory()
    logger.info(`Packing '${contentPath}' into CAR (UnixFS) ...`)

    const result = await createCarFromPath(targetPath, { isDirectory, logger })
    const { carPath, rootCid } = result

    // Handle different possible return formats from filecoin-pin
    if (!rootCid) {
      throw new FilecoinPinError(
        `createCarFromPath returned unexpected format: ${JSON.stringify(Object.keys(result))}`,
        ERROR_CODES.CAR_CREATE_FAILED
      )
    }

    return { carPath, ipfsRootCid: rootCid.toString(), contentPath }
  } catch (error) {
    throw new FilecoinPinError(`Failed to create CAR file: ${getErrorMessage(error)}`, ERROR_CODES.CAR_CREATE_FAILED)
  }
}

/**
 * Upload CAR to Filecoin via filecoin-pin
 * @param {any} synapse - Synapse service
 * @param {string} carPath - Path to CAR file
 * @param {string} ipfsRootCid - Root CID
 * @param {{ withCDN: boolean, providerAddress: string }} options - Upload options
 * @param {any} logger - Logger instance
 * @returns {Promise<UploadResult>} Upload result
 */
export async function uploadCarToFilecoin(synapse, carPath, ipfsRootCid, options, logger) {
  const { withCDN, providerAddress } = options

  // Set provider address if specified
  if (providerAddress) {
    process.env.PROVIDER_ADDRESS = providerAddress
  }

  // Read CAR data
  const carBytes = await fs.readFile(carPath)

  // Validate payment capacity
  await validatePaymentSetup(synapse, carBytes.length)

  // Create storage context with optional CDN flag
  if (withCDN) process.env.WITH_CDN = 'true'
  const { storage, providerInfo } = await createStorageContext(synapse, logger, {})

  // Upload to Filecoin via filecoin-pin
  const synapseService = { synapse, storage, providerInfo }
  const cid = CID.parse(ipfsRootCid)
  const { pieceCid, pieceId, dataSetId } = await uploadToSynapse(synapseService, carBytes, cid, logger, {
    contextId: `gha-upload-${Date.now()}`,
  })

  const providerId = String(providerInfo.id ?? '')
  const providerName = providerInfo.name ?? (providerInfo.serviceProvider || '')
  const previewURL = getDownloadURL(providerInfo, pieceCid) || `https://ipfs.io/ipfs/${ipfsRootCid}`

  return {
    pieceCid,
    pieceId: pieceId != null ? String(pieceId) : '',
    dataSetId,
    provider: { id: providerId, name: providerName },
    previewURL,
    network: synapse.getNetwork(),
  }
}

/**
 * Cleanup filecoin-pin service
 * @returns {Promise<void>}
 */
export async function cleanupSynapse() {
  try {
    await cleanupSynapseService()
  } catch (error) {
    console.error('Cleanup failed:', getErrorMessage(error))
  }
}

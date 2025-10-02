import { promises as fs } from 'node:fs'
import { getErrorMessage } from './errors.js'

// Import types for JSDoc
/**
 * @typedef {import('./types.js').CombinedContext} CombinedContext
 */

/**
 * Format file size in bytes to human-readable string
 * @param {number | undefined} size - Size in bytes
 * @returns {string} Formatted size string
 */
export function formatSize(size) {
  if (!size) return 'Unknown'
  if (size < 1024) return `${size} bytes`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

/**
 * Write output to GitHub Actions output file
 * @param {string} name - Output name
 * @param {any} value - Output value
 */
export async function writeOutput(name, value) {
  const file = process.env.GITHUB_OUTPUT
  if (!file) return
  await fs.appendFile(file, `\n${name}=${String(value ?? '')}\n`)
}

/**
 * Write multiple outputs at once
 * @param {Object} outputs - Object with output name/value pairs
 */
export async function writeOutputs(outputs) {
  for (const [name, value] of Object.entries(outputs)) {
    await writeOutput(name, value)
  }
}

/**
 * Write summary to GitHub Actions step summary
 * @param {CombinedContext} context - Combined context data
 * @param {string} status - Upload status
 */
export async function writeSummary(context, status) {
  try {
    const summaryFile = process.env.GITHUB_STEP_SUMMARY
    if (!summaryFile) {
      console.warn('No summary file found, GITHUB_STEP_SUMMARY is not set')
      return
    }

    await fs.appendFile(summaryFile, `\n${getOutputSummary(context, status)}\n`)
  } catch (error) {
    console.error('Failed to write summary:', getErrorMessage(error))
  }
}

/**
 * Get the output summary
 * @param {CombinedContext} context - Combined context data
 * @param {string} status - Upload status
 * @returns {string} The output summary
 */
export function getOutputSummary(context, status) {
  const network = context?.network || ''
  const ipfsRootCid = context?.ipfs_root_cid || ''
  const dataSetId = context?.data_set_id || ''
  const pieceCid = context?.piece_cid || ''
  const provider = context?.provider || {}
  const previewURL = context?.preview_url || ''
  const carPath = context?.car_path || ''
  const carSize = context?.car_size
  const carDownloadUrl = context?.car_download_url || (carPath ? `[download link](${carPath})` : 'download')
  const paymentStatus = context?.payment_status || {}

  return [
    '## Filecoin Pin Upload',
    '',
    '**IPFS Artifacts:**',
    `* IPFS Root CID: ${ipfsRootCid}`,
    `* IPFS HTTP Gateway Preview: ${ipfsRootCid ? `https://dweb.link/ipfs/${ipfsRootCid}` : 'IPFS Root CID unavailable'}`,
    `* Status: ${status}`,
    `* Generated CAR on GitHub: ${carDownloadUrl}`,
    `* CAR file size: ${formatSize(carSize)}`,
    '',
    '**Onchain verification:**',
    `* Network: ${network}`,
    `* Data Set ID: [${dataSetId}](https://pdp.vxb.ai/${network || 'mainnet'}/proofsets/${dataSetId})`,
    `* Piece CID: [${pieceCid}](https://pdp.vxb.ai/${network || 'mainnet'}/proofsets/${dataSetId})`,
    `* Provider: [${provider?.name || 'Unknown'} (ID ${provider?.id || 'Unknown'})](https://pdp.vxb.ai/${network || 'mainnet'}/providers/${provider?.id || ''})`,
    `* Piece download direct from provider: ${previewURL}`,
    '',
    '**Payment:**',
    `* Current Filecoin Pay balance: ${paymentStatus.currentBalance || 'Unknown'} USDFC`,
    `* Amount deposited to Filecoin Pay by this workflow: ${paymentStatus.depositedThisRun || '0'} USDFC`,
    `* Data Set Storage runway (assuming all Filecoin Pay balance is used exclusively for this data set): ${paymentStatus.storageRunway || 'Unknown'}`,
    '',
  ].join('\n')
}

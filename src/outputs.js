import { promises as fs } from 'node:fs'
import { getErrorMessage } from './errors.js'

// Import types for JSDoc
/**
 * @typedef {import('./types.js').CombinedContext} CombinedContext
 */

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
    if (!summaryFile) return

    const network = context?.network || ''
    const ipfsRootCid = context?.ipfs_root_cid || ''
    const dataSetId = context?.data_set_id || ''
    const pieceCid = context?.piece_cid || ''
    const provider = context?.provider || {}
    const previewURL = context?.preview_url || ''
    const carPath = context?.car_path || ''
    const metadataPath = context?.metadata_path || ''

    const md = [
      '## Filecoin Pin Upload',
      '',
      `- Network: ${network}`,
      `- IPFS Root CID: \`${ipfsRootCid}\``,
      `- Data Set ID: ${dataSetId}`,
      `- Piece CID: ${pieceCid}`,
      `- Provider: ${provider?.name || ''} (ID ${provider?.id || ''})`,
      `- Preview: ${previewURL}`,
      `- Status: ${status}`,
      '',
      'Artifacts:',
      `- CAR: ${carPath}`,
      `- Metadata: ${metadataPath}`,
      '',
    ].join('\n')

    await fs.appendFile(summaryFile, `\n${md}\n`)
  } catch (error) {
    console.error('Failed to write summary:', getErrorMessage(error))
  }
}

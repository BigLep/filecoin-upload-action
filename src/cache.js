import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { getErrorMessage } from './errors.js'

// Import types for JSDoc
/**
 * @typedef {import('./types.js').CombinedContext} CombinedContext
 */

/**
 * Read cached metadata from cache directory
 * @param {string} cacheDir - Cache directory path
 * @returns {Promise<CombinedContext>} Cached metadata
 */
export async function readCachedMetadata(cacheDir) {
  const metaPath = join(cacheDir, 'context.json')
  const text = await fs.readFile(metaPath, 'utf8')
  return JSON.parse(text)
}

/**
 * Write metadata to cache directory
 * @param {string} cacheDir - Cache directory path
 * @param {Object} metadata - Metadata to cache
 */
export async function writeCachedMetadata(cacheDir, metadata) {
  await fs.mkdir(cacheDir, { recursive: true })
  const metaPath = join(cacheDir, 'context.json')
  // Merge if exists
  try {
    const existing = JSON.parse(await fs.readFile(metaPath, 'utf8'))
    const merged = { ...existing, ...metadata }
    await fs.writeFile(metaPath, JSON.stringify(merged, null, 2))
  } catch {
    await fs.writeFile(metaPath, JSON.stringify(metadata, null, 2))
  }
}

/**
 * Mirror metadata to standard cache location
 * @param {string} workspace - Workspace directory
 * @param {string} ipfsRootCid - Root CID for cache key
 * @param {string} metadataText - Metadata JSON text
 */
export async function mirrorToStandardCache(workspace, ipfsRootCid, metadataText) {
  try {
    const ctxDir = join(workspace, 'action-context')
    await fs.mkdir(ctxDir, { recursive: true })
    const ctxPath = join(ctxDir, 'context.json')
    /** @type {CombinedContext} */
    let existing = {}
    try {
      existing = JSON.parse(await fs.readFile(ctxPath, 'utf8'))
    } catch {
      // Ignore if file doesn't exist
    }
    /** @type {any} */
    const meta = JSON.parse(metadataText)
    // Map common fields
    const mapped = {
      ipfs_root_cid: meta.ipfsRootCid || existing.ipfs_root_cid || ipfsRootCid,
      piece_cid: meta.pieceCid || existing.piece_cid,
      data_set_id: meta.dataSetId || existing.data_set_id,
      provider: meta.provider || existing.provider,
      car_path: meta.carPath || existing.car_path,
    }
    const merged = { ...existing, ...mapped }
    await fs.writeFile(ctxPath, JSON.stringify(merged, null, 2))
  } catch (error) {
    console.warn('Failed to mirror metadata into action-context/context.json:', getErrorMessage(error))
  }
}

/**
 * Create artifact directory and copy files
 * @param {string} workspace - Workspace directory
 * @param {string} carPath - Source CAR file path
 * @param {Object} metadata - Metadata to write
 * @returns {Promise<{artifactDir: string, artifactCarPath: string, metadataPath: string}>} Artifact paths
 */
export async function createArtifacts(workspace, carPath, metadata) {
  const artifactDir = join(workspace, 'filecoin-pin-artifacts')

  try {
    await fs.mkdir(artifactDir, { recursive: true })
  } catch (error) {
    console.error('Failed to create artifact directory:', getErrorMessage(error))
    throw error
  }

  // Copy CAR to artifact directory with a simple name
  const artifactCarPath = join(artifactDir, 'upload.car')
  await fs.copyFile(carPath, artifactCarPath)

  // Write metadata JSON into artifact directory
  const metadataPath = join(artifactDir, 'upload.json')
  await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2))

  return {
    artifactDir,
    artifactCarPath,
    metadataPath,
  }
}

import { promises as fs } from 'node:fs'
import { join, basename } from 'node:path'

/**
 * @typedef {Object} CombinedContext
 * @property {string} [ipfs_root_cid]
 * @property {string} [car_path]
 * @property {string} [car_filename]
 * @property {string} [artifact_name]
 * @property {string} [build_run_id]
 * @property {string} [event_name]
 * @property {Object} [pr]
 * @property {number} [pr.number]
 * @property {string} [pr.sha]
 * @property {string} [pr.title]
 * @property {string} [pr.author]
 * @property {string} [piece_cid]
 * @property {string} [data_set_id]
 * @property {{ id?: string, name?: string }} [provider]
 * @property {string} [upload_status]
 * @property {string} [metadata_path]
 * @property {string} [run_id]
 * @property {string} [repository]
 * @property {string} [mode]
 * @property {string} [phase]
 */

const CONTEXT_DIRNAME = 'action-context'
const CONTEXT_FILENAME = 'context.json'

/**
 * Compute canonical context directory and file paths.
 * @param {string} workspace
 */
function getPaths(workspace) {
  const dir = join(workspace, CONTEXT_DIRNAME)
  const path = join(dir, CONTEXT_FILENAME)
  return { dir, path }
}

/**
 * Load the combined context from action-context/context.json.
 * Returns an empty object if file does not exist.
 * @param {string} workspace
 * @returns {Promise<CombinedContext>}
 */
export async function loadContext(workspace) {
  const { dir, path } = getPaths(workspace)
  try {
    await fs.mkdir(dir, { recursive: true })
  } catch {}
  try {
    const text = await fs.readFile(path, 'utf8')
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' ? parsed : /** @type {CombinedContext} */ ({})
  } catch {
    return /** @type {CombinedContext} */ ({})
  }
}

/**
 * Save the combined context to action-context/context.json.
 * @param {string} workspace
 * @param {CombinedContext} context
 */
export async function saveContext(workspace, context) {
  const { dir, path } = getPaths(workspace)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path, JSON.stringify(context, null, 2))
}

/**
 * Merge the given partial context into existing context and save it.
 * @param {string} workspace
 * @param {Partial<CombinedContext>} partial
 * @returns {Promise<CombinedContext>}
 */
export async function mergeAndSaveContext(workspace, partial) {
  const existing = await loadContext(workspace)
  const merged = { ...existing, ...partial }
  await saveContext(workspace, merged)
  return merged
}

/**
 * Produce context fields for a given CAR path.
 * @param {string} workspace
 * @param {string} carPath
 * @returns {Partial<CombinedContext>}
 */
export function contextWithCar(workspace, carPath) {
  if (!carPath) return {}
  return {
    car_path: carPath,
    car_filename: basename(carPath),
  }
}



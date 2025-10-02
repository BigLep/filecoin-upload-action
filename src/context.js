import { promises as fs } from 'node:fs'
import { basename, join } from 'node:path'

// Import types for JSDoc
/**
 * @typedef {import('./types.js').CombinedContext} CombinedContext
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
 * @returns {Promise<Partial<CombinedContext>>}
 */
export async function loadContext(workspace) {
  const { dir, path } = getPaths(workspace)
  try {
    await fs.mkdir(dir, { recursive: true })
  } catch {
    // Ignore if directory already exists
  }
  try {
    const text = await fs.readFile(path, 'utf8')
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' ? parsed : /** @type {Partial<CombinedContext>} */ ({})
  } catch {
    return /** @type {Partial<CombinedContext>} */ ({})
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
 * @param {string} _workspace
 * @param {string} carPath
 * @returns {Partial<CombinedContext>}
 */
export function contextWithCar(_workspace, carPath) {
  if (!carPath) return {}
  return {
    car_path: carPath,
    car_filename: basename(carPath),
  }
}

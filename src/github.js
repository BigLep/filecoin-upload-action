import { readFile } from 'node:fs/promises'
import { getErrorMessage } from './errors.js'

/**
 * Read GitHub event payload
 */
export async function readEventPayload() {
  const eventPath = process.env.GITHUB_EVENT_PATH
  if (!eventPath) return {}
  try {
    const content = await readFile(eventPath, 'utf8')
    return JSON.parse(content)
  } catch (error) {
    console.warn('Failed to read event payload:', getErrorMessage(error))
    return {}
  }
}

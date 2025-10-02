import { runBuild } from './build.js'
import { mergeAndSaveContext } from './context.js'
import { getErrorMessage, handleError } from './errors.js'
import { cleanupSynapse } from './filecoin.js'
import { getInput } from './inputs.js'
import { runUpload } from './upload.js'

/**
 * Run all mode: Build + upload in single workflow
 */
async function runAll() {
  console.log('━━━ All Mode: Build + Upload in single workflow ━━━')

  // First run build logic
  await runBuild()

  // Then run upload logic
  await runUpload()
}

async function main() {
  const workspace = process.env.GITHUB_WORKSPACE || process.cwd()

  // Read mode from inputs
  const mode = getInput('mode', 'build')
  console.log(`Running in mode: ${mode}`)

  // Merge basic run metadata
  await mergeAndSaveContext(workspace, {
    event_name: process.env.GITHUB_EVENT_NAME || '',
    run_id: process.env.GITHUB_RUN_ID || '',
    repository: process.env.GITHUB_REPOSITORY || '',
    mode,
  })

  try {
    // Route to appropriate handler based on mode
    if (mode === 'build') {
      await runBuild()
    } else if (mode === 'upload') {
      await runUpload()
    } else if (mode === 'all') {
      await runAll()
    } else {
      throw new Error(`Unknown mode: ${mode}. Must be 'build', 'upload', or 'all'`)
    }
  } catch (error) {
    // Cleanup on error
    try {
      await cleanupSynapse()
    } catch (e) {
      console.error('Cleanup failed:', getErrorMessage(e))
    }
    throw error
  }
}

main().catch(async (err) => {
  handleError(err, { mode: getInput('mode', 'build') })
  try {
    await cleanupSynapse()
  } catch (e) {
    console.error('Cleanup failed:', getErrorMessage(e))
  }
  process.exit(1)
})

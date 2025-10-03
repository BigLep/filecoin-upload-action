import { runBuild } from './build.js'
import { mergeAndSaveContext } from './context.js'
import { getErrorMessage, handleError } from './errors.js'
import { cleanupSynapse } from './filecoin.js'
import { runUpload } from './upload.js'

async function main() {
  await mergeAndSaveContext({
    event_name: process.env.GITHUB_EVENT_NAME || '',
    run_id: process.env.GITHUB_RUN_ID || '',
    repository: process.env.GITHUB_REPOSITORY || '',
  })

  try {
    await runBuild()
    await runUpload()
  } catch (error) {
    try {
      await cleanupSynapse()
    } catch (e) {
      console.error('Cleanup failed:', getErrorMessage(e))
    }
    throw error
  }
}

main().catch(async (err) => {
  handleError(err)
  try {
    await cleanupSynapse()
  } catch (e) {
    console.error('Cleanup failed:', getErrorMessage(e))
  }
  process.exit(1)
})

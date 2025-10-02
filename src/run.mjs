import { loadContext, mergeAndSaveContext } from './context.js'
import { getInput } from './inputs.js'
import { handleError } from './errors.js'
import { cleanupSynapse } from './filecoin.js'
import { runBuild } from './build.js'
import { runUpload } from './upload.js'
import { commentOnPR } from './comment-pr.js'

/**
 * Run all mode: Build + upload in single workflow
 */
async function runAll() {
  const logger = (await import('pino')).default({ level: process.env.LOG_LEVEL || 'info' })
  const workspace = process.env.GITHUB_WORKSPACE || process.cwd()

  console.log('━━━ All Mode: Build + Upload in single workflow ━━━')

  // First run build logic
  await runBuild()

  // Then run upload logic
  await runUpload()

  // For all mode, we need to comment on PR if it's a PR event
  if (process.env.GITHUB_EVENT_NAME === 'pull_request') {
    const ctx = await loadContext(workspace)
    await commentOnPR({
      ipfsRootCid: ctx.ipfs_root_cid,
      dataSetId: ctx.data_set_id,
      pieceCid: ctx.piece_cid,
      uploadStatus: ctx.upload_status,
      prNumber: ctx.pr?.number,
      githubToken: process.env.GITHUB_TOKEN || getInput('github_token'),
      githubRepository: process.env.GITHUB_REPOSITORY
    })
  }
}

async function main() {
  const workspace = process.env.GITHUB_WORKSPACE || process.cwd()

  // Read mode from inputs
  const mode = getInput('mode', 'build')
  console.log(`Running in mode: ${mode}`)

  // Initialize or load context
  let ctx = await loadContext(workspace)

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
      console.error('Cleanup failed:', e?.message || e)
    }
    throw error
  }
}

main().catch(async (err) => {
  handleError(err, { mode: getInput('mode', 'build') })
  try {
    await cleanupSynapse()
  } catch (e) {
    console.error('Cleanup failed:', e?.message || e)
  }
  process.exit(1)
})

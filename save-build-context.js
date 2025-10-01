#!/usr/bin/env node
/**
 * Save build context for transfer from build mode to upload mode
 */
import { writeFile, mkdir } from 'node:fs/promises'
import { basename, join } from 'node:path'

async function main() {
  const workspace = process.env.GITHUB_WORKSPACE || process.cwd()

  // Parse input from single JSON env var
  let input
  try {
    input = JSON.parse(process.env.BUILD_CONTEXT_INPUT || '{}')
  } catch (error) {
    console.error('::error::Failed to parse BUILD_CONTEXT_INPUT:', error.message)
    process.exit(1)
  }

  // Build context object
  const context = {
    ipfs_root_cid: input.ipfs_root_cid || '',
    car_filename: input.car_path ? basename(input.car_path) : '',
    artifact_name: input.artifact_name || '',
    build_run_id: input.build_run_id || '',
    event_name: input.event_name || '',
    pr: null,
  }

  // Extract PR info if available
  if (input.pr && typeof input.pr === 'object') {
    context.pr = {
      number: input.pr.number || 0,
      sha: input.pr.head?.sha || '',
      title: input.pr.title || '',
      author: input.pr.user?.login || '',
    }
  }

  // Ensure directory exists in workspace
  const contextDir = join(workspace, 'filecoin-build-context')
  await mkdir(contextDir, { recursive: true })

  // Write context
  const contextPath = join(contextDir, 'build-context.json')
  await writeFile(
    contextPath,
    JSON.stringify(context, null, 2),
    'utf-8'
  )

  console.log(`::notice::Saved build context with Root CID: ${context.ipfs_root_cid}`)
  if (context.pr) {
    console.log(`::notice::Included PR context for PR #${context.pr.number}`)
  }
}

main().catch((err) => {
  console.error('Failed to save build context:', err.message)
  process.exit(1)
})


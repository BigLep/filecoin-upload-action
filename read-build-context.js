#!/usr/bin/env node
/**
 * Read build context from artifact and set GitHub Actions outputs
 */
import { readFile, appendFile } from 'node:fs/promises'
import { join } from 'node:path'

async function main() {
  const workspace = process.env.GITHUB_WORKSPACE || process.cwd()
  const contextPath = join(workspace, 'filecoin-build-restore/.filecoin-build-context/build-context.json')

  let context
  try {
    const content = await readFile(contextPath, 'utf-8')
    context = JSON.parse(content)
  } catch (error) {
    console.error(`::error::Build context file not found at ${contextPath}`)
    console.error(`Error: ${error.message}`)
    process.exit(1)
  }

  // Set GitHub Actions outputs
  const githubOutput = process.env.GITHUB_OUTPUT
  if (!githubOutput) {
    console.error('::error::GITHUB_OUTPUT environment variable not set')
    process.exit(1)
  }

  const outputs = {
    root_cid: context.ipfs_root_cid || '',
    pr_number: context.pr?.number || '',
    artifact_name: context.artifact_name || '',
    build_run_id: context.build_run_id || '',
    event_name: context.event_name || '',
  }

  // Write outputs
  const outputLines = Object.entries(outputs)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')

  await appendFile(githubOutput, outputLines + '\n', 'utf-8')

  // Log notices
  console.log(`::notice::Extracted Root CID from build context: ${outputs.root_cid}`)
  if (outputs.pr_number) {
    console.log(`::notice::Extracted PR number from build context: ${outputs.pr_number}`)
  } else {
    console.log('::notice::No PR context found, PR commenting will be skipped')
  }

  // Optional: log full context for debugging
  console.log('Build context:', JSON.stringify(context, null, 2))
}

main().catch((err) => {
  console.error('Failed to read build context:', err.message)
  process.exit(1)
})


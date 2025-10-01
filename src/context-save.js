#!/usr/bin/env node
import { mergeAndSaveContext } from './context.js'
/**
 * Merge JSON from CONTEXT_INPUT into action-context/context.json and save.
 */

async function main() {
  const workspace = process.env.GITHUB_WORKSPACE || process.cwd()

  let input
  try {
    input = JSON.parse(process.env.CONTEXT_INPUT || '{}')
  } catch (e) {
    console.error('::error::Failed to parse CONTEXT_INPUT JSON')
    process.exit(1)
  }

  const merged = await mergeAndSaveContext(workspace, input)
  console.log('Context saved:', JSON.stringify(merged, null, 2))
}

main().catch((err) => {
  console.error('Failed to save combined context:', err?.message || err)
  process.exit(1)
})



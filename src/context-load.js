#!/usr/bin/env node
import { appendFile, access } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { join } from 'node:path'
import { loadContext } from './context.js'
/**
 * Load combined context and expose as step outputs with context_* prefixes.
 */

async function main() {
  const workspace = process.env.GITHUB_WORKSPACE || process.cwd()
  const ctx = await loadContext(workspace)

  const carFilename = ctx.car_filename || ''

  let carPath = ctx.car_path || ''
  if (carFilename) {
    const candidates = []
    if (carPath) candidates.push(carPath)
    candidates.push(join(workspace, 'action-context', carFilename))

    for (const candidate of candidates) {
      if (!candidate) continue
      try {
        await access(candidate, fsConstants.F_OK)
        carPath = candidate
        break
      } catch {}
    }
  }

  const outputs = {
    context_root_cid: ctx.ipfs_root_cid || '',
    context_car_path: carPath,
    context_car_filename: carFilename,
    context_piece_cid: ctx.piece_cid || '',
    context_data_set_id: ctx.data_set_id || '',
    context_provider_id: (ctx.provider && ctx.provider.id) || '',
    context_provider_name: (ctx.provider && ctx.provider.name) || '',
    context_upload_status: ctx.upload_status || '',
    context_metadata_path: ctx.metadata_path || '',
    context_artifact_name: ctx.artifact_name || '',
    context_build_run_id: ctx.build_run_id || '',
    context_event_name: ctx.event_name || '',
    context_pr_number: ctx.pr?.number ? String(ctx.pr.number) : '',
    context_pr_sha: ctx.pr?.sha || '',
    context_pr_title: ctx.pr?.title || '',
    context_pr_author: ctx.pr?.author || '',
  }

  const githubOutput = process.env.GITHUB_OUTPUT
  if (githubOutput) {
    const lines = Object.entries(outputs)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n')
    await appendFile(githubOutput, lines + '\n', 'utf-8')
  }

  console.log('Loaded combined context:', JSON.stringify(outputs, null, 2))
}

main().catch((err) => {
  console.error('Failed to load combined context:', err?.message || err)
  process.exit(1)
})

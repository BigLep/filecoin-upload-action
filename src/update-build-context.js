#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { mergeAndSaveContext } from './context.js'

async function readEventPayload() {
  const eventPath = process.env.GITHUB_EVENT_PATH
  if (!eventPath) return {}
  try {
    const content = await readFile(eventPath, 'utf8')
    return JSON.parse(content)
  } catch (error) {
    console.warn('Failed to read event payload:', error?.message || error)
    return {}
  }
}

async function main() {
  const workspace = process.env.GITHUB_WORKSPACE || process.cwd()
  const artifactName = process.env.ARTIFACT_NAME || ''
  const buildRunId = process.env.GITHUB_RUN_ID || ''
  const eventName = process.env.GITHUB_EVENT_NAME || ''

  const event = await readEventPayload()

  const payload = {
    artifact_name: artifactName,
    build_run_id: buildRunId,
    event_name: eventName,
  }

  if (event && event.pull_request) {
    const pr = event.pull_request
    payload.pr = {
      number: typeof pr.number === 'number' ? pr.number : Number(pr.number) || 0,
      sha: pr?.head?.sha || '',
      title: pr?.title || '',
      author: pr?.user?.login || '',
    }
  }

  const merged = await mergeAndSaveContext(workspace, payload)
  console.log('Updated combined context with artifact metadata:', JSON.stringify(merged, null, 2))
}

main().catch((error) => {
  console.error('Failed to update combined context with artifact metadata:', error?.message || error)
  process.exit(1)
})

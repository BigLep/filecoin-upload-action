#!/usr/bin/env node
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Octokit } from '@octokit/rest'
import { mergeAndSaveContext } from './context.js'

const pExecFile = promisify(execFile)

async function fileExists(path) {
  try {
    await fs.access(path)
    return true
  } catch {
    return false
  }
}

async function unzip(zipPath, destDir) {
  await fs.mkdir(destDir, { recursive: true })
  await pExecFile('unzip', ['-o', zipPath, '-d', destDir])
}

async function main() {
  const workspace = process.env.GITHUB_WORKSPACE || process.cwd()
  const token = process.env.GITHUB_TOKEN
  const repoFull = process.env.GITHUB_REPOSITORY
  const rootCid = process.env.ROOT_CID

  if (!rootCid) {
    console.log('No ROOT_CID provided to prepare-reuse; skipping')
    return
  }

  const ctxDir = join(workspace, 'action-context')
  const ctxPath = join(ctxDir, 'context.json')

  const outputs = {
    found: 'false',
    reuse_source: '',
    reuse_dir: '',
  }

  // Check if context already has cached data
  let ctx = {}
  if (await fileExists(ctxPath)) {
    const text = await fs.readFile(ctxPath, 'utf8')
    ctx = JSON.parse(text)
    if (ctx.piece_cid && ctx.data_set_id && ctx.ipfs_root_cid === rootCid) {
      outputs.found = 'true'
      outputs.reuse_source = 'context'
      outputs.reuse_dir = ctxDir
    }
  }

  if (outputs.found === 'false' && token && repoFull) {
    // Try to download prior artifact by CID
    const [owner, repo] = repoFull.split('/')
    const octokit = new Octokit({ auth: token })
    const targetName = `filecoin-pin-${rootCid}`

    const artifacts = await octokit.paginate(octokit.rest.actions.listArtifactsForRepo, {
      owner,
      repo,
      per_page: 100,
    })

    const found = artifacts.find((a) => a.name === targetName && !a.expired)

    if (found) {
      const ctxDir = join(workspace, 'action-context')
      const zipPath = join(ctxDir, 'artifact.zip')
      const destDir = join(ctxDir, 'artifact.tmp')

      const download = await octokit.rest.actions.downloadArtifact({
        owner,
        repo,
        artifact_id: found.id,
        archive_format: 'zip',
      })

      const buffer = Buffer.from(download.data)
      await fs.writeFile(zipPath, buffer)
      await unzip(zipPath, destDir)

      // Merge artifact metadata into action-context/context.json
      try {
        const files = await fs.readdir(destDir)
        const metaName = files.find((f) => f.toLowerCase() === 'upload.json') || files.find((f) => f.toLowerCase() === 'context.json')
        if (metaName) {
          const srcMeta = join(destDir, metaName)
          const text = await fs.readFile(srcMeta, 'utf8')
          const meta = JSON.parse(text)

          // Map old format to new context format and merge
          await mergeAndSaveContext(workspace, {
            ipfs_root_cid: meta.ipfsRootCid || ctx.ipfs_root_cid || rootCid,
            piece_cid: meta.pieceCid || ctx.piece_cid,
            data_set_id: meta.dataSetId || ctx.data_set_id,
            provider: meta.provider || ctx.provider,
            car_path: meta.carPath || ctx.car_path,
          })
        }
        // Copy a CAR file into action-context/ (if present)
        const carName = files.find((f) => f.toLowerCase().endsWith('.car'))
        if (carName) {
          const srcCar = join(destDir, carName)
          await fs.copyFile(srcCar, join(ctxDir, carName))
        }
      } catch {}

      // Cleanup temp files
      try { await fs.unlink(zipPath) } catch {}
      try {
        const entries = await fs.readdir(destDir)
        await Promise.all(entries.map((e) => fs.rm(join(destDir, e), { recursive: true, force: true })))
        await fs.rmdir(destDir, { recursive: true })
      } catch {}

      outputs.found = 'true'
      outputs.reuse_source = 'artifact'
      outputs.reuse_dir = ctxDir
    }
  }

  const githubOutput = process.env.GITHUB_OUTPUT
  if (githubOutput) {
    const lines = Object.entries(outputs)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n')
    await fs.appendFile(githubOutput, lines + '\n', 'utf-8')
  }

  console.log('Prepare reuse result:', outputs)
}

main().catch((err) => {
  console.error('prepare-reuse failed:', err?.message || err)
  process.exit(1)
})



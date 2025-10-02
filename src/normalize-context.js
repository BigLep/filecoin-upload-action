#!/usr/bin/env node
import { promises as fs } from 'node:fs'
import { constants as fsConstants } from 'node:fs'
import { basename, join } from 'node:path'
import { mergeAndSaveContext, contextWithCar } from './context.js'

async function ensureCarExists(carPath) {
  if (!carPath) {
    throw new Error('CAR_PATH environment variable is required')
  }
  try {
    await fs.access(carPath, fsConstants.F_OK)
  } catch {
    throw new Error(`CAR file not found at ${carPath}`)
  }
}

async function removeExistingCars(dir, keepName) {
  try {
    const entries = await fs.readdir(dir)
    await Promise.all(
      entries
        .filter((name) => name.toLowerCase().endsWith('.car') && name !== keepName)
        .map((name) => fs.unlink(join(dir, name)))
    )
  } catch {
    // Ignore if directory cannot be read yet
  }
}

async function main() {
  const carPath = process.env.CAR_PATH
  await ensureCarExists(carPath)

  const workspace = process.env.GITHUB_WORKSPACE || process.cwd()
  const contextDir = join(workspace, 'action-context')
  await fs.mkdir(contextDir, { recursive: true })

  const carName = basename(carPath)
  const destination = join(contextDir, carName)

  await removeExistingCars(contextDir, carName)
  await fs.copyFile(carPath, destination)

  await mergeAndSaveContext(workspace, contextWithCar(workspace, destination))

  const outputFile = process.env.GITHUB_OUTPUT
  if (outputFile) {
    const lines = [`car_path=${destination}`, `car_filename=${carName}`]
    await fs.appendFile(outputFile, `${lines.join('\n')}\n`, 'utf8')
  }

  console.log(`Normalized action-context with ${carName}`)
}

main().catch((error) => {
  console.error(`::error::${error?.message || error}`)
  process.exit(1)
})

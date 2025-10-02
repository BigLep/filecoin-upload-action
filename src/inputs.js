import { resolve } from 'node:path'
import { ethers } from 'ethers'

// Import types for JSDoc
/**
 * @typedef {import('./types.js').ParsedInputs} ParsedInputs
 */

/**
 * Check if object has own property
 * @param {any} object - Object to check
 * @param {string} key - Property key
 * @returns {boolean} True if object has own property
 */
const own = (object, key) => Object.hasOwn(object, key)

/** @type {any} */
let cachedInputsJson

function readInputsJson() {
  if (cachedInputsJson !== undefined) return cachedInputsJson

  const raw = process.env.INPUTS_JSON
  if (!raw) {
    cachedInputsJson = null
    return cachedInputsJson
  }

  try {
    cachedInputsJson = JSON.parse(raw)
  } catch (error) {
    throw new Error(`Failed to parse INPUTS_JSON: ${error instanceof Error ? error.message : String(error)}`)
  }

  return cachedInputsJson
}

/**
 * Convert value to string with fallback
 * @param {any} value - Value to convert
 * @param {string} fallback - Fallback value
 * @returns {string} String representation
 */
function toStringValue(value, fallback = '') {
  if (value === undefined || value === null) return String(fallback ?? '')
  return typeof value === 'string' ? value : String(value)
}

/**
 * Get input value from environment variables
 * @param {string} name - Input name
 * @param {string} fallback - Default value
 * @returns {string} Input value
 */
export function getInput(name, fallback = '') {
  const json = readInputsJson()
  if (json && own(json, name)) {
    return toStringValue(json[name], fallback).trim()
  }

  const envKey = `INPUT_${name.toUpperCase()}`
  if (process.env[envKey] !== undefined && process.env[envKey] !== null) {
    return toStringValue(process.env[envKey], fallback).trim()
  }

  return toStringValue(fallback).trim()
}

/**
 * Parse boolean value from string
 * @param {any} v - Value to parse
 * @returns {boolean} Parsed boolean
 */
export function parseBoolean(v) {
  if (typeof v === 'boolean') return v
  if (typeof v !== 'string') return false
  const s = v.trim().toLowerCase()
  return s === 'true' || s === '1' || s === 'yes'
}

/**
 * Parse and validate all action inputs
 * @param {string} phase - Action phase (compute, from-cache, or upload/single)
 * @returns {ParsedInputs} Parsed and validated inputs
 */
export function parseInputs(phase = 'single') {
  const walletPrivateKey = getInput('walletPrivateKey')
  const contentPath = getInput('path', 'dist')
  const minDaysRaw = getInput('minDays', '10')
  const maxBalanceRaw = getInput('maxBalance', '')
  const maxTopUpRaw = getInput('maxTopUp', '')
  const withCDN = parseBoolean(getInput('withCDN', 'false'))
  const token = getInput('token', 'USDFC')
  const providerAddress = getInput('providerAddress', '0xa3971A7234a3379A1813d9867B531e7EeB20ae07')

  // Validate required inputs (only for phases that need wallet)
  // Build mode (compute phase) doesn't need the wallet
  if (phase !== 'compute' && !walletPrivateKey) {
    throw new Error('walletPrivateKey is required')
  }

  // Parse numeric values
  let minDays = Number(minDaysRaw)
  if (!Number.isFinite(minDays) || minDays < 0) minDays = 0

  const maxBalance = maxBalanceRaw ? ethers.parseUnits(maxBalanceRaw, 18) : undefined
  const maxTopUp = maxTopUpRaw ? ethers.parseUnits(maxTopUpRaw, 18) : undefined

  // Validate token selection (currently USDFC only)
  if (token && token.toUpperCase() !== 'USDFC') {
    throw new Error('Only USDFC is supported at this time for payments. Token override will be enabled later.')
  }
  /** @type {ParsedInputs} */
  const parsedInputs = {
    walletPrivateKey,
    contentPath,
    minDays,
    maxBalance,
    withCDN,
    token,
    providerAddress,
  }

  if (maxTopUp != null) {
    parsedInputs.maxTopUp = maxTopUp
  }

  return parsedInputs
}

/**
 * Resolve content path relative to workspace
 * @param {string} contentPath - Content path
 * @returns {string} Absolute path
 */
export function resolveContentPath(contentPath) {
  const workspace = process.env.GITHUB_WORKSPACE || process.cwd()
  return resolve(workspace, contentPath)
}

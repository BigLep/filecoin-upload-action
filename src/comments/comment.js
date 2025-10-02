import { Octokit } from '@octokit/rest'
import { loadContext } from '../context.js'
import { getErrorMessage } from '../errors.js'
import { getCommentTemplate, renderTemplate } from './templates.js'

/**
 * @typedef {import('../types.js').PrCommentContext} PrCommentContext
 * @typedef {import('../types.js').PrCommentTemplateKeys} PrCommentTemplateKeys
 */

/**
 * Generate comment body based on upload status
 * @param {Pick<CommentPRParams, 'uploadStatus' | 'ipfsRootCid' | 'dataSetId' | 'pieceCid'>} param0
 * @returns
 */
const generateCommentBody = ({ uploadStatus, ipfsRootCid, dataSetId, pieceCid }) => {
  const template = getCommentTemplate(/** @type {PrCommentTemplateKeys} */ (uploadStatus))
  const previewUrl = ipfsRootCid ? `https://ipfs.io/ipfs/${ipfsRootCid}` : 'Preview unavailable'
  /**
   * @type {PrCommentContext}
   */
  const context = {
    uploadStatus,
    ipfsRootCid,
    dataSetId,
    pieceCid,
    previewUrl,
  }

  return renderTemplate(template, context)
}

// Import types for JSDoc
/**
 * @typedef {import('../types.js').CommentPRParams} CommentPRParams
 */

/**
 * Comment on PR with Filecoin upload results
 * @param {CommentPRParams} params
 */
export async function commentOnPR(params) {
  /** @type {CommentPRParams} */
  let { ipfsRootCid, dataSetId, pieceCid, uploadStatus, prNumber, githubToken, githubRepository } = params
  // Try to get PR number from parameter or context
  /** @type {number | undefined} */
  let resolvedPrNumber = prNumber
  if (!resolvedPrNumber) {
    const workspace = process.env.GITHUB_WORKSPACE || process.cwd()
    const ctx = await loadContext(workspace)
    resolvedPrNumber = ctx.pr?.number || undefined
  }

  // Also try from GitHub event
  if (!resolvedPrNumber && process.env.GITHUB_EVENT_NAME === 'pull_request') {
    const envPrNumber = process.env.GITHUB_EVENT_PULL_REQUEST_NUMBER
    resolvedPrNumber = envPrNumber ? parseInt(envPrNumber, 10) : undefined
  }

  if (!ipfsRootCid || !dataSetId || !pieceCid || !resolvedPrNumber || !githubToken || !githubRepository) {
    console.log('Skipping PR comment: missing required information (likely not a PR event)')
    return
  }

  // Check if this is a fork PR that was blocked
  const workspace = process.env.GITHUB_WORKSPACE || process.cwd()
  const ctx = await loadContext(workspace)

  // If this is a fork PR that was blocked, we need to comment with explanation
  if (ctx.pr && ctx.upload_status === 'fork-pr-blocked') {
    console.log('Posting comment for blocked fork PR')
    // Override the upload status for the comment
    uploadStatus = 'fork-pr-blocked'
    // Set dummy values so the comment function doesn't skip
    if (!ipfsRootCid) ipfsRootCid = 'N/A (fork PR blocked)'
    if (!dataSetId) dataSetId = 'N/A (fork PR blocked)'
    if (!pieceCid) pieceCid = 'N/A (fork PR blocked)'
  }

  const [owner, repo] = githubRepository.split('/')
  const issue_number = resolvedPrNumber

  if (!owner || !repo) {
    console.error('Invalid repository format:', githubRepository)
    return
  }

  const octokit = new Octokit({ auth: githubToken })

  const body = generateCommentBody({ uploadStatus, ipfsRootCid, dataSetId, pieceCid })

  try {
    // Find existing comment
    const { data: comments } = await octokit.rest.issues.listComments({
      owner,
      repo,
      issue_number,
      per_page: 100,
    })

    const existing = comments.find(
      (c) => c.user?.type === 'Bot' && (c.body || '').includes('filecoin-pin-upload-action')
    )

    if (existing) {
      console.log(`Updating existing comment ${existing.id} on PR #${issue_number}`)
      await octokit.rest.issues.updateComment({
        owner,
        repo,
        comment_id: existing.id,
        body,
      })
    } else {
      console.log(`Creating new comment on PR #${issue_number}`)
      await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number,
        body,
      })
    }

    console.log('PR comment posted successfully')
  } catch (error) {
    console.error('Failed to comment on PR:', getErrorMessage(error))
    process.exit(1)
  }
}

/**
 * Comment on PR with Filecoin upload results
 *
 * This script posts or updates a comment on a pull request with the upload results.
 * It requires the following environment variables:
 * - IPFS_ROOT_CID: The root CID of the uploaded content
 * - DATA_SET_ID: The Filecoin dataset ID
 * - PIECE_CID: The piece CID
 * - UPLOAD_STATUS: Status of the upload (uploaded, reused-cache, or reused-artifact)
 * - PR_NUMBER: The PR number to comment on
 * - GITHUB_TOKEN: GitHub token for API access
 * - GITHUB_REPOSITORY: Repository in owner/repo format
 */

import { Octokit } from '@octokit/rest'
import { loadContext } from './context.js'

export async function commentOnPR({ ipfsRootCid, dataSetId, pieceCid, uploadStatus, prNumber, githubToken, githubRepository }) {
  // Try to get PR number from parameter or context
  let resolvedPrNumber = prNumber
  if (!resolvedPrNumber) {
    const workspace = process.env.GITHUB_WORKSPACE || process.cwd()
    const ctx = await loadContext(workspace)
    resolvedPrNumber = ctx.pr?.number ? String(ctx.pr.number) : null
  }

  // Also try from GitHub event
  if (!resolvedPrNumber && process.env.GITHUB_EVENT_NAME === 'pull_request') {
    resolvedPrNumber = process.env.GITHUB_EVENT_PULL_REQUEST_NUMBER
  }

  if (!ipfsRootCid || !dataSetId || !pieceCid || !resolvedPrNumber || !githubToken || !githubRepository) {
    console.log('Skipping PR comment: missing required information (likely not a PR event)')
    return
  }

  const [owner, repo] = githubRepository.split('/')
  const issue_number = parseInt(resolvedPrNumber, 10)

  const octokit = new Octokit({ auth: githubToken })

  const preview = 'https://ipfs.io/ipfs/' + ipfsRootCid
  let statusLine = '- Status: '
  if (uploadStatus === 'uploaded') statusLine += 'Uploaded new content'
  else if (uploadStatus === 'reused-cache') statusLine += 'Reused cached content'
  else if (uploadStatus === 'reused-artifact') statusLine += 'Reused artifact content'
  else statusLine += 'Unknown (see job logs)'

  const body = [
    '<!-- filecoin-pin-upload-action -->',
    'Filecoin Pin Upload ✅',
    '',
    '- IPFS Root CID: `' + ipfsRootCid + '`',
    '- Data Set ID: `' + dataSetId + '`',
    '- Piece CID: `' + pieceCid + '`',
    '',
    statusLine,
    '',
    '- Preview (temporary centralized gateway):',
    '  - ' + preview,
  ].join('\n')

  try {
    // Find existing comment
    const { data: comments } = await octokit.rest.issues.listComments({
      owner,
      repo,
      issue_number,
      per_page: 100
    })

    const existing = comments.find(c => c.user?.type === 'Bot' && (c.body || '').includes('filecoin-pin-upload-action'))

    if (existing) {
      console.log(`Updating existing comment ${existing.id} on PR #${issue_number}`)
      await octokit.rest.issues.updateComment({
        owner,
        repo,
        comment_id: existing.id,
        body
      })
    } else {
      console.log(`Creating new comment on PR #${issue_number}`)
      await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number,
        body
      })
    }

    console.log('PR comment posted successfully')
  } catch (error) {
    console.error('Failed to comment on PR:', error?.message || error)
    process.exit(1)
  }
}

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

async function commentOnPR() {
  const { IPFS_ROOT_CID, DATA_SET_ID, PIECE_CID, UPLOAD_STATUS, PR_NUMBER, GITHUB_TOKEN, GITHUB_REPOSITORY } = process.env

  if (!IPFS_ROOT_CID || !DATA_SET_ID || !PIECE_CID || !PR_NUMBER || !GITHUB_TOKEN || !GITHUB_REPOSITORY) {
    console.error('Missing required environment variables')
    process.exit(1)
  }

  const [owner, repo] = GITHUB_REPOSITORY.split('/')
  const issue_number = parseInt(PR_NUMBER, 10)

  const octokit = new Octokit({ auth: GITHUB_TOKEN })

  const preview = 'https://ipfs.io/ipfs/' + IPFS_ROOT_CID
  let statusLine = '- Status: '
  if (UPLOAD_STATUS === 'uploaded') statusLine += 'Uploaded new content'
  else if (UPLOAD_STATUS === 'reused-cache') statusLine += 'Reused cached content'
  else if (UPLOAD_STATUS === 'reused-artifact') statusLine += 'Reused artifact content'
  else statusLine += 'Unknown (see job logs)'

  const body = [
    '<!-- filecoin-pin-upload-action -->',
    'Filecoin Pin Upload ✅',
    '',
    '- IPFS Root CID: `' + IPFS_ROOT_CID + '`',
    '- Data Set ID: `' + DATA_SET_ID + '`',
    '- Piece CID: `' + PIECE_CID + '`',
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

commentOnPR()


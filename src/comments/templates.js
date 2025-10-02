/**
 * @typedef {import('../types.js').PrCommentContext} PrCommentContext
 * @typedef {import('../types.js').CombinedContext} CombinedContext
 * @typedef {import('../types.js').PrCommentTemplate} PrCommentTemplate
 * @typedef {import('../types.js').PrCommentTemplateKeys} PrCommentTemplateKeys
 */

/**
 * @type {Record<string, string>}
 * @description Status messages for each upload status
 */
const statusMessages = {
  uploaded: 'Uploaded new content',
  'reused-cache': 'Reused cached content',
  'reused-artifact': 'Reused artifact content',
  'fork-pr-blocked': 'Blocked - Fork PR support temporarily disabled',
}

const COMMENT_HEADER = '<!-- filecoin-pin-upload-action -->'

/**
 * @param {PrCommentContext} ctx
 * @returns {string}
 */
function statusLine(ctx) {
  return `- Status: ${statusMessages[ctx.uploadStatus] || 'Unknown (see job logs)'}`
}

/**
 * @type {Record<PrCommentTemplateKeys, PrCommentTemplate>}
 */
export const commentTemplates = {
  success: {
    heading: 'Filecoin Pin Upload ✅',
    sections: [
      (ctx) => [
        `- IPFS Root CID: \`${ctx.ipfsRootCid}\``,
        `- Data Set ID: \`${ctx.dataSetId}\``,
        `- Piece CID: \`${ctx.pieceCid}\``,
      ],
      (ctx) => [statusLine(ctx)],
      (ctx) => [
        '- Preview (temporary centralized gateway):',
        `  - ${ctx.ipfsRootCid ? `https://ipfs.io/ipfs/${ctx.ipfsRootCid}` : 'Preview unavailable'}`,
      ],
    ],
  },
  'fork-pr-blocked': {
    heading: 'Filecoin Pin Upload ⚠️',
    sections: [
      (ctx) => [`- IPFS Root CID: \`${ctx.ipfsRootCid}\``],
      () => [
        '- Reason: Fork PR support temporarily disabled',
        '- Workaround: Create a PR from a branch in the same repository',
        '- Fork PR support will be re-enabled in a future version.',
      ],
      (ctx) => [statusLine(ctx)],
    ],
  },
}

/**
 * Get comment template based on upload status
 * @param {keyof typeof commentTemplates} uploadStatus
 * @returns
 */
export function getCommentTemplate(uploadStatus) {
  // TODO: if uploadStatus is not a valid key, we should use an error template.
  return commentTemplates[uploadStatus] || commentTemplates.success
}

/**
 *
 * @param {PrCommentTemplate} template
 * @param {PrCommentContext} context
 * @returns {string}
 */
export const renderTemplate = (template, context) => {
  const lines = [COMMENT_HEADER, template.heading, '']
  template.sections.forEach((section, index) => {
    const sectionLines = section(context)
    if (!sectionLines?.length) {
      return
    }
    if (index > 0) {
      lines.push('')
    }
    lines.push(...sectionLines)
  })
  return lines.join('\n')
}

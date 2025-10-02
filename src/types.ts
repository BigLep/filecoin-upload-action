/**
 * TypeScript type definitions for the Filecoin Upload Action
 */

export interface CombinedContext {
  ipfs_root_cid?: string
  car_path?: string
  car_filename?: string
  artifact_name?: string
  build_run_id?: string
  event_name?: string
  pr?: {
    number?: number
    sha?: string
    title?: string
    author?: string
  }
  piece_cid?: string
  data_set_id?: string
  provider?: {
    id?: string
    name?: string
  }
  upload_status?: string
  metadata_path?: string
  run_id?: string
  repository?: string
  mode?: string
  phase?: string
  network?: string
  artifact_car_path?: string
  content_path?: string
  wallet_private_key?: string
  min_days?: number
  max_balance?: bigint
  max_top_up?: bigint
  with_cdn?: boolean
  provider_address?: string
  preview_url?: string
  payment_status?: {
    depositedAmount?: string
    currentBalance?: string
    storageRunway?: string
    depositedThisRun?: string
  }
}

export interface ParsedInputs {
  walletPrivateKey?: string
  contentPath: string
  minDays: number
  maxBalance?: bigint | undefined
  maxTopUp?: bigint
  withCDN: boolean
  token: string
  providerAddress: string
}

export interface PRMetadata {
  number: number
  sha: string
  title: string
  author: string
}

export interface UploadResult {
  pieceCid: string
  pieceId: string
  dataSetId: string
  provider: {
    id?: string
    name?: string
  }
  previewURL: string
  network: string
}

export interface BuildResult {
  contentPath: string
  carPath: string
  ipfsRootCid: string
}

export interface CommentPRParams {
  ipfsRootCid: string
  dataSetId: string
  pieceCid: string
  uploadStatus: string
  /**
   * The piece CID preview URL, directly from the provider
   */
  previewUrl?: string | undefined
  prNumber?: number
  githubToken: string
  githubRepository: string
  network?: string | undefined
}

export interface PaymentConfig {
  minDays: number
  maxBalance?: bigint | undefined
  maxTopUp?: bigint | undefined
}

export interface UploadConfig {
  withCDN: boolean
  providerAddress: string
}

export interface ArtifactUploadOptions {
  retentionDays?: number
  compressionLevel?: number
}

export interface ArtifactDownloadOptions {
  path: string
}

export interface PrCommentContext {
  uploadStatus: string
  ipfsRootCid: string
  dataSetId: string
  pieceCid: string
  previewUrl?: string | undefined
  network?: string | undefined
}

export interface PrCommentTemplate {
  heading: string
  sections: ((ctx: PrCommentContext) => string[])[]
}

export type PrCommentTemplateKeys = 'success' | 'fork-pr-blocked'

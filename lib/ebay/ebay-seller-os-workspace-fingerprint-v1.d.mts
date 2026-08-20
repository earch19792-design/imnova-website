export const SELLER_OS_WORKSPACE_FINGERPRINT_VERSION: "SELLER_OS_WORKSPACE_FINGERPRINT_V1"

export type SellerOsWorkspaceFingerprintV1 = Readonly<{
  status: "AVAILABLE" | "UNAVAILABLE"
  headSha: string | null
  workingTreeStatus: "CLEAN" | "DIRTY" | "UNAVAILABLE"
  fingerprint: string | null
  fingerprintVersion: typeof SELLER_OS_WORKSPACE_FINGERPRINT_VERSION
  limitations: readonly string[]
}>

export type SellerOsWorkspaceFingerprintAdapterV1 = Readonly<{
  readHead: () => Promise<Buffer>
  readStatus: () => Promise<Buffer>
  readUnstagedDiff: () => Promise<Buffer>
  readStagedDiff: () => Promise<Buffer>
  readUntrackedPaths: () => Promise<Buffer>
  readUntrackedEntry: (path: string) => Promise<Buffer>
}>

export function collectSellerOsWorkspaceFingerprintV1(options?: {
  adapter?: SellerOsWorkspaceFingerprintAdapterV1
}): Promise<SellerOsWorkspaceFingerprintV1>

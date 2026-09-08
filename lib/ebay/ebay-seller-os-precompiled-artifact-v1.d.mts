import type { SellerOsWorkspaceFingerprintV1 } from "./ebay-seller-os-workspace-fingerprint-v1.mjs"
export const PRECOMPILED_ARTIFACT_VERSION: "SELLER_OS_PRECOMPILED_ARTIFACT_V1"
export const VALIDATION_RECEIPT: string
export type PrecompiledRuntimeBindingV1 = Readonly<{
  status: string; runtimeBuildShaMatch: boolean; sourceCommitSha: string | null;
  worktreeFingerprint: string | null; buildId: string | null;
  buildArtifactDigest: string | null; operationalServiceBound: boolean;
}>
export function capturePrecompiledSourceSubjectV1(directory: string): Promise<SellerOsWorkspaceFingerprintV1>
export function digestPrecompiledPayloadV1(directory: string): Promise<{ digest: string; fileCount: number; byteCount: number }>
export function assessPrecompiledReceiptV1(receipt: unknown, subject: unknown, payload: unknown, buildId: string): boolean
export function inspectPrecompiledRuntimeArtifactV1(): Promise<PrecompiledRuntimeBindingV1>

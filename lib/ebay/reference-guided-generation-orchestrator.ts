import { createHash } from "node:crypto"
import sharp from "sharp"
// @ts-expect-error Node test runner resolves the TypeScript source directly.
import { requestReferenceGuidedProductGeneration, type EbayReferenceGuidedGenerationPlan, type EbayReferenceGuidedProviderResult } from "./ebay-listing-image-factory.ts"

export type ReferenceGuidedJobRecord = {
  id: string
  position: number
  status: string
  sourceMainHash: string
  sourceSideHash: string
  promptHash: string
  exactPromptText: string
}

export type ReferenceGuidedPersistence = {
  claim(limit: 2, manifestHash: string, leaseOwner: string): Promise<ReferenceGuidedJobRecord[]>
  reserveProviderCall(input: {
    attemptId: string
    jobId: string
    manifestHash: string
    leaseOwner: string
    exactPromptHash: string
    maximumProviderCalls: 6
  }): Promise<number>
  saveGenerated(jobId: string, result: EbayReferenceGuidedProviderResult, manifestHash: string): Promise<void>
  markOutcomeUnknown(jobId: string, errorCode: string): Promise<void>
  markRetryable(jobId: string, errorCode: string): Promise<void>
}

export function sha256Bytes(value: Buffer) {
  return createHash("sha256").update(value).digest("hex")
}

/** Resumable worker: persistence owns leases and CAS; this function never holds SQL open. */
export async function runReferenceGuidedGenerationWorker(input: {
  attemptId: string
  manifestHash: string
  leaseOwner: string
  plan: EbayReferenceGuidedGenerationPlan
  main: Buffer
  side: Buffer
  apiKey: string
  persistence: ReferenceGuidedPersistence
  fetchImpl?: typeof fetch
  featureEnabled: boolean
  shouldContinue?: () => boolean
}) {
  if (!input.featureEnabled) throw new Error("REFERENCE_GUIDED_GENERATION_DISABLED")
  if (sha256Bytes(input.main) !== input.plan.jobs[0].sourceHashes[0] ||
    sha256Bytes(input.side) !== input.plan.jobs[0].sourceHashes[1]) {
    throw new Error("MANIFEST_SOURCE_MISMATCH")
  }
  const jobs = await input.persistence.claim(2, input.manifestHash, input.leaseOwner)
  let providerCalls = 0
  for (const job of jobs) {
    if (!input.shouldContinue?.()) throw new Error("REFERENCE_GUIDED_MANIFEST_CHANGED")
    const planned = input.plan.jobs[job.position - 1]
    if (!planned || planned.promptHash !== job.promptHash ||
      planned.prompt !== job.exactPromptText ||
      createHash("sha256").update(Buffer.from(job.exactPromptText, "utf8"))
        .digest("hex") !== job.promptHash ||
      planned.sourceHashes[0] !== job.sourceMainHash || planned.sourceHashes[1] !== job.sourceSideHash) {
      throw new Error("MANIFEST_SOURCE_MISMATCH")
    }
    providerCalls = await input.persistence.reserveProviderCall({
      attemptId: input.attemptId,
      jobId: job.id,
      manifestHash: input.manifestHash,
      leaseOwner: input.leaseOwner,
      exactPromptHash: job.promptHash,
      maximumProviderCalls: 6,
    })
    if (providerCalls < 1 || providerCalls > 6) {
      throw new Error("REFERENCE_GUIDED_PROVIDER_CALL_BUDGET_EXHAUSTED")
    }
    try {
      const result = await requestReferenceGuidedProductGeneration({
        plan: { ...input.plan, jobs: [planned] }, main: input.main, side: input.side,
        apiKey: input.apiKey, fetchImpl: input.fetchImpl,
        shouldContinue: input.shouldContinue,
      })
      const output = result[0]
      const metadata = await sharp(output.output).metadata()
      if (metadata.format !== "png" || metadata.width !== 1600 || metadata.height !== 1600) {
        output.output.fill(0)
        throw new Error("REFERENCE_GUIDED_PROVIDER_OUTPUT_DIMENSIONS_INVALID")
      }
      await input.persistence.saveGenerated(job.id, output, input.manifestHash)
      output.output.fill(0)
    } catch (error) {
      const code = error instanceof Error ? error.message : "REFERENCE_GUIDED_PROVIDER_ERROR"
      if (code.includes("HTTP_429")) await input.persistence.markRetryable(job.id, code)
      else if (code.includes("PROVIDER_HTTP") || code.includes("OUTPUT_INVALID")) await input.persistence.markRetryable(job.id, code)
      else await input.persistence.markOutcomeUnknown(job.id, code)
    }
  }
  return { attemptId: input.attemptId, claimedJobs: jobs.length, providerCalls, ebayWrites: 0, productionChanged: false }
}

import assert from "node:assert/strict"
import test from "node:test"

import {
  isInitialReferenceGuidedPrepare,
  persistedReferenceGuidedManifestMatches,
} from "./reference-guided-prepare-idempotency.ts"

const manifestJobs = Array.from({ length: 6 }, (_, index) => ({
  position: index + 1,
  commercialObjective: `OBJECTIVE_${index + 1}`,
  exactPromptText: `exact prompt ${index + 1}`,
  promptHash: `hash-${index + 1}`,
}))

const jobs = (positionOneStatus = "PENDING") => manifestJobs.map((job, index) => ({
  position: job.position,
  commercial_role: job.commercialObjective,
  status: index === 0 ? positionOneStatus : "PENDING",
  lease_owner: null,
  lease_expires_at: null,
  exact_prompt_text: job.exactPromptText,
  prompt_hash: job.promptHash,
}))

test("the same manifest stays idempotent after QA, pass or failure progress", () => {
  for (const status of ["QA_PENDING", "PASSED", "PROVIDER_RETRYABLE_ERROR", "BLOCKED_FIDELITY"]) {
    assert.equal(persistedReferenceGuidedManifestMatches({
      jobs: jobs(status), manifestJobs,
      verifyPrompt: (prompt, hash) => manifestJobs.some((job) =>
        job.exactPromptText === prompt && job.promptHash === hash),
    }), true)
  }
})

test("only a genuinely new preparation requires six untouched pending jobs", () => {
  assert.equal(isInitialReferenceGuidedPrepare({ jobs: jobs(), providerCalls: 0 }), true)
  assert.equal(isInitialReferenceGuidedPrepare({ jobs: jobs("QA_PENDING"), providerCalls: 2 }), false)
})

test("a manifest conflict remains fail-closed", () => {
  const conflicting = jobs("QA_PENDING")
  conflicting[0].prompt_hash = "different"
  assert.equal(persistedReferenceGuidedManifestMatches({
    jobs: conflicting, manifestJobs, verifyPrompt: () => false,
  }), false)
})

type PersistedJob = {
  position: number
  commercial_role: string
  status: string
  lease_owner: string | null
  lease_expires_at: string | null
  exact_prompt_text: string
  prompt_hash: string
}

type ManifestJob = {
  position: number
  commercialObjective: string
  exactPromptText: string
  promptHash: string
}

/** Manifest identity is immutable; execution state is intentionally not. */
export function persistedReferenceGuidedManifestMatches(input: {
  jobs: PersistedJob[]
  manifestJobs: ManifestJob[]
  verifyPrompt: (prompt: string, hash: string) => boolean
}) {
  return input.jobs.length === 6
    && input.manifestJobs.length === 6
    && new Set(input.jobs.map((job) => job.position)).size === 6
    && input.jobs.every((job, index) => {
      const planned = input.manifestJobs[index]
      return job.position === index + 1
        && job.position === planned?.position
        && job.commercial_role === planned.commercialObjective
        && job.exact_prompt_text === planned.exactPromptText
        && job.prompt_hash === planned.promptHash
        && input.verifyPrompt(job.exact_prompt_text, job.prompt_hash)
    })
}

export function isInitialReferenceGuidedPrepare(input: {
  jobs: PersistedJob[]
  providerCalls: number
}) {
  return input.providerCalls === 0
    && input.jobs.length === 6
    && input.jobs.every((job) => job.status === "PENDING"
      && job.lease_owner == null && job.lease_expires_at == null)
}

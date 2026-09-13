import "server-only"

import { certifyCurrentPrepublicationV1 } from
  "./ebay-current-prepublication-server-v1"
import { publishCurrentRevisionV1 } from
  "./ebay-current-publication-executor-server-v1"
import type { CurrentPublicationExecutorInputV1 } from
  "./ebay-current-publication-executor-v1"
import { executeCommercialDecisionLoopV1_1,
  type CommercialPublicationReadinessInputV1_1 } from
  "./seller-os-commercial-decision-loop-v1-1"

/**
 * Server adapter for AUTO_PUBLISH=true. It deliberately accepts only a fully
 * bound publication already prepared by Seller OS. The current publisher owns
 * preflight, its one-write idempotency key and official ACTIVE readback.
 */
export async function executeCommercialDecisionLoopWithCurrentPublisherV1_1(
  input: CommercialPublicationReadinessInputV1_1 & Readonly<{
    publication: CurrentPublicationExecutorInputV1
    publicationWritesEnabled: boolean
  }>,
) {
  let publicationResult: Record<string, unknown> | null = null
  return executeCommercialDecisionLoopV1_1({ ...input,
    preflight: async () => {
      const result = await certifyCurrentPrepublicationV1({
        supabase: input.publication.supabase,
        actor: input.publication.actor,
        accountKey: input.publication.accountKey,
        packageId: input.publication.packageId,
      })
      return { passed: result.pass === true,
        reason: result.pass === true ? undefined : "CURRENT_PREPUBLICATION_FAILED" }
    },
    publish: async () => {
      const rawResult = await publishCurrentRevisionV1(input.publication)
      const result = rawResult as Record<string, unknown>
      publicationResult = result
      const itemId = typeof result.listingId === "string"
        ? result.listingId : ""
      if (result.pass !== true || !itemId) throw new Error(
        typeof result.blocker === "string" ? result.blocker
          : "CURRENT_PUBLICATION_FAILED")
      return { itemId }
    },
    readback: async (itemId) => ({ verified:
      publicationResult?.OFFICIAL_READBACK_PASS === true &&
      publicationResult?.PUBLISHED_CONFIRMED === true &&
      publicationResult?.listingId === itemId }),
  })
}

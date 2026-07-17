import { send } from "@vercel/queue"
import type { SupabaseClient } from "@supabase/supabase-js"

import {
  publishTop20ContinuationQueue,
  Top20DispatchFailure,
} from "./ebay-listing-ai-top20-dispatch"
import {
  getListingAiApprovalQueueDispatchContext,
  markListingAiApprovalQueueDispatchRecoverable,
  persistListingAiApprovalQueueDispatchAttempt,
} from "./ebay-listing-ai-approval-queue-service"

export async function enqueueListingAiTop20Continuation(input: {
  supabase: SupabaseClient
  runId: string
  continuationGeneration: number
  expectedBatch: number
  environment?: NodeJS.ProcessEnv
}) {
  const environment = input.environment ?? process.env
  if (environment.VERCEL_ENV !== "preview") {
    throw new Error("LISTING_AI_PREVIEW_STAGING_REQUIRED")
  }
  const context = await getListingAiApprovalQueueDispatchContext({
    supabase: input.supabase,
    runId: input.runId,
    continuationGeneration: input.continuationGeneration,
  })
  try {
    const diagnostic = await publishTop20ContinuationQueue({
      send,
      runId: input.runId,
      continuationGeneration: input.continuationGeneration,
      expectedBatch: input.expectedBatch,
      attemptOffset: context.attemptOffset,
      deploymentHost: environment.VERCEL_URL,
      onAttempt: async (attempt) => persistListingAiApprovalQueueDispatchAttempt({
        supabase: input.supabase,
        runId: input.runId,
        continuationGeneration: input.continuationGeneration,
        diagnostic: attempt,
      }),
    })
    return { status: "QUEUED" as const, diagnostic }
  } catch (error) {
    const diagnostic = error instanceof Top20DispatchFailure ? error.diagnostic : null
    await markListingAiApprovalQueueDispatchRecoverable({
      supabase: input.supabase,
      runId: input.runId,
      continuationGeneration: input.continuationGeneration,
      diagnostic,
    })
    return {
      status: "PAUSED_DISPATCH_RECOVERABLE" as const,
      diagnostic,
    }
  }
}

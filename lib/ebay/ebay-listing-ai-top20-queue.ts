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
import { getSellerOsOperationalRuntimeBoundary } from
  "./environment-boundaries"

export async function enqueueListingAiTop20Continuation(input: {
  supabase: SupabaseClient
  runId: string
  continuationGeneration: number
  expectedBatch: number
  environment?: NodeJS.ProcessEnv
}) {
  const environment = input.environment ?? process.env
  const runtimeBoundary = getSellerOsOperationalRuntimeBoundary({
    vercelEnv: environment.VERCEL_ENV,
    vercelTargetEnv: environment.VERCEL_TARGET_ENV,
    vercelSystem: environment.VERCEL,
    vercelProjectId: environment.VERCEL_PROJECT_ID,
    vercelProjectProductionUrl: environment.VERCEL_PROJECT_PRODUCTION_URL,
    ebayProRuntime: environment.EBAY_PRO_RUNTIME,
    supabaseUrl: environment.NEXT_PUBLIC_SUPABASE_URL,
    sellerOsDeploymentMode: environment.SELLER_OS_DEPLOYMENT_MODE,
    sellerOsPublicOrigin: environment.SELLER_OS_PUBLIC_ORIGIN,
  })
  if (!runtimeBoundary.authorized) {
    throw new Error("LISTING_AI_PREVIEW_STAGING_REQUIRED")
  }
  const send = async (
    _topic: string,
    message: Record<string, unknown>,
    options: { retentionSeconds: number; idempotencyKey: string },
  ) => {
    const { data, error } = await input.supabase.rpc(
      "seller_os_top20_queue_send",
      {
        p_message: message,
        p_idempotency_key: options.idempotencyKey,
      },
    )
    if (error || data === null || data === undefined) {
      throw new Error("SUPABASE_QUEUE_SEND_FAILED")
    }
    return { messageId: String(data) }
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
      deploymentHost: environment.SELLER_OS_PUBLIC_ORIGIN,
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

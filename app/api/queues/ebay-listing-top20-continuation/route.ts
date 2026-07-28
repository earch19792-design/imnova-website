export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

import { handleCallback } from "@vercel/queue"

import {
  continueListingAiApprovalQueueScanFromQueue,
  markListingAiApprovalQueueDispatchRecoverable,
} from "@/lib/ebay/ebay-listing-ai-approval-queue-service"
import { enqueueListingAiTop20Continuation } from "@/lib/ebay/ebay-listing-ai-top20-queue"
import { getListingAiConfiguration } from "@/lib/ebay/ebay-openai-listing-factory-v2"
import {
  evaluateSingleProductLabRequest,
  SINGLE_PRODUCT_LAB_MODE,
  singleProductLabBlockedPayload,
} from "@/lib/ebay/single-product-lab"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"

type QueueMessage = {
  version?: unknown
  runId?: unknown
  continuationGeneration?: unknown
  expectedBatch?: unknown
}

function parsedMessage(value: unknown) {
  const message = value && typeof value === "object" && !Array.isArray(value)
    ? value as QueueMessage
    : {}
  const runId = typeof message.runId === "string" ? message.runId.trim() : ""
  const continuationGeneration = Number(message.continuationGeneration)
  const expectedBatch = Number(message.expectedBatch)
  if (message.version !== "TOP20_CONTINUATION_V2" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runId) ||
    !Number.isInteger(continuationGeneration) || continuationGeneration < 1 ||
    !Number.isInteger(expectedBatch) || expectedBatch < 1) {
    throw new Error("TOP20_CONTINUATION_MESSAGE_INVALID")
  }
  return { runId, continuationGeneration, expectedBatch }
}

const pilotBlock = evaluateSingleProductLabRequest({
  pathname: "/api/queues/ebay-listing-top20-continuation",
  method: "POST",
})

const queueCallback = handleCallback(async (value, metadata) => {
  if (pilotBlock) return
  const boundary = getListingAiConfiguration()
  if (!boundary.preview || !boundary.staging) {
    throw new Error("LISTING_AI_PREVIEW_STAGING_REQUIRED")
  }
  const message = parsedMessage(value)
  const supabase = getSupabaseAdminClient()
  try {
    const result = await continueListingAiApprovalQueueScanFromQueue({
      supabase,
      ...message,
    })
    if (result.shouldContinue) await enqueueListingAiTop20Continuation({
      supabase,
      runId: message.runId,
      continuationGeneration: message.continuationGeneration,
      expectedBatch: Number(result.currentBatch ?? message.expectedBatch) + 1,
    })
  } catch (error) {
    const code = error instanceof Error ? error.message : "TOP20_CONTINUATION_FAILED"
    if (["TOP20_CONTINUATION_TOKEN_REJECTED", "TOP20_CONTINUATION_RUN_NOT_FOUND"].includes(code)) {
      return
    }
    if (metadata.deliveryCount >= 3) {
      await markListingAiApprovalQueueDispatchRecoverable({
        supabase,
        runId: message.runId,
        continuationGeneration: message.continuationGeneration,
      })
      return
    }
    throw error
  }
}, {
  visibilityTimeoutSeconds: 300,
  retry: (_error, metadata) => ({
    afterSeconds: Math.min(60, 5 * (2 ** Math.max(0, metadata.deliveryCount - 1))),
  }),
})

// Keep the public Next.js route contract narrow even though the queue SDK also
// accepts its framework-neutral `{ request }` callback wrapper.
export function POST(request: Request) {
  if (pilotBlock) {
    return Response.json(singleProductLabBlockedPayload(pilotBlock), {
      status: pilotBlock.status,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "X-Seller-OS-Mode": SINGLE_PRODUCT_LAB_MODE,
      },
    })
  }
  return queueCallback(request)
}

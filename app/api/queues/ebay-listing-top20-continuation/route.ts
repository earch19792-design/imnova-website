export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

import { timingSafeEqual } from "node:crypto"

import {
  continueListingAiApprovalQueueScanFromQueue,
  markListingAiApprovalQueueDispatchRecoverable,
} from "@/lib/ebay/ebay-listing-ai-approval-queue-service"
import { enqueueListingAiTop20Continuation } from
  "@/lib/ebay/ebay-listing-ai-top20-queue"
import { getListingAiConfiguration } from
  "@/lib/ebay/ebay-openai-listing-factory-v2"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"

type QueueMessage = {
  version?: unknown
  runId?: unknown
  continuationGeneration?: unknown
  expectedBatch?: unknown
  deliveryCount?: unknown
}

type QueueClaim = {
  msg_id?: unknown
  read_ct?: unknown
  message?: unknown
}

function authorized(request: Request) {
  const configured = process.env.CRON_SECRET?.trim() ?? ""
  const supplied = request.headers.get("authorization")?.trim() ?? ""
  const expected = configured ? `Bearer ${configured}` : ""
  if (!expected || supplied.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
}

function parsedMessage(value: unknown) {
  const message = value && typeof value === "object" && !Array.isArray(value)
    ? value as QueueMessage
    : {}
  const runId = typeof message.runId === "string" ? message.runId.trim() : ""
  const continuationGeneration = Number(message.continuationGeneration)
  const expectedBatch = Number(message.expectedBatch)
  const deliveryCount = Math.max(1, Number(message.deliveryCount) || 1)
  if (message.version !== "TOP20_CONTINUATION_V2" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runId) ||
    !Number.isInteger(continuationGeneration) || continuationGeneration < 1 ||
    !Number.isInteger(expectedBatch) || expectedBatch < 1) {
    throw new Error("TOP20_CONTINUATION_MESSAGE_INVALID")
  }
  return { runId, continuationGeneration, expectedBatch, deliveryCount }
}

function queueClaim(value: unknown) {
  const claim = value && typeof value === "object" && !Array.isArray(value)
    ? value as QueueClaim
    : {}
  const messageId = Number(claim.msg_id)
  if (!Number.isSafeInteger(messageId) || messageId < 1) {
    throw new Error("TOP20_QUEUE_CLAIM_INVALID")
  }
  return {
    messageId,
    readCount: Math.max(1, Number(claim.read_ct) || 1),
    rawMessage: claim.message,
  }
}

async function queueRpc(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  name: string,
  parameters: Record<string, unknown> = {},
) {
  const { data, error } = await supabase.rpc(name, parameters)
  if (error) throw new Error("SUPABASE_QUEUE_OPERATION_FAILED")
  return data
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: "queue_worker_unauthorized" }, { status: 401 })
  }
  const boundary = getListingAiConfiguration()
  if (!boundary.preview || !boundary.staging) {
    return Response.json({ error: "queue_worker_environment_blocked" },
      { status: 403 })
  }

  const supabase = getSupabaseAdminClient()
  const claimed = await queueRpc(supabase, "seller_os_top20_queue_claim")
  if (!claimed) return new Response(null, { status: 204 })

  let claim: ReturnType<typeof queueClaim>
  let message: ReturnType<typeof parsedMessage>
  try {
    claim = queueClaim(claimed)
    message = parsedMessage(claim.rawMessage)
  } catch {
    const unsafeId = Number((claimed as QueueClaim)?.msg_id)
    if (Number.isSafeInteger(unsafeId) && unsafeId > 0) {
      await queueRpc(supabase, "seller_os_top20_queue_archive", {
        p_message_id: unsafeId,
      })
    }
    return Response.json({ error: "queue_message_invalid" }, { status: 422 })
  }

  try {
    const result = await continueListingAiApprovalQueueScanFromQueue({
      supabase,
      runId: message.runId,
      continuationGeneration: message.continuationGeneration,
      expectedBatch: message.expectedBatch,
    })
    if (result.shouldContinue) {
      await enqueueListingAiTop20Continuation({
        supabase,
        runId: message.runId,
        continuationGeneration: message.continuationGeneration,
        expectedBatch: Number(result.currentBatch ?? message.expectedBatch) + 1,
      })
    }
    await queueRpc(supabase, "seller_os_top20_queue_delete", {
      p_message_id: claim.messageId,
    })
    return Response.json({ status: "processed" })
  } catch (error) {
    const code = error instanceof Error
      ? error.message
      : "TOP20_CONTINUATION_FAILED"
    if ([
      "TOP20_CONTINUATION_TOKEN_REJECTED",
      "TOP20_CONTINUATION_RUN_NOT_FOUND",
    ].includes(code)) {
      await queueRpc(supabase, "seller_os_top20_queue_archive", {
        p_message_id: claim.messageId,
      })
      return Response.json({ status: "archived" })
    }
    const deliveryCount = Math.max(message.deliveryCount, claim.readCount)
    if (deliveryCount >= 3) {
      await markListingAiApprovalQueueDispatchRecoverable({
        supabase,
        runId: message.runId,
        continuationGeneration: message.continuationGeneration,
      })
      await queueRpc(supabase, "seller_os_top20_queue_archive", {
        p_message_id: claim.messageId,
      })
      return Response.json({ status: "paused_recoverable" })
    }
    const nextMessage = {
      ...(claim.rawMessage as Record<string, unknown>),
      deliveryCount: deliveryCount + 1,
    }
    await queueRpc(supabase, "seller_os_top20_queue_retry", {
      p_message_id: claim.messageId,
      p_message: nextMessage,
      p_delay_seconds: Math.min(60, 5 * (2 ** (deliveryCount - 1))),
    })
    return Response.json({ status: "retry_scheduled" }, { status: 503 })
  }
}

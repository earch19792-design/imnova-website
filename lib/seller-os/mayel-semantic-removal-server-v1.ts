import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"

/** Same authenticated assigned-reviewer boundary as visual QA. Recording a
 * semantic assessment neither queues a mutation nor reads/writes eBay. */
export async function recordMayelRemovalReviewV1(input: { supabase: SupabaseClient; accountKey: string;
  actorUserId: string; taskId: string; review: unknown }) {
  if (!input.review || typeof input.review !== "object" || Array.isArray(input.review) ||
    Buffer.byteLength(JSON.stringify(input.review)) > 64000) throw Error("REMOVAL_REVIEW_BOUND_EXCEEDED")
  const result = await input.supabase.rpc("seller_os_record_removal_review_v1", {
    p_account: input.accountKey, p_actor: input.actorUserId, p_task: input.taskId, p_review: input.review,
  })
  if (result.error || typeof result.data !== "string") throw Error("REMOVAL_SEMANTIC_REVIEW_NOT_RECORDED")
  return { reviewId: result.data, authority: "MAYEL_SEMANTIC_REMOVAL_REVIEW_V1",
    ownerApprovalRequired: false, marketplaceWrites: 0, outboxCreated: false }
}

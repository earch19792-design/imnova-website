import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { enqueueDelegatedVisualV1, readOptimizationGrantV1 } from "./mayel-optimization-delegation-server-v1"
import { optimizationGrantActiveV1 } from "./mayel-optimization-delegation-v1"
import { IPAD_OUTBOX_TABLE } from "./ipad-durable-outbox-v1"

/** Service entry point into the normal, lease-protected runtime. The request
 * selects work; only the previously persisted OWNER grant authorizes it. */
export async function runDelegatedVisualScopedV1(input: {
  supabase: SupabaseClient; accountKey: string; taskId: string;
  expectedItemId: string; expectedManifestDigest: string;
}) {
  if (!/^[a-f0-9-]{36}$/i.test(input.taskId) || !/^\d{9,20}$/.test(input.expectedItemId) ||
      !/^sha256:[a-f0-9]{64}$/.test(input.expectedManifestDigest)) throw Error("DELEGATED_VISUAL_EXACT_SCOPE_REQUIRED")
  const task = await input.supabase.from("ebay_mayel_visual_tasks_v1")
    .select("id,ebay_item_id,visual_manifest_digest").eq("id", input.taskId)
    .eq("marketplace_account_key", input.accountKey).maybeSingle()
  if (task.error || !task.data || task.data.ebay_item_id !== input.expectedItemId ||
      task.data.visual_manifest_digest !== input.expectedManifestDigest) throw Error("DELEGATED_VISUAL_SCOPE_CHANGED")
  const grant = await readOptimizationGrantV1(input.supabase, input.accountKey)
  if (!optimizationGrantActiveV1(grant, input.accountKey)) throw Error("OWNER_DELEGATION_REQUIRED")
  const queued = await enqueueDelegatedVisualV1(input)
  if (!queued.receipt) return { ...queued, imageWriteCount: 0, officialReadback: false }
  const { runIpadOutboxRuntimeV1 } = await import("./ipad-sync-runtime-v1")
  const runtime = await runIpadOutboxRuntimeV1({ ...input,
    outboxId: queued.receipt.id, itemId: input.expectedItemId })
  const stored = await input.supabase.from(IPAD_OUTBOX_TABLE)
    .select("id,state,reason_code,dispatch_count,official_readback,execution_receipt,next_attempt_at")
    .eq("id", queued.receipt.id).eq("account_key", input.accountKey).eq("item_id", input.expectedItemId).maybeSingle()
  if (stored.error || !stored.data) throw Error("DELEGATED_VISUAL_RECEIPT_READ_REQUIRED")
  return { status: stored.data.state, reason: stored.data.reason_code,
    receipt: stored.data, imageWriteCount: runtime.listingWriteCount,
    officialReadback: stored.data.state === "SYNCED" && stored.data.official_readback === true,
    runtime, publicationWriteCount: 0, adsWriteCount: 0 }
}

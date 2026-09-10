import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { discardProposalManifestV1, excludeDiscardedProposalsV1 } from "./mayel-proposal-discard-v1"
import type { MayelVisualOutputRole } from "../ebay/ebay-mayel-visual-workstation-v1"

export async function discardMayelProposalsV1(input: { supabase: SupabaseClient; accountKey: string; actorUserId: string;
  taskId: string; itemId: string; expectedManifestDigest: string; assetIds: string[] }) {
  const t = await input.supabase.from("ebay_mayel_visual_tasks_v1")
    .select("id,ebay_item_id,visual_manifest,visual_manifest_digest,selection_signal")
    .eq("id", input.taskId).eq("marketplace_account_key", input.accountKey).eq("ebay_item_id", input.itemId).maybeSingle()
  if (t.error || !t.data) throw Error("EXACT_VISUAL_TASK_REQUIRED")
  // SQL handles idempotent replay before CAS, under locks and actor validation.
  const a = await excludeDiscardedProposalsV1(input.supabase.from("ebay_listing_image_assets")
    .select("id,mayel_output_role,output_sha256,public_url")
    .eq("account_key", input.accountKey).eq("mayel_visual_task_id", input.taskId).eq("status", "approved").limit(7), t.data.selection_signal)
  if (a.error || (a.data?.length ?? 0) > 6) throw Error("CANONICAL_ASSET_READ_FAILED")
  const manifest = t.data.visual_manifest_digest === input.expectedManifestDigest ? discardProposalManifestV1({ ...input,
    manifest: t.data.visual_manifest as Record<string, unknown>, assets: (a.data ?? []).map(a => ({ assetId: a.id,
      role: a.mayel_output_role as MayelVisualOutputRole, outputSha256: a.output_sha256, publicUrl: a.public_url })) }) : null
  const r = await input.supabase.rpc("seller_os_discard_mayel_proposals_v1", { p_account: input.accountKey, p_actor: input.actorUserId,
    p_task: input.taskId, p_item: input.itemId, p_expected_digest: input.expectedManifestDigest, p_asset_ids: input.assetIds, p_manifest: manifest })
  if (r.error || !r.data) throw Error(r.error?.message?.match(/PROPOSAL_[A-Z_]+/)?.[0] ?? "PROPOSAL_DISCARD_FAILED")
  return { ...r.data, marketplaceWrites: 0, ebayTraffic: 0 }
}

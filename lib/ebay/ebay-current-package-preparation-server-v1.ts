import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { readSellOneLikeThisV1 } from "../seller-os/sell-one-like-this-runtime-v1"
import { keywordRecord as record } from "../seller-os/keyword-intelligence-handoff-v1"

// Server-side read of the existing revision. Request bodies never supply this
// authority. No package/history mutation, publication grant, or marketplace IO.
export async function readCurrentDraftPreparationV1(input: {
  supabase: SupabaseClient; accountKey: string; actor: string; listingPackage: Record<string, unknown>;
}) {
  const p = input.listingPackage
  const read = await input.supabase.from("ebay_authorized_listing_publications")
    .select("id,actor_user_id,listing_package_id,phase,publish_attempt_count,publication_idempotency_key,claim_token,listing_id,preparation:sanitized_result->publicationPreparationV1")
    .eq("listing_package_id", String(p.id)).eq("marketplace_account_key", input.accountKey)
    .eq("actor_user_id", input.actor).limit(2).abortSignal(AbortSignal.timeout(8000)).retry(false)
  if (read.error || (read.data?.length ?? 0) > 1) throw Error("CURRENT_REVISION_PUBLICATION_AMBIGUOUS")
  const pub = record(read.data?.[0]), r = record(record(pub.preparation).current)
  if (!Object.keys(r).length) return null
  if (p.created_by !== input.actor || pub.phase !== "preview_ready" || pub.publish_attempt_count !== 0 ||
    pub.publication_idempotency_key || pub.claim_token || pub.listing_id) throw Error("CURRENT_REVISION_PREPARATION_NOT_SAFE")
  const current = await readSellOneLikeThisV1({supabase:input.supabase,accountKey:input.accountKey,
    packageId:String(p.id),referenceItemId:String(record(r.certifiedPackage).referenceItemId)})
  const consistency = record(current.consistency), inventory = record(record(consistency.evidence).inventory)
  if (!current.previewRevision.valid || current.publicationGate.PACKAGE_CERTIFIED !== true ||
    consistency.PACKAGE_CONSISTENT !== true || inventory.inventoryReady !== true ||
    inventory.listingQuantity !== 1 || current.brandAuthority.supported !== true) throw Error("CURRENT_REVISION_AUTHORITY_NOT_READY")
  const imageRead = await input.supabase.rpc("assess_publication_revision_images_v1",{
    p_publication_id:pub.id,p_actor:input.actor,p_account_key:input.accountKey,
  }).abortSignal(AbortSignal.timeout(8000)).retry(false)
  const imageAuthority=record(imageRead.data), revision=record(current.previewRevision.revision)
  if (imageRead.error || imageAuthority.pass !== true || imageAuthority.packageHash !== revision.packageHash ||
    imageAuthority.generation !== revision.packageGeneration) throw Error("CURRENT_REVISION_IMAGE_AUTHORITY_UNPROVEN")
  return { revision, inventory, imageAuthority,
    packageConsistent:true, brandSupported:true, operation:"PREPARE_UNPUBLISHED_ONLY", publicationAuthorized:false }
}


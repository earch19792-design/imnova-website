import "server-only"
import { readEbayPackageFeeContextReadonlyV1 } from
  "./ebay-package-fee-context-readonly-v1"
import { persistProducedEbayFeeV1 } from
  "../seller-os/ebay-fee-runtime-v1"
import { keywordRecord as record } from
  "../seller-os/keyword-intelligence-handoff-v1"
import { certifyCurrentPrepublicationV1 } from
  "./ebay-current-prepublication-server-v1"
import { readSellOneLikeThisV1 } from
  "../seller-os/sell-one-like-this-runtime-v1"
import { publishEbayOfferOnce, verifyEbayPublishedOffer,
  verifyEbayDraftInventoryItem, verifySingleCurrentOfferV1 } from
  "./ebay-draft-only-gateway"
import { registerManualEbayListing } from "./ebay-manual-listing-service"
import { publishCurrentRevisionV1 as executeCurrentPublicationV1,
  type CurrentPublicationExecutorInputV1 } from
  "./ebay-current-publication-executor-v1"

async function refreshExpiredCurrentFeeEvidenceV1(
  input: CurrentPublicationExecutorInputV1,
  revision: Record<string, unknown>,
) {
  const head = await input.supabase.from("seller_os_ebay_fee_bindings_v1")
    .select("authority_id")
    .eq("binding_key", `${input.accountKey}:package:${input.packageId}`)
    .abortSignal(AbortSignal.timeout(8_000)).retry(false).single()
  if (head.error) throw new Error("CURRENT_FEE_HEAD_UNAVAILABLE")
  const authority = await input.supabase.from(
    "seller_os_ebay_fee_authorities_v1").select("authority")
    .eq("marketplace_account_key", input.accountKey)
    .eq("authority_id", head.data.authority_id)
    .abortSignal(AbortSignal.timeout(8_000)).retry(false).single()
  if (authority.error) throw new Error("CURRENT_FEE_AUTHORITY_UNAVAILABLE")
  if (Date.parse(String(record(authority.data.authority).freshUntil)) >
      Date.now()) return
  const context = await readEbayPackageFeeContextReadonlyV1(input.packageId)
  await persistProducedEbayFeeV1({ supabase: input.supabase,
    accountKey: input.accountKey, packageId: input.packageId, itemId: null,
    sku: String(revision.sku), context, now: new Date() })
}

const dependencies = {
  refreshFees: refreshExpiredCurrentFeeEvidenceV1,
  certify: certifyCurrentPrepublicationV1,
  readCurrent: readSellOneLikeThisV1,
  publish: publishEbayOfferOnce,
  inventory: verifyEbayDraftInventoryItem,
  offer: verifyEbayPublishedOffer,
  collection: verifySingleCurrentOfferV1,
  register: registerManualEbayListing,
}

export function publishCurrentRevisionV1(
  input: CurrentPublicationExecutorInputV1,
) {
  return executeCurrentPublicationV1(input, dependencies)
}

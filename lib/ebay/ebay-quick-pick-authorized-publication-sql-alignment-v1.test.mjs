import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const migration = readFileSync(new URL(
  "../../supabase/migrations/20260901233059_align_quick_pick_authorized_publication_v1.sql",
  import.meta.url,
), "utf8")
const monitorMigration = readFileSync(new URL(
  "../../supabase/migrations/20260901234500_align_quick_pick_monitor_registration_v1.sql",
  import.meta.url,
), "utf8")
const route = readFileSync(new URL(
  "../../app/api/admin/ebay/draft-only/route.ts",
  import.meta.url,
), "utf8")

test("canonical Quick Pick authority stays fail-closed and package-bound", () => {
  for (const contract of [
    "SELLER_OS_QUICK_PICK_CANONICAL_PUBLICATION_AUTHORIZATION_V1",
    "QUICK_PICK_REMOTE_OWNER_REVIEW_V1",
    "QUICK_PICK_DURABLE_GOLDEN_PATH_REVALIDATION_V1",
    "IN_STOCK_SUPPLIER_STATED",
    "LUNA_SUPPLIER_IMAGE_AUTO_READY_V1",
    "OPERATOR_BOUND_LUNA_SUPPLIER_IMAGE_RIGHTS_V1",
  ]) assert.match(migration, new RegExp(contract))

  for (const exactBinding of [
    "listingPackageId",
    "opportunityId",
    "candidateKey",
    "packageDigest",
    "productTruthDigest",
    "lunaProductId",
    "lunaVariantId",
    "supplierSku",
    "authorizationDigest",
  ]) assert.match(migration, new RegExp(exactBinding))

  assert.match(migration, /finalHumanAuthorizationRequired'[\s\S]*'true'/)
  assert.match(migration, /unattendedPublicationAllowed'[\s\S]*'false'/)
  assert.match(migration, /marketplaceWriteAuthorized'[\s\S]*'false'/)
  assert.match(migration, /marketplaceWrites'[\s\S]*'0'/)
  assert.doesNotMatch(migration, /FL-CUP-PHONE-MOUNT|252350807011/)
})

test("existing publication ledger routes Quick Pick around only stale legacy gates", () => {
  assert.match(migration, /v_quick_pick boolean := false/)
  assert.match(migration,
    /supplier_inventory_quantity is null[\s\S]*is_ebay_quick_pick_authorized_publication_v1/)
  assert.match(migration,
    /not found and not v_smart_stocking and not v_quick_pick/)
  assert.match(migration,
    /elsif v_quick_pick then[\s\S]*assert_ebay_quick_pick_canonical_images_v1/)
  assert.match(migration,
    /if not v_smart_stocking and not v_quick_pick and \(/)
  assert.match(migration,
    /assert_ebay_authorized_publication_image_set_high_quality[\s\S]*assert_ebay_quick_pick_canonical_images_v1/)
  assert.doesNotMatch(migration, /create table|create scheduler|create state machine/i)
})

test("final preview verifies official exact readback and a single SKU offer", () => {
  const verifierStart = route.indexOf(
    "async function readExactUnpublishedPublicationState",
  )
  const verifierEnd = route.indexOf(
    "function buildFinalPublicationPreview",
    verifierStart,
  )
  const verifier = route.slice(verifierStart, verifierEnd)
  assert.match(verifier, /verifyEbayDraftInventoryItem/)
  assert.match(verifier, /verifyEbayUnpublishedOffer/)
  assert.match(verifier, /preflightEbayDraftSkuCollision/)
  assert.match(verifier,
    /skuState\.inventoryExists && skuState\.offerCount === 1/)
  assert.match(verifier, /duplicateInventoryItemCount: 0/)
  assert.match(verifier, /duplicateOfferCount: skuState\.offerCount - 1/)

  const prepareStart = route.indexOf("async function prepareFinalPublication")
  const prepareEnd = route.indexOf(
    "async function compensateFinalPublicationAttachmentFailure",
    prepareStart,
  )
  const prepare = route.slice(prepareStart, prepareEnd)
  assert.match(prepare, /officialReadbackMatch: true/)
  assert.match(prepare, /offerCountForCanonicalPackage/)
  assert.doesNotMatch(prepare, /publishEbayOfferOnce|createEbayUnpublishedOffer|createOrReplaceEbayDraftInventoryItem/)
})

test("Quick Pick monitor closure reuses active evidence without a legacy pilot candidate", () => {
  assert.match(monitorMigration,
    /complete_ebay_authorized_listing_monitor_registration/)
  assert.match(monitorMigration,
    /EBAY_AUTHORIZED_PUBLICATION_ACTIVE_EVIDENCE_REQUIRED/)
  assert.match(monitorMigration,
    /is_ebay_smart_stocking_authorized_publication_v1/)
  assert.match(monitorMigration,
    /is_ebay_quick_pick_authorized_publication_v1/)
  assert.match(monitorMigration,
    /EBAY_AUTHORIZED_PUBLICATION_PILOT_CANDIDATE_REQUIRED/)
  assert.doesNotMatch(monitorMigration,
    /FL-CUP-PHONE-MOUNT|252350807011|create table|create scheduler|create state machine/i)
})

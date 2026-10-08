import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  SELLER_OS_ONE_BUTTON_PUBLICATION_CONFIRMATION,
  sellerOsOneButtonNextActionV1,
} from "./seller-os-one-button-publication-v1.ts"

test("one-button publication exposes one exact human confirmation", () => {
  assert.equal(SELLER_OS_ONE_BUTTON_PUBLICATION_CONFIRMATION,
    "PUBLICAR ESTE LISTING EN EBAY")
})

test("one-button blocker resolution returns one truthful next action", () => {
  assert.equal(sellerOsOneButtonNextActionV1(
    "EBAY_OAUTH_TOKEN_REQUIRED").action, "CONNECT_EBAY_PRODUCTION")
  assert.equal(sellerOsOneButtonNextActionV1(
    "CURRENT_QTY1_SHIPPING_REQUIRED").action, "CAPTURE_QTY1_SHIPPING")
  assert.equal(sellerOsOneButtonNextActionV1(
    "CURRENT_FEE_AUTHORITY_UNAVAILABLE").action, "COMPLETE_FEE")
  assert.equal(sellerOsOneButtonNextActionV1(
    "CURRENT_OFFER_COLLECTION_AMBIGUOUS").action, "RESOLVE_DUPLICATE")
  assert.equal(sellerOsOneButtonNextActionV1(
    "EBAY_PUBLISH_OUTCOME_UNKNOWN").action,
  "RECONCILE_EXISTING_PUBLICATION")
  assert.equal(sellerOsOneButtonNextActionV1(
    "UPSTREAM_RATE_LIMIT_429").action, "WAIT_UPSTREAM")
})

test("dashboard click reuses canonical handoff and CURRENT publisher", () => {
  const dashboard = readFileSync(
    "app/admin/seller-os-operational-dashboard.tsx", "utf8")
  const route = readFileSync(
    "app/api/admin/ebay/draft-only/route.ts", "utf8")
  assert.match(dashboard, /action: "OWNER_REVIEW", intent: "CONFIRM"/)
  assert.match(dashboard, /action: "PUBLISH_HANDOFF"/)
  assert.match(dashboard, /action: "publish_current_one_click"/)
  assert.match(dashboard, /data-seller-os-one-button-publication/)
  assert.doesNotMatch(dashboard, /CONTINUAR AL PUBLISHER/)
  assert.match(route, /materializeCurrentPrepublicationArtifactsV1/)
  assert.match(route, /publishFinalPublication/)
  assert.match(route, /publishCurrentRevisionV1/)
  assert.match(route, /blindRetryAllowed: false/)
})

test("service-role runtime cannot use the human one-button action", () => {
  const route = readFileSync(
    "app/api/admin/ebay/draft-only/route.ts", "utf8")
  const start = route.indexOf("async function publishCurrentOneButtonV1")
  const end = route.indexOf("async function handlePost", start)
  const lane = route.slice(start, end)
  assert.ok(start > 0 && end > start)
  assert.match(lane, /authenticationMode !== "admin_user"/)
  assert.match(lane, /CURRENT_ONE_BUTTON_HUMAN_OWNER_REQUIRED/)
  assert.match(lane, /confirmExactPackage !== true/)
  assert.match(lane, /confirmProductionAccount !== true/)
})

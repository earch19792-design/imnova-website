import assert from "node:assert/strict"
import test from "node:test"

import {
  SELLER_OS_AUDIT_OBSERVABILITY_TOOLS_V1,
  SELLER_OS_CODEX_AUDIT_PROTOCOL_V1,
  projectSellerOsHistoricalMismatchFieldV1,
} from "./audit-observability-gateway-v1.ts"

test("registers exactly the two bounded read-only audit tools", () => {
  assert.deepEqual(SELLER_OS_AUDIT_OBSERVABILITY_TOOLS_V1.map((tool) =>
    tool.name), ["seller_os_get_product_case",
    "seller_os_get_publication_execution"])
  assert.equal(SELLER_OS_AUDIT_OBSERVABILITY_TOOLS_V1.length, 2)
  for (const tool of SELLER_OS_AUDIT_OBSERVABILITY_TOOLS_V1) {
    assert.equal(tool.annotations.readOnlyHint, true)
    assert.equal(tool.annotations.destructiveHint, false)
    assert.equal(tool.annotations.openWorldHint, false)
  }
})

test("historical mismatch ambiguity is never reconstructed", () => {
  assert.equal(projectSellerOsHistoricalMismatchFieldV1({
    error_class: "EBAY_OFFER_EXACT_PAYLOAD_MISMATCH",
    mismatch_fields: [],
  }), "UNPROVEN")
  assert.equal(projectSellerOsHistoricalMismatchFieldV1({}), "UNPROVEN")
  assert.deepEqual(projectSellerOsHistoricalMismatchFieldV1({
    mismatch_fields: ["categoryId", "price"],
  }), ["categoryId", "price"])
})

test("documents progressive audit disclosure before repo inspection", () => {
  assert.deepEqual(SELLER_OS_CODEX_AUDIT_PROTOCOL_V1.slice(0, 3), [
    "seller_os_get_system_review_bundle",
    "seller_os_get_product_case",
    "seller_os_get_publication_execution when Publisher-related",
  ])
})

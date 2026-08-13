import assert from "node:assert/strict"
import test from "node:test"

import {
  presentSellerOsCode,
  presentSellerOsCapability,
  presentSellerOsCapabilitySummary,
  presentSellerOsStatus,
  sellerOsCapabilityBucket,
  SELLER_OS_UI_LANGUAGE_POLICY_V1,
  SELLER_OS_UI_TYPOGRAPHY_V1,
} from "./presentation.ts"

test("la política de idioma traduce presentación y conserva los códigos técnicos", () => {
  assert.equal(SELLER_OS_UI_LANGUAGE_POLICY_V1.contractVersion,
    "SELLER_OS_UI_LANGUAGE_POLICY_V1")
  assert.equal(SELLER_OS_UI_LANGUAGE_POLICY_V1.technicalIdentifiers,
    "PRESERVE_SOURCE_CODE")
  assert.equal(presentSellerOsStatus("AVAILABLE"), "Disponible")
  assert.equal(presentSellerOsStatus("PARTIAL_CERTIFIED"), "Certificado parcialmente")
  assert.equal(presentSellerOsCode("DUPLICATE_LIVE_SKU"), "SKU duplicado")
  assert.equal(presentSellerOsCode("ACTIVE_VIOLATION"), "Incidencia activa")
  assert.equal(presentSellerOsStatus("STOCK_UNKNOWN"), "Stock desconocido")
  assert.equal(presentSellerOsStatus("HUMAN_REVIEW"), "Revisión humana")
  assert.equal(presentSellerOsCapability("qualityReport"), "Informe de calidad")
})

test("la escala tipográfica evita texto operativo microscópico", () => {
  assert.match(SELLER_OS_UI_TYPOGRAPHY_V1.pageTitle, /text-\[28px\]/)
  assert.match(SELLER_OS_UI_TYPOGRAPHY_V1.helper, /text-\[13px\]/)
  assert.match(SELLER_OS_UI_TYPOGRAPHY_V1.tablePrimary, /text-\[15px\]/)
  assert.match(SELLER_OS_UI_TYPOGRAPHY_V1.status, /text-\[13px\]/)
  assert.match(SELLER_OS_UI_TYPOGRAPHY_V1.button, /text-\[15px\]/)
})

test("el resumen de capacidades distingue disponible, limitado y no disponible", () => {
  assert.equal(sellerOsCapabilityBucket("AVAILABLE"), "AVAILABLE")
  assert.equal(sellerOsCapabilityBucket("PARTIAL"), "LIMITED")
  assert.equal(sellerOsCapabilityBucket("EVIDENCE_GATED"), "LIMITED")
  assert.equal(sellerOsCapabilityBucket("UNAVAILABLE"), "UNAVAILABLE")
  assert.equal(presentSellerOsCapabilitySummary({ AVAILABLE: 1, LIMITED: 3,
    UNAVAILABLE: 2 }),
  "1 capacidad disponible · 3 limitadas · 2 no disponibles")
  assert.equal(presentSellerOsCapabilitySummary({ AVAILABLE: 2, LIMITED: 1,
    UNAVAILABLE: 1 }),
  "2 capacidades disponibles · 1 limitada · 1 no disponible")
})

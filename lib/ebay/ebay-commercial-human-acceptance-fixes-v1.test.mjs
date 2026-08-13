import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { presentCommercialMonitorRegistryV1 } from
  "./ebay-commercial-monitor-registry-presentation-v1.ts"

const dashboard = readFileSync(new URL("../../app/admin/ebay/monitor/commercial-monitor-canonical-dashboard.tsx", import.meta.url), "utf8")
const stockPage = readFileSync(new URL("../../app/admin/ebay/stock-guard/page.tsx", import.meta.url), "utf8")
const readinessPage = readFileSync(new URL("../../app/admin/ebay/operational-readiness/page.tsx", import.meta.url), "utf8")
const navigation = readFileSync(new URL("../seller-os/navigation.ts", import.meta.url), "utf8")

test("la navegación de Inventario abre el espacio dedicado de solo lectura", () => {
  assert.match(navigation, /label: "Inventario"[\s\S]*?href: "\/admin\/ebay\/stock-guard"/)
  assert.match(stockPage, /fetch\("\/api\/admin\/ebay\/monitor"/)
  assert.doesNotMatch(stockPage, /method:\s*["']POST["']/)
  assert.match(stockPage, /Luna lista, no activada/)
  assert.match(stockPage, /No se realiza vinculación difusa ni automática/)
  assert.match(stockPage, /Desconocido no equivale a riesgo/)
})

test("Registry presentation derives current evidence and explains unavailable state", () => {
  const presented = presentCommercialMonitorRegistryV1({ status: "PARTIAL_CERTIFIED",
    currentLiveCount: 27, matchedCount: 24, humanReviewCount: 3,
    coveragePercent: null, limitationCodes: [] })
  assert.equal(presented.coveragePercent, 88.89)
  assert.equal(presented.summary, "24 matched · 3 review · 88.89%")
  const unavailable = presentCommercialMonitorRegistryV1({ status: "UNPROVEN",
    currentLiveCount: null, matchedCount: null, humanReviewCount: null,
    coveragePercent: null, limitationCodes: ["REGISTRY_READ_FAILED"] })
  assert.equal(unavailable.available, false)
  assert.match(unavailable.summary, /REGISTRY READ FAILED/)
  assert.match(dashboard, /registryPresentation\.summary/)
})

test("la vista humana de WhatsApp es primaria y el JSON técnico es secundario", () => {
  assert.match(readinessPage, /Vista previa humana de WhatsApp/)
  assert.match(readinessPage, /Ver JSON técnico de la simulación/)
  assert.match(readinessPage, /<details/)
  assert.match(readinessPage, /Revisión de plantillas de Meta · 8 familias/)
  assert.match(readinessPage, /dispatchAllowed=false/)
})

test("acceptance surfaces contain no marketplace or Registry mutation control", () => {
  for (const source of [stockPage, readinessPage]) {
    assert.doesNotMatch(source, /apply_ebay_registry_repair_v1|ReviseItem|EndItem|SendMessageToBuyer/)
  }
})

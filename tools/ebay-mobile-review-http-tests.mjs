import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  getMobileReviewPayloadError,
  readMobileReviewJson,
  sanitizeMobileReviewHttpMessage,
} from "../lib/ebay/ebay-mobile-review-http.ts"

const pageSource = readFileSync("app/admin/ebay/mobile-review/page.tsx", "utf8")
const queueSource = readFileSync("app/admin/ebay/mobile-review/opportunity-command-center.tsx", "utf8")
const connectorSource = readFileSync("lib/ebay/ebay-mobile-review-real-radar-connector.ts", "utf8")

test("reads a valid JSON Admin response without relying on Response.json", async () => {
  const payload = await readMobileReviewJson(
    new Response(JSON.stringify({ success: true, value: 7 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
    "No se pudo cargar",
  )

  assert.deepEqual(payload, { success: true, value: 7 })
})

test("turns a plain-text HTTP failure into a useful sanitized message", async () => {
  await assert.rejects(
    readMobileReviewJson(
      new Response("An error occurred while rendering this route", { status: 500 }),
      "No se pudo cargar Radar",
    ),
    (error) => {
      assert.match(error.message, /No se pudo cargar Radar/)
      assert.match(error.message, /HTTP 500/)
      assert.match(error.message, /An error occurred while rendering this route/)
      assert.doesNotMatch(error.message, /Unexpected token|valid JSON/)
      return true
    },
  )
})

test("removes HTML and credentials before an upstream message reaches the phone", async () => {
  const message = sanitizeMobileReviewHttpMessage(
    "<html><body>Gateway unavailable Bearer super-secret-token access_token=abc123</body></html>",
    "Error de conexión",
  )

  assert.match(message, /Gateway unavailable/)
  assert.match(message, /\[REDACTADO\]/)
  assert.doesNotMatch(message, /<html>|super-secret-token|abc123/)
})

test("preserves a useful JSON API error", async () => {
  await assert.rejects(
    readMobileReviewJson(
      new Response(JSON.stringify({ success: false, error: "El scan de Luna está ocupado" }), {
        status: 409,
        statusText: "Conflict",
      }),
      "No se pudo iniciar el scan",
    ),
    /El scan de Luna está ocupado · HTTP 409 Conflict/,
  )
  assert.equal(
    getMobileReviewPayloadError({ errors: [{ message: "Categoría pendiente" }] }, "Error"),
    "Categoría pendiente",
  )
})

test("mobile Radar flow has one recoverable missing-product state and no blind JSON parsing", () => {
  const combined = `${pageSource}\n${queueSource}\n${connectorSource}`
  assert.doesNotMatch(combined, /response\.json\s*\(/)
  assert.match(queueSource, /Este producto aún no está en Radar móvil/)
  assert.match(queueSource, /Actualizar Radar y reintentar/)
  assert.match(queueSource, /setMissingRadarOpportunity/)
  assert.match(queueSource, /onRadarLookup/)
  assert.match(queueSource, /No está en el Top 50 cargado\. Buscando el productId exacto en Radar/)
  assert.match(queueSource, /Producto encontrado por productId en Radar/)
  assert.match(connectorSource, /loadMarketRadarReadonlyProductById/)
  assert.match(connectorSource, /findMarketRadarProductById/)
  assert.match(pageSource, /mapMarketRadarProductToMobileCandidate\(product, 0\)/)
  assert.match(queueSource, /setError\(""\)\s*\n\s*setMessage\(""\)/)
  assert.doesNotMatch(queueSource, /Radar no tiene este producto cargado para revisión móvil todavía/)
})

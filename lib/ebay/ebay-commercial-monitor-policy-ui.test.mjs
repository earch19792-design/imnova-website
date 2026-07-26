import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const panel = readFileSync(
  "app/admin/ebay/mobile-review/commercial-monitor-panel.tsx",
  "utf8",
)

test("commercial actions require an enabled server capability", () => {
  assert.match(panel, /commercialPolicy\?\.capability === "enabled"/)
  assert.match(panel, /commercialPolicy\.canPreparePromotion === true/)
  assert.match(panel, /commercialPolicy\.canPreparePriceDecrease === true/)
  assert.match(
    panel,
    /commercialPolicy\.canPrepareProtectivePriceIncrease === true/,
  )
  assert.match(panel, /commercialPolicy\.canEndForOutOfStock === true/)
  assert.match(panel, /preview\.capability !== "enabled"/)
})

test("ACTIVE_ONLY is observation-only and never renders an inferred price action", () => {
  assert.match(
    panel,
    /MANTENER PRECIO · SIN VENTAS CONFIRMADAS · PROMOCIÓN 0%/,
  )
  assert.match(panel, /Observar mercado y actualizar Product Research/)
  assert.doesNotMatch(
    panel,
    /recommendation\.proposedPassesProfitGate !== false/,
  )
  assert.doesNotMatch(panel, /ACEPTAR PRECIO SEGURO/)
})

test("the UI does not promise a fixed five-percent promotion", () => {
  assert.doesNotMatch(panel, /Promoted Listings General al 5%/)
  assert.match(
    panel,
    /la promoción limitada que confirmó la política del servidor/,
  )
})

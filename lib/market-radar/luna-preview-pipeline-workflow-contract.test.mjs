import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const workflow = readFileSync(
  new URL(
    "../../.github/workflows/ebay-luna-preview-pipeline.yml",
    import.meta.url,
  ),
  "utf8",
)

test("Preview Luna workflow has a bounded configurable continuation loop", () => {
  assert.match(
    workflow,
    /MAX_WINDOWS_CONFIG: \$\{\{ vars\.EBAY_LUNA_PREVIEW_MAX_WINDOWS \}\}/,
  )
  assert.match(workflow, /max_windows="\$\{MAX_WINDOWS_CONFIG:-8\}"/)
  assert.match(workflow, /max_windows < 1/)
  assert.match(workflow, /max_windows=1/)
  assert.match(workflow, /max_windows > 12/)
  assert.match(workflow, /max_windows=12/)
  assert.match(workflow, /luna_deadline_seconds=\$\(\(SECONDS \+ 570\)\)/)
})

test("PARTIAL and TRUNCATED remain resumable and never start the eBay scan", () => {
  assert.match(workflow, /if \[ "\$scan_status" = "COMPLETE" \]/)
  assert.match(workflow, /complete=true/)
  assert.match(
    workflow,
    /if: steps\.luna\.outputs\.complete == 'true'/,
  )
  assert.match(workflow, /checkpoint will resume next execution/)
  assert.match(workflow, /opportunity scan deferred/)
  assert.match(workflow, /market-radar-luna-sync\?mode=readonly/)
  assert.doesNotMatch(workflow, /scan_status" = "TRUNCATED".*complete=true/s)
  assert.doesNotMatch(workflow, /scan_status" = "PARTIAL".*complete=true/s)
})

import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const route = await readFile(new URL(
  "../../app/api/admin/ebay/luna-supplier-linkage-review/route.ts",
  import.meta.url,
), "utf8")
const page = await readFile(new URL(
  "../../app/admin/ebay/luna-supplier-linkage-review/page.tsx",
  import.meta.url,
), "utf8")
const server = await readFile(new URL(
  "./ebay-luna-linkage-approval-admin-server-v1.ts", import.meta.url,
), "utf8")

test("Admin review route is fixed-scope, admin-user-only, no-store, and CSRF-bound", () => {
  assert.match(route, /validateAdminApiRequest\(request\)/)
  assert.match(route, /assertSellerOsLunaLinkageApprovalAdminV1\(auth\)/)
  assert.match(route, /getSupabaseAdminClient\(\)/)
  assert.match(route, /loadSellerOsLunaLinkageAdminReviewV1/)
  assert.match(route, /request\.nextUrl\.search/)
  assert.match(route, /LUNA_LINKAGE_ADMIN_REVIEW_CALLER_SCOPE_REJECTED/)
  assert.match(route, /private, no-store, no-cache/)
  assert.match(route, /httpOnly: true/)
  assert.match(route, /sameSite: "strict"/)
  assert.match(route,
    /path: ENDPOINT/)
  assert.match(route, /getSellerOsLunaLinkageApprovalAdminCsrfBoundaryV1\(\)\.issue/)
  assert.match(route, /getSellerOsLunaLinkageApprovalAdminCsrfBoundaryV1\(\)\.consume/)
  assert.match(route, /currentCohortId: loaded\.reviewSet\.currentCohortId/)
  assert.match(route, /reviewSetDigest: loaded\.reviewSet\.reviewSetDigest/)
  assert.match(route, /csrfHeader: request\.headers\.get\("x-seller-os-csrf"\)/)
  assert.match(route, /csrfCookie: request\.cookies\.get\(CSRF_COOKIE\)/)
})

test("POST reloads the current set and writes only through the bounded repository", () => {
  const postStart = route.indexOf("export async function POST")
  const post = route.slice(postStart)
  const parseAt = post.indexOf("readDecisionRequest(request)")
  const reloadAt = post.indexOf("loadSellerOsLunaLinkageAdminReviewV1(client)")
  const consumeAt = post.indexOf(".consume({")
  const executeAt = post.indexOf("executeSellerOsLunaLinkageApprovalDecisionV1")
  assert.ok(parseAt >= 0 && reloadAt > parseAt && consumeAt > reloadAt &&
    executeAt > consumeAt)
  assert.match(post, /createSellerOsLunaLinkageApprovalRepositoryV1/)
  assert.match(post, /durableStore: repository\.recordDecision/)
  assert.doesNotMatch(post, /replaceReviewSet/)
  assert.doesNotMatch(post, /GetSellerList|GetMyeBaySelling|GetItem/)
  assert.match(post, /lunaStockReads: 0/)
  assert.match(post, /marketplaceWrites: 0/)
})

test("server parser admits exactly the canonical six decision keys", () => {
  for (const key of [
    "reviewSetId", "currentCohortId", "ebayItemId",
    "candidateEvidenceDigest", "decision", "decisionVersion",
  ]) assert.match(server, new RegExp(`"${key}"`))
  assert.match(server, /parseSellerOsLunaLinkageApprovalRequestV1\(\{\s*reviewSetId:/s)
  assert.match(server,
    /SELLER_OS_LUNA_LINKAGE_CURRENT_REVIEW_COUNT = 26/)
  assert.match(server, /\.eq\("marketplace_id", "EBAY_US"\)/)
  assert.match(server, /\.eq\("is_current", true\)/)
  assert.match(server, /\.limit\(SELLER_OS_LUNA_LINKAGE_CURRENT_REVIEW_COUNT \+ 1\)/)
  assert.doesNotMatch(server, /callerUrl|p_sql|arbitrary/i)
})

test("UI submits only server-bound identifiers and has no identity editor", () => {
  assert.match(page, /credentials: "same-origin"/)
  assert.match(page, /Authorization: `Bearer \$\{token\}`/)
  assert.match(page, /"X-Seller-OS-CSRF": csrfToken/)
  assert.match(page, /body: JSON\.stringify\(\{\s*reviewSetId:\s*reviewSet\.reviewSetId,\s*currentCohortId:\s*reviewSet\.currentCohortId,\s*ebayItemId:\s*entry\.ebayItemId,\s*candidateEvidenceDigest:\s*entry\.evidenceDigest,\s*decision,\s*decisionVersion:\s*entry\.decisionVersion/s)
  assert.match(page, /entry\.allowedOperatorDecisions\.map/)
  assert.match(page, /window\.confirm/)
  assert.doesNotMatch(page, /<input|<textarea|contentEditable/)
  const postBody = page.match(/body: JSON\.stringify\(\{([\s\S]*?)\}\),/g)?.[0] ?? ""
  assert.doesNotMatch(postBody,
    /lunaProductId|lunaVariantId|components|accountKey|url|sql/i)
  assert.match(page, /NOT_EVALUATED/)
})

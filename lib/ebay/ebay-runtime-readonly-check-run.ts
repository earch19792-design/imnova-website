export const EBAY_RUNTIME_READONLY_CHECK_RUN_VERSION = "EBAY_RUNTIME_READONLY_CHECK_RUN_V1"

export type RuntimeReadResult = {
  categoryLookupExecuted?: boolean; categoryId?: string | null; categoryNameOrPath?: string | null
  fulfillmentPoliciesLookupExecuted?: boolean; fulfillmentPolicyId?: string | null
  returnPoliciesLookupExecuted?: boolean; returnPolicyId?: string | null
  paymentPoliciesLookupExecuted?: boolean; paymentPolicyId?: string | null
  merchantLocationLookupExecuted?: boolean; merchantLocationKey?: string | null
  error?: string | null
}

type Fixture = { version?: string; productTitle?: string; marketplaceId?: string; environment?: string; exactApprovalPhrase?: string; merchantLocationRequired?: boolean; requiredData?: string[]; allowedMethods?: string[]; forbiddenActions?: string[] }
type Gate = { executeRequested?: boolean; approvalPhrase?: string; environment?: string; marketplaceId?: string; runIdPresent?: boolean; tokenPresenceChecked?: boolean; tokenPresentBooleanOnly?: boolean }
const value = (x: unknown) => typeof x === "string" && x.trim() ? x.trim() : null

export function buildEbayRuntimeReadonlyCheckInput(fixture: Fixture, gate: Gate = {}, result: RuntimeReadResult = {}) {
  return { fixture, gate, result, productTitle: value(fixture.productTitle), marketplaceId: value(gate.marketplaceId) ?? value(fixture.marketplaceId), environment: value(gate.environment) ?? value(fixture.environment) }
}
export function buildReadonlyRuntimeGate(input: ReturnType<typeof buildEbayRuntimeReadonlyCheckInput>) {
  const approvalAccepted = input.gate.approvalPhrase === input.fixture.exactApprovalPhrase
  const environmentAccepted = input.environment === "PRODUCTION" || input.environment === "SANDBOX"
  const marketplaceAccepted = input.marketplaceId === "EBAY_US"
  const tokenPresent = input.gate.tokenPresenceChecked === true && input.gate.tokenPresentBooleanOnly === true
  const gatePassed = input.gate.executeRequested === true && approvalAccepted && environmentAccepted && marketplaceAccepted && input.gate.runIdPresent === true && tokenPresent
  return { approvalAccepted, environmentAccepted, marketplaceAccepted, tokenPresenceChecked: input.gate.tokenPresenceChecked === true, tokenPresentBooleanOnly: tokenPresent, runIdPresent: input.gate.runIdPresent === true, gatePassed }
}
export function buildNoWriteReadonlyGuard(input: ReturnType<typeof buildEbayRuntimeReadonlyCheckInput>) {
  const forbidden = ["createOrReplaceInventoryItem", "createOffer", "publishOffer", "publish", "createActiveListing", "reviseActiveListing", "bulkPublish"]
  return { noWriteGuardPassed: input.fixture.allowedMethods?.every(x => x === "GET") === true && forbidden.every(x => input.fixture.forbiddenActions?.includes(x)), publishOfferForbidden: true, ebayWriteApiUsed: false, canExecuteEbayWrite: false, canPublish: false }
}
export function sanitizeRuntimeReadonlyResult(result: RuntimeReadResult): RuntimeReadResult {
  return { categoryLookupExecuted: result.categoryLookupExecuted === true, categoryId: value(result.categoryId), categoryNameOrPath: value(result.categoryNameOrPath), fulfillmentPoliciesLookupExecuted: result.fulfillmentPoliciesLookupExecuted === true, fulfillmentPolicyId: value(result.fulfillmentPolicyId), returnPoliciesLookupExecuted: result.returnPoliciesLookupExecuted === true, returnPolicyId: value(result.returnPolicyId), paymentPoliciesLookupExecuted: result.paymentPoliciesLookupExecuted === true, paymentPolicyId: value(result.paymentPolicyId), merchantLocationLookupExecuted: result.merchantLocationLookupExecuted === true, merchantLocationKey: value(result.merchantLocationKey), error: value(result.error) }
}
export function buildRuntimeReadonlyRouteRecommendation(input: ReturnType<typeof buildEbayRuntimeReadonlyCheckInput>) {
  const gate = buildReadonlyRuntimeGate(input), r = sanitizeRuntimeReadonlyResult(input.result)
  if (!input.gate.executeRequested) return "SAFE_NO_READ"
  if (!gate.tokenPresentBooleanOnly) return "NEED_RUNTIME_EBAY_ACCESS_TOKEN"
  if (!gate.gatePassed || r.error) return "EBAY-RESUME-HOLD"
  if (!r.categoryId) return "NEED_CATEGORY_RUNTIME_CONFIRMATION"
  if (!r.fulfillmentPolicyId || !r.returnPolicyId || !r.paymentPolicyId) return "NEED_SELLER_POLICY_RUNTIME_CONFIRMATION"
  if (input.fixture.merchantLocationRequired && !r.merchantLocationKey) return "NEED_INVENTORY_LOCATION_RUNTIME_CONFIRMATION"
  return "READY_FOR_CONTROLLED_DRAFT_ONLY_REAL_RUN"
}
export function buildEbayRuntimeReadonlyCheckReport(fixture: Fixture, gate: Gate = {}, result: RuntimeReadResult = {}) {
  const input = buildEbayRuntimeReadonlyCheckInput(fixture, gate, result), g = buildReadonlyRuntimeGate(input), guard = buildNoWriteReadonlyGuard(input), r = sanitizeRuntimeReadonlyResult(result)
  const resolved = [r.categoryId, r.fulfillmentPolicyId, r.returnPolicyId, r.paymentPolicyId, input.fixture.merchantLocationRequired ? r.merchantLocationKey : "NOT_REQUIRED"]
  return { runtimeReadonlyCheckReportBuilt: true, mode: gate.executeRequested ? "HARD_GATED_READ_ONLY_RUNTIME_CHECK" : "SAFE_NO_READ", productTitle: input.productTitle, marketplaceId: input.marketplaceId, environment: input.environment, ...r, categoryIdResolved: Boolean(r.categoryId), fulfillmentPolicyResolved: Boolean(r.fulfillmentPolicyId), returnPolicyResolved: Boolean(r.returnPolicyId), paymentPolicyResolved: Boolean(r.paymentPolicyId), merchantLocationKeyResolved: Boolean(r.merchantLocationKey), ...g, ...guard, tokenStored: false, tokenPrinted: false, realEbayApiUsed: gate.executeRequested === true && g.gatePassed && (r.categoryLookupExecuted === true || r.error?.startsWith("READ_ONLY_GET_FAILED_") === true), draftCreated: false, inventoryItemCreated: false, offerCreated: false, listingCreated: false, publicationExecuted: false, runtimeDataResolvedCount: resolved.filter(Boolean).length, runtimeDataRequiredCount: 5, runtimeDataAllResolved: resolved.every(Boolean), nextRecommendedRoute: buildRuntimeReadonlyRouteRecommendation(input) }
}

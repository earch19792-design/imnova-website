// Read-only projection. Neither a probe nor a recovered binding authorizes a job.
export type CanonicalDestinationMatchStatusV1 = 'NOT_EVALUATED' | 'MATCH' | 'MISMATCH'
export function canonicalDestinationMatchStatusV1(comparison: unknown): CanonicalDestinationMatchStatusV1 {
  return comparison === 'MATCH' || comparison === 'MISMATCH' ? comparison : 'NOT_EVALUATED'
}
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const MARKERS = ['shipToMarker', 'shippingMarker', 'subtotalMarker', 'totalMarker', 'payNowMarker']
const FACTS = ['checkoutTabFound', 'checkoutHostMatch', 'checkoutInjectionRequested',
  'checkoutInjectionApiSucceeded', 'checkoutScriptBootstrapAck',
  'checkoutContentScriptResponded', 'checkoutPageDetected', 'shopPayMarkersEvaluated',
  'shopPayRequiredMarkersReady', 'checkoutDomReady']
// Compact diagnostic transport fits the existing lease's <1024-byte constraint.
// It changes neither the schema nor the capability authority.
export function compactCheckoutObservationV1(value: unknown) {
  const d = checkoutObservationV1(value)
  if (!d) return null
  return { version: d.version, encoding: 'BOOLEAN_VECTOR_V1',
    facts: FACTS.map(key => record(d)[key]),
    markers: MARKERS.map(key => d.observedMarkers.includes(key)),
    runtimeFailure: d.checkoutNotReadyReason === 'PROBE_RUNTIME_FAILURE' }
}
export function checkoutObservationV1(value: unknown) {
  let v = record(value)
  if (v.encoding === 'BOOLEAN_VECTOR_V1') {
    if (!Array.isArray(v.facts) || v.facts.length !== FACTS.length ||
        !Array.isArray(v.markers) || v.markers.length !== MARKERS.length ||
        v.facts.some(x => x !== null && typeof x !== 'boolean') ||
        v.markers.some(x => typeof x !== 'boolean')) return null
    const facts = v.facts, markers = v.markers
    v = { version: v.version, ...Object.fromEntries(FACTS.map((key,i) => [key,facts[i]])),
      observedMarkers: MARKERS.filter((_,i) => markers[i]),
      checkoutNotReadyReason: v.runtimeFailure === true ? 'PROBE_RUNTIME_FAILURE' : null }
  }
  if (v.version !== 'LUNA_CHECKOUT_OBSERVATION_V1') return null
  const bool = (key: string) => v[key] === true
  const nullable = (key: string) => typeof v[key] === 'boolean' ? v[key] as boolean : null
  const observed = Array.isArray(v.observedMarkers) ? MARKERS.filter(k => (v.observedMarkers as unknown[]).includes(k)) : []
  const responded = bool('checkoutContentScriptResponded')
  const evaluated = responded && bool('shopPayMarkersEvaluated')
  const missing = evaluated ? MARKERS.filter(k => !observed.includes(k)) : []
  const markersReady = evaluated && missing.length === 0 && bool('shopPayRequiredMarkersReady')
  const ready = bool('checkoutTabFound') && bool('checkoutHostMatch') && responded && bool('checkoutPageDetected') && markersReady && bool('checkoutDomReady')
  // Derive the reason from observations; never trust a READY string alone.
  const reason = v.checkoutNotReadyReason === 'PROBE_RUNTIME_FAILURE' ? 'PROBE_RUNTIME_FAILURE'
    : !bool('checkoutTabFound') ? 'NO_CHECKOUT_TAB'
    : !bool('checkoutHostMatch') ? 'HOST_MISMATCH'
    : bool('checkoutInjectionRequested') && v.checkoutInjectionApiSucceeded === false ? 'INJECTION_FAILED'
    : !responded ? 'CONTENT_SCRIPT_NO_RESPONSE'
    : !evaluated ? 'CONTENT_SCRIPT_RESPONSE_INVALID'
    : !bool('checkoutPageDetected') ? 'CHECKOUT_PAGE_NOT_DETECTED'
    : !ready ? 'REQUIRED_MARKERS_MISSING' : 'READY'
  return {
    version: 'LUNA_CHECKOUT_OBSERVATION_V1',
    checkoutTabFound: bool('checkoutTabFound'), checkoutHostMatch: bool('checkoutHostMatch'),
    checkoutInjectionRequested: bool('checkoutInjectionRequested'),
    checkoutInjectionApiSucceeded: nullable('checkoutInjectionApiSucceeded'),
    checkoutScriptBootstrapAck: nullable('checkoutScriptBootstrapAck'),
    checkoutContentScriptResponded: responded, checkoutPageDetected: bool('checkoutPageDetected'),
    shopPayMarkersEvaluated: evaluated, shopPayRequiredMarkersReady: markersReady,
    checkoutDomReady: ready && reason === 'READY', checkoutNotReadyReason: reason,
    expectedMarkers: MARKERS, observedMarkers: evaluated ? observed : [], missingMarkers: missing,
    markerContractDrift: null, productIdentityStatus: 'NOT_EVALUATED', quantityIdentityStatus: 'NOT_EVALUATED',
  }
}

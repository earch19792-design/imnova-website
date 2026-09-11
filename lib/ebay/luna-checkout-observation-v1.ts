// Read-only projection. Neither a probe nor a recovered binding authorizes a job.
export type CanonicalDestinationMatchStatusV1 = 'NOT_EVALUATED' | 'MATCH' | 'MISMATCH'
export function canonicalDestinationMatchStatusV1(comparison: unknown): CanonicalDestinationMatchStatusV1 {
  return comparison === 'MATCH' || comparison === 'MISMATCH' ? comparison : 'NOT_EVALUATED'
}
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const MARKERS = ['shipToMarker', 'shippingMarker', 'subtotalMarker', 'totalMarker', 'payNowMarker']
export function checkoutObservationV1(value: unknown) {
  const v = record(value)
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

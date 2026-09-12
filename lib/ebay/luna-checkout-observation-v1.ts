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
const RECOVERY_CODES = ['HOST_PERMISSION_DENIED', 'TAB_CLOSED', 'FRAME_UNAVAILABLE',
  'SCRIPT_RESOURCE_UNAVAILABLE', 'EXTENSION_CONTEXT_INVALIDATED', 'INJECTION_TIMEOUT',
  'INJECTION_API_ERROR', 'INJECTION_FRAME_MISMATCH', 'CONTENT_SCRIPT_NO_RESPONSE',
  'ACTIVE_JOB_OR_INVALID_TAB', 'ACTIVE_JOB', 'OBSERVER_RECOVERY_BACKOFF']
const RECOVERY_FIELDS = ['checkoutTabIdPresent', 'checkoutFrameId', 'checkoutHostPermissionMatch',
  'checkoutContentScriptLoaded', 'checkoutContentScriptPortConnected', 'checkoutInjectionErrorCode',
  'checkoutScriptBootstrapErrorCode', 'recoveryBlockedReason']
// Compact diagnostic transport fits the existing lease's <1024-byte constraint.
// It changes neither the schema nor the capability authority.
export function compactCheckoutObservationV1(value: unknown) {
  const d = checkoutObservationV1(value)
  if (!d) return null
  return { version: d.version, encoding: 'BOOLEAN_VECTOR_V1',
    facts: FACTS.map(key => record(d)[key]),
    markers: MARKERS.map(key => d.observedMarkers.includes(key)),
    runtimeFailure: d.checkoutNotReadyReason === 'PROBE_RUNTIME_FAILURE',
    recovery: RECOVERY_FIELDS.map(key => record(d)[key]) }
}
export function checkoutObservationV1(value: unknown) {
  let v = record(value)
  if (v.encoding === 'BOOLEAN_VECTOR_V1') {
    if (!Array.isArray(v.facts) || v.facts.length !== FACTS.length ||
        !Array.isArray(v.markers) || v.markers.length !== MARKERS.length ||
        v.facts.some(x => x !== null && typeof x !== 'boolean') ||
        v.markers.some(x => typeof x !== 'boolean')) return null
    const facts = v.facts, markers = v.markers
    const recovery = Array.isArray(v.recovery) ? v.recovery : []
    v = { version: v.version, ...Object.fromEntries(RECOVERY_FIELDS.map((key,i) => [key,recovery[i]])), ...Object.fromEntries(FACTS.map((key,i) => [key,facts[i]])),
      observedMarkers: MARKERS.filter((_,i) => markers[i]),
      checkoutNotReadyReason: v.runtimeFailure === true ? 'PROBE_RUNTIME_FAILURE' : null }
  }
  if (v.version !== 'LUNA_CHECKOUT_OBSERVATION_V1') return null
  const bool = (key: string) => v[key] === true
  const nullable = (key: string) => typeof v[key] === 'boolean' ? v[key] as boolean : null
  const code = (key: string) => RECOVERY_CODES.includes(String(v[key])) ? String(v[key]) : null
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
    : code('recoveryBlockedReason') ? code('recoveryBlockedReason')
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
    checkoutTabIdPresent: nullable('checkoutTabIdPresent'), checkoutFrameId: v.checkoutFrameId === 0 ? 0 : null,
    checkoutHostPermissionMatch: nullable('checkoutHostPermissionMatch'),
    checkoutContentScriptLoaded: nullable('checkoutContentScriptLoaded'),
    checkoutContentScriptPortConnected: nullable('checkoutContentScriptPortConnected'),
    checkoutTransport: 'RUNTIME_MESSAGE',
    checkoutInjectionErrorCode: code('checkoutInjectionErrorCode'),
    checkoutScriptBootstrapErrorCode: code('checkoutScriptBootstrapErrorCode'),
    recoveryBlockedReason: code('recoveryBlockedReason'),
    checkoutContentScriptResponded: responded, checkoutPageDetected: bool('checkoutPageDetected'),
    shopPayMarkersEvaluated: evaluated, shopPayRequiredMarkersReady: markersReady,
    checkoutDomReady: ready && reason === 'READY', checkoutNotReadyReason: reason,
    expectedMarkers: MARKERS, observedMarkers: evaluated ? observed : [], missingMarkers: missing,
    markerContractDrift: null, productIdentityStatus: 'NOT_EVALUATED', quantityIdentityStatus: 'NOT_EVALUATED',
  }
}

// The certified runner creates its own checkout navigation from the exact job.
// A missing pre-existing Shop Pay tab is therefore bootstrap-capable. Observed
// permission, frame, injection and content-script failures remain fail-closed.
export function lunaShippingAutoNavigationCapableV1(value: unknown) {
  const probe = record(value)
  if (probe.contract !== 'LUNA_CAPTURE_READ_ONLY_PROBE_V1' ||
      probe.canonicalBindingPresent !== true) return false
  const observation = checkoutObservationV1(probe.checkoutObservation)
  return Boolean(observation && (
    observation.checkoutDomReady === true ||
    (observation.checkoutNotReadyReason === 'NO_CHECKOUT_TAB' &&
      observation.checkoutTabFound === false &&
      observation.checkoutInjectionRequested === false &&
      observation.recoveryBlockedReason === null &&
      observation.checkoutInjectionErrorCode === null)
  ))
}

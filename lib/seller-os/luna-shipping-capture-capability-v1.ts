import { LUNA_SHIPPING_EXTENSION_MAXIMUM_CAPTURE_AGE_MS } from "../ebay/ebay-luna-chrome-shipping-capture-v1"
type Event = { state: string; success: boolean; timestamp: string; traceId: string }

/** Heartbeat proves connectivity only. A current, complete successful capture
 * trace proves capture capability; a subsequent failure invalidates it. */
export function projectLunaShippingCaptureCapabilityV1(input: { connected: boolean;
  traceAvailable: boolean; events: readonly Event[]; now: Date }) {
  const now = input.now.getTime()
  const events = input.events.slice(-100).filter(e => Number.isFinite(Date.parse(e.timestamp)))
    .sort((a,b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
  const latest = events.at(-1)
  const trace = latest ? events.filter(e => e.traceId === latest.traceId) : []
  const current = (e: Event) => Date.parse(e.timestamp) <= now &&
    now - Date.parse(e.timestamp) < LUNA_SHIPPING_EXTENSION_MAXIMUM_CAPTURE_AGE_MS
  const failure = trace.some(e => !e.success || e.state === "FAIL")
  const captureCapable = input.connected && input.traceAvailable && !failure &&
    ["CANONICAL_DESTINATION_MATCH", "SHIPPING_PARSED", "DURABLE_READBACK"].every(state =>
      trace.some(e => e.state === state && e.success && current(e)))
  return { connected: input.connected, captureCapable,
    label: captureCapable ? "CAPTURA DISPONIBLE" : "LIMITADA TEMPORALMENTE",
    reason: !input.connected ? "SHIPPING_WORKER_CONNECTION_UNPROVEN" : !input.traceAvailable
      ? "SHIPPING_CAPTURE_EVIDENCE_UNAVAILABLE" : failure ? "SHIPPING_CAPTURE_FAILURE"
        : captureCapable ? "CURRENT_COMPLETE_SHIPPING_CAPTURE_PROVEN" : "CURRENT_SHIPPING_CAPTURE_UNPROVEN",
    connectionAndCapabilitySeparated: true, heartbeatProvesShipping: false,
    shippingCostProvenByConnection: false }
}

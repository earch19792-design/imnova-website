type Row = Record<string, any>
export type MayelShippingSnapshotV1 = {
  observedAt: string; accountKey: string; worker: Row | null; lease: Row | null;
  ebay: Row | null; itemIds: string[]; jobs: Row[]; evidence: Row[]; economics: Row[];
}
const future = (v: unknown, now: number) => Date.parse(String(v ?? "")) > now
const observed = (v: unknown, now: number) => Number.isFinite(Date.parse(String(v))) && Date.parse(String(v)) <= now
export function projectMayelShippingVisibilityV1(snapshot: MayelShippingSnapshotV1 | null, now = Date.now()) {
  const w = snapshot?.worker, l = snapshot?.lease
  const connected = w?.extension_identity_match === true && w.physical_connection === "PROVEN_AVAILABLE" &&
    observed(w.observed_at, now) && future(w.fresh_until, now)
  const probeFresh = observed(l?.shipping_capability_observed_at, now) &&
    Date.parse(String(l?.shipping_capability_observed_at)) > now - 300000
  const available = connected && probeFresh && l?.shipping_capture_state === "AVAILABLE" &&
    l.shipping_capability_worker_id === w?.worker_instance_id && l.worker_instance_id === w?.worker_instance_id
  const autoResume = available && future(l?.lease_expires_at, now) && !future(l?.shipping_next_attempt_at, now)
  const rows = (snapshot?.itemIds ?? []).map(itemId => {
    const e = snapshot?.evidence.find(e => e.ebay_item_id === itemId && e.evidence_type === "LUNA_CURRENT_SHIPPING")
    const job = snapshot?.jobs.find(j => j.ebay_item_id === itemId)
    const econ = snapshot?.economics.find(e => e.ebay_item_id === itemId)
    const fresh = !!e && e.marketplace_account_key === snapshot?.accountKey && e.freshness_status === "FRESH" &&
      typeof e.evidence_id === "string" && e.evidence_id.length > 0 &&
      e.value_amount !== null && e.value_amount !== undefined && Number.isFinite(Number(e.value_amount)) && Number(e.value_amount) >= 0 &&
      observed(e.captured_at, now) && future(e.fresh_until, now)
    const updating = job?.status === "REFRESHING" && future(job.lease_expires_at, now)
    const attention = ["FAILED_TERMINAL", "DEAD_LETTER", "REQUIRES_ATTENTION"].includes(job?.status)
    const economicsReevaluated = fresh && !!econ && econ.input_evidence_ids?.LUNA_CURRENT_SHIPPING === e?.evidence_id &&
      observed(econ?.calculated_at, now) && Date.parse(econ.calculated_at) >= Date.parse(e!.captured_at)
    return { itemId, fresh, economicsReevaluated, state: fresh ? "VIGENTE" : updating ? "ACTUALIZANDO" :
      attention ? "REQUIERE ATENCIÓN" : "ESPERANDO ACTUALIZACIÓN" }
  })
  const shipping = rows.some(r => r.state === "REQUIERE ATENCIÓN") ? "REQUIERE ATENCIÓN" :
    rows.some(r => r.state === "ACTUALIZANDO") ? "ACTUALIZANDO" : rows.length && rows.every(r => r.fresh) ? "VIGENTE" : "ESPERANDO ACTUALIZACIÓN"
  const at = l?.shipping_capability_observed_at
  const ageMinutes = observed(at, now) ? Math.floor((now - Date.parse(at)) / 60000) : null
  return { extension: connected ? "CONECTADA" : "NO CONECTADA",
    capture: !connected ? "NO CONECTADA" : available ? "DISPONIBLE" : "LIMITADA TEMPORALMENTE",
    autoResume: autoResume ? "ACTIVO" : "EN ESPERA", shipping, rows,
    ebay: snapshot?.ebay?.current_live_source_state === "CURRENT_FRESH" && future(snapshot.ebay.last_certified_live_fresh_until, now)
      ? "DISPONIBLE" : /QUOTA|RATE_LIMIT|TEMPORAR/.test(String(snapshot?.ebay?.current_live_last_error_code ?? "")) ? "LIMITADO TEMPORALMENTE" : "POR COMPROBAR",
    lastObservation: ageMinutes === null ? "Sin observación" : ageMinutes < 1 ? "Hace un momento" : ageMinutes < 60 ? `Hace ${ageMinutes} min` : `Hace ${Math.floor(ageMinutes / 60)} h`,
    economicsReevaluated: rows.length > 0 && rows.every(r => r.economicsReevaluated),
  }
}

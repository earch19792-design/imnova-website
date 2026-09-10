import { projectMayelShippingVisibilityV1, type MayelShippingSnapshotV1 } from "./mayel-shipping-visibility-v1"
const knownAmount = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0
/** Display the analysis amount, never substitute a new quote into old economics. */
export function promotionShippingLabelV1(input: { itemId: string; value: number | null; reference?: string | null;
  snapshot: MayelShippingSnapshotV1 | null; now?: number }) {
  if (!knownAmount(input.value)) return "Esperando actualización"
  const quote = input.snapshot?.evidence.find(e => e.ebay_item_id === input.itemId && e.evidence_type === "LUNA_CURRENT_SHIPPING")
  const current = projectMayelShippingVisibilityV1(input.snapshot, input.now).rows.find(r => r.itemId === input.itemId)
  const sameQuote = !!input.reference && quote?.evidence_id === input.reference && Number(quote.value_amount) === input.value
  return `$${input.value.toFixed(2)} · ${current?.fresh && sameQuote ? "Vigente" : "Vencido"}`
}

/** Preserve source numbers; only explicit unit metadata authorizes scaling. */
export function promotionMetricLabelV1(key: string, value: number | null | undefined, unit: string | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "Sin datos para este periodo"
  if (key === "ctr" || key === "conversion") {
    if (unit === "PERCENT") return `${value}%`
    if (unit === "RATIO") return `${Number((value * 100).toPrecision(15))}%`
    return "Porcentaje pendiente de confirmar"
  }
  return key === "salesRevenue" ? `${value}${unit ? ` ${unit}` : " · moneda por confirmar"}` : String(value)
}

export function promotionDataLabelV1(input: { complete: boolean; sampleSufficient: boolean;
  treatment: string; ownerActionRequired?: boolean }) {
  if (input.ownerActionRequired === true || input.treatment === "RESTOCK") return "REQUIERE ATENCIÓN"
  return input.complete && input.sampleSufficient ? "COMPLETO" : "ESPERANDO DATOS"
}
export function promotionEconomicStatusV1(input: { feesProven: boolean; economicsProven: boolean }) {
  if (!input.feesProven) return { status: "WAITING_FOR_FEES", label: "Economía: esperando comisiones eBay. El beneficio, margen y techo Ads se calcularán cuando estén demostrados los costes pendientes." }
  return input.economicsProven ? { status:"PROVEN",label:"Economía comprobada." } :
    {status:"WAITING_FOR_DATA",label:"Economía: esperando costes vigentes para comprobar el beneficio."}
}

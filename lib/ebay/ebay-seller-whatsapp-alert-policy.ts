export const EBAY_SELLER_WHATSAPP_ALERT_POLICY_VERSION =
  "EBAY_SELLER_WHATSAPP_ALERT_POLICY_V1"

export const SELLER_WHATSAPP_ALERT_TYPES = [
  "system_test",
  "winner_ready",
  "luna_restock",
  "luna_cost_drop",
  "out_of_stock",
  "low_stock",
  "price_up",
  "margin_risk",
  "mapping_broken",
  "draft_failure",
  "approval_expiration",
] as const

export type SellerWhatsAppAlertType =
  typeof SELLER_WHATSAPP_ALERT_TYPES[number]

export type SellerWhatsAppPriority =
  | "critical"
  | "high"
  | "medium"
  | "low"

export type SellerWhatsAppDeliveryClass =
  | "immediate"
  | "digest"

export type SellerWhatsAppAlertFacts = {
  potentialScore?: number | null
  confidenceScore?: number | null
  currentStock?: number | null
  previousStock?: number | null
  estimatedMarginPct?: number | null
  estimatedNetProfit?: number | null
  costChangePct?: number | null
  hasExactEvidence?: boolean | null
  hasActiveListing?: boolean | null
  supplierAvailable?: boolean | null
  terminalFailure?: boolean | null
  hoursUntilExpiration?: number | null
}

export type SellerWhatsAppAlertDecision = {
  eligible: boolean
  reason: string
  priority: SellerWhatsAppPriority
  deliveryClass: SellerWhatsAppDeliveryClass
  cooldownSeconds: number
  recommendedAction: string
}

function number(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function sellerWhatsAppPriorityRank(
  priority: SellerWhatsAppPriority,
) {
  return {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  }[priority]
}

function winnerDecision(
  facts: SellerWhatsAppAlertFacts,
): SellerWhatsAppAlertDecision {
  const potential = number(facts.potentialScore)
  const confidence = number(facts.confidenceScore)
  const stock = number(facts.currentStock)
  const margin = number(facts.estimatedMarginPct)
  const profit = number(facts.estimatedNetProfit)
  const exactEvidence = facts.hasExactEvidence === true
  const blockers: string[] = []

  if (potential === null || potential < 75) blockers.push("potential_below_75")
  if (confidence === null || confidence < 70) blockers.push("confidence_below_70")
  if (stock === null || stock < 4) blockers.push("stock_below_4")
  if (margin === null || margin < 20) blockers.push("margin_below_20")
  if (profit === null || profit < 5) blockers.push("profit_below_5")
  if (!exactEvidence) blockers.push("exact_market_evidence_missing")

  return {
    eligible: blockers.length === 0,
    reason: blockers.length ? blockers.join(",") : "verified_winner_ready",
    priority: "high",
    deliveryClass: "immediate",
    cooldownSeconds: 12 * 60 * 60,
    recommendedAction:
      "Revisar el paquete móvil y autorizar el draft antes de que cambie la oportunidad.",
  }
}

export function classifySellerWhatsAppAlert(
  alertType: SellerWhatsAppAlertType,
  facts: SellerWhatsAppAlertFacts = {},
): SellerWhatsAppAlertDecision {
  if (alertType === "system_test") {
    return {
      eligible: true,
      reason: "controlled_preview_delivery_test",
      priority: "low",
      deliveryClass: "immediate",
      cooldownSeconds: 5 * 60,
      recommendedAction:
        "Confirmar la recepción del mensaje de prueba en el teléfono configurado.",
    }
  }

  if (alertType === "winner_ready") return winnerDecision(facts)

  if (alertType === "out_of_stock") {
    const stock = number(facts.currentStock)
    const eligible = facts.hasActiveListing === true &&
      (facts.supplierAvailable === false || (stock !== null && stock <= 0))
    return {
      eligible,
      reason: eligible
        ? "active_listing_without_supplier_stock"
        : "active_listing_out_of_stock_not_confirmed",
      priority: "critical",
      deliveryClass: "immediate",
      cooldownSeconds: 60 * 60,
      recommendedAction:
        "Pausar o corregir cantidad en eBay y confirmar la reposición inmediatamente.",
    }
  }

  if (alertType === "low_stock") {
    const stock = number(facts.currentStock)
    const eligible = facts.hasActiveListing === true &&
      facts.supplierAvailable !== false && stock !== null && stock >= 1 && stock <= 3
    return {
      eligible,
      reason: eligible
        ? "active_listing_low_supplier_stock"
        : "active_listing_low_stock_not_confirmed",
      priority: "high",
      deliveryClass: "immediate",
      cooldownSeconds: 6 * 60 * 60,
      recommendedAction:
        "Ajustar la cantidad disponible o asegurar reposición antes de nuevas ventas.",
    }
  }

  if (alertType === "price_up" || alertType === "margin_risk") {
    const margin = number(facts.estimatedMarginPct)
    const costChange = number(facts.costChangePct)
    const eligible = alertType === "price_up"
      ? facts.hasActiveListing === true && costChange !== null && costChange >= 5
      : facts.hasActiveListing === true && margin !== null && margin < 20
    const critical = margin !== null && margin < 10
    return {
      eligible,
      reason: !eligible
        ? alertType === "price_up"
          ? "active_listing_cost_increase_below_5_or_unconfirmed"
          : "active_listing_margin_risk_not_confirmed"
        : critical
          ? "margin_below_10"
          : "supplier_cost_or_margin_changed",
      priority: critical ? "critical" : "high",
      deliveryClass: "immediate",
      cooldownSeconds: 6 * 60 * 60,
      recommendedAction:
        "Recalcular precio y margen; no modificar eBay sin revisión humana.",
    }
  }

  if (alertType === "mapping_broken") {
    const eligible = facts.hasActiveListing === true
    return {
      eligible,
      reason: eligible
        ? "listing_supplier_mapping_broken"
        : "active_listing_mapping_break_not_confirmed",
      priority: "high",
      deliveryClass: "immediate",
      cooldownSeconds: 12 * 60 * 60,
      recommendedAction:
        "Corregir el vínculo SKU/variante y verificar stock antes de continuar vendiendo.",
    }
  }

  if (alertType === "luna_restock") {
    const previous = number(facts.previousStock)
    const current = number(facts.currentStock)
    const potential = number(facts.potentialScore)
    const confirmedRestock =
      previous !== null && previous <= 0 && current !== null && current >= 4
    const urgent = facts.hasActiveListing === true || (potential !== null && potential >= 70)
    return {
      eligible: confirmedRestock,
      reason: confirmedRestock ? "confirmed_supplier_restock" : "restock_not_material",
      priority: urgent ? "high" : "medium",
      deliveryClass: urgent ? "immediate" : "digest",
      cooldownSeconds: 12 * 60 * 60,
      recommendedAction:
        "Revalidar costo, margen y demanda; reactivar o preparar el draft si sigue siendo rentable.",
    }
  }

  if (alertType === "luna_cost_drop") {
    const costChange = number(facts.costChangePct)
    const drop = costChange === null ? 0 : Math.max(0, -costChange)
    const potential = number(facts.potentialScore)
    const urgent = drop >= 8 && potential !== null && potential >= 60
    return {
      eligible: drop >= 3,
      reason: drop >= 3 ? "supplier_cost_drop_material" : "cost_drop_below_3",
      priority: urgent ? "high" : "medium",
      deliveryClass: urgent ? "immediate" : "digest",
      cooldownSeconds: 24 * 60 * 60,
      recommendedAction:
        "Recalcular el precio ganador y proteger margen antes de autorizar el draft.",
    }
  }

  if (alertType === "draft_failure") {
    return {
      eligible: true,
      reason: facts.terminalFailure === true ? "draft_terminal_failure" : "draft_retry_required",
      priority: facts.terminalFailure === true ? "critical" : "high",
      deliveryClass: "immediate",
      cooldownSeconds: 2 * 60 * 60,
      recommendedAction:
        "Abrir el workspace, revisar el error seguro y reintentar sólo después de corregirlo.",
    }
  }

  const hours = number(facts.hoursUntilExpiration)
  if (hours === null || hours > 24 || hours < 0) {
    return {
      eligible: false,
      reason: "approval_not_expiring_within_24h",
      priority: "medium",
      deliveryClass: "digest",
      cooldownSeconds: 12 * 60 * 60,
      recommendedAction: "Revisar aprobaciones pendientes en el Command Center.",
    }
  }

  const urgent = hours <= 6
  return {
    eligible: true,
    reason: urgent ? "approval_expires_within_6h" : "approval_expires_within_24h",
    priority: urgent ? "high" : "medium",
    deliveryClass: urgent ? "immediate" : "digest",
    cooldownSeconds: 12 * 60 * 60,
    recommendedAction:
      "Revalidar stock, costo y evidencia; aprobar o rechazar antes del vencimiento.",
  }
}

export function nextSellerWhatsAppDigestAt(
  now = new Date(),
  digestHourUtc = 14,
) {
  const hour = Math.max(0, Math.min(23, Math.trunc(digestHourUtc)))
  const due = new Date(now)
  due.setUTCHours(hour, 0, 0, 0)
  if (due.getTime() <= now.getTime()) due.setUTCDate(due.getUTCDate() + 1)
  return due
}

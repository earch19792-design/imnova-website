function toNumber(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null
  }

  const number =
    typeof value === "number"
      ? value
      : Number(value)

  return Number.isFinite(number)
    ? number
    : null
}

function toBoolean(value) {
  return value === true
}

function uniqueStrings(values) {
  return [
    ...new Set(
      values.filter(Boolean)
    ),
  ]
}

function getConfirmedStock(input) {
  return toNumber(
    input?.confirmed_stock ??
      input?.confirmedStock ??
      input?.stock_confirmed ??
      input?.stockConfirmed ??
      input?.inventory_quantity ??
      input?.inventoryQuantity
  )
}

function getPreviousStock(input) {
  const explicitPrevious =
    toNumber(
      input?.previous_confirmed_stock ??
        input?.previousConfirmedStock ??
        input?.previous_inventory_quantity ??
        input?.previousInventoryQuantity
    )

  if (explicitPrevious !== null) {
    return explicitPrevious
  }

  const snapshots =
    Array.isArray(input?.stock_snapshots)
      ? input.stock_snapshots
      : Array.isArray(input?.stockSnapshots)
        ? input.stockSnapshots
        : []

  if (snapshots.length < 2) {
    return null
  }

  return toNumber(
    snapshots[snapshots.length - 2]?.confirmed_stock ??
      snapshots[snapshots.length - 2]?.inventory_quantity ??
      snapshots[snapshots.length - 2]?.quantity
  )
}

function isAvailabilityUnstable(input) {
  const status =
    String(
      input?.supplier_availability ??
        input?.supplierAvailability ??
        input?.availability_status ??
        ""
    ).toLowerCase()

  return Boolean(
    input?.supplier_availability_unstable ||
      input?.supplierAvailabilityUnstable ||
      [
        "unstable",
        "inconsistent",
        "volatile",
        "limited",
      ].includes(status)
  )
}

function hasFrequentRestock(input) {
  const restockFrequency =
    String(
      input?.restock_frequency ??
        input?.restockFrequency ??
        ""
    ).toLowerCase()

  const restockCount =
    toNumber(
      input?.restock_count_30d ??
        input?.restockCount30d
    )

  return Boolean(
    input?.frequent_restock ||
      input?.frequentRestock ||
      [
        "frequent",
        "often",
        "weekly",
      ].includes(restockFrequency) ||
      (
        restockCount !== null &&
        restockCount >= 2
      )
  )
}

function hasHighDemand(input) {
  const demandLevel =
    String(
      input?.demand_level ??
        input?.demandLevel ??
        ""
    ).toLowerCase()

  const soldComparables =
    toNumber(
      input?.sold_comparables_count ??
        input?.soldComparablesCount ??
        input?.comparables_sold_count
    )

  return Boolean(
    input?.high_demand ||
      input?.highDemand ||
      [
        "high",
        "very_high",
      ].includes(demandLevel) ||
      (
        soldComparables !== null &&
        soldComparables >= 10
      )
  )
}

function hasShippingRisk(input) {
  const shippingDays =
    toNumber(
      input?.shipping_days ??
        input?.shippingDays ??
        input?.estimated_shipping_days
    )

  const shippingCost =
    toNumber(
      input?.shipping_cost ??
        input?.shippingCost ??
        input?.estimated_shipping_cost
    )

  return Boolean(
    input?.shipping_slow ||
      input?.shippingSlow ||
      input?.shipping_costly ||
      input?.shippingCostly ||
      (
        shippingDays !== null &&
        shippingDays > 7
      ) ||
      (
        shippingCost !== null &&
        shippingCost >= 15
      )
  )
}

function hasLowMargin(input) {
  const margin =
    toNumber(
      input?.net_margin_percent ??
        input?.netMarginPercent ??
        input?.margin_percent ??
        input?.marginPercent
    )

  return Boolean(
    input?.low_margin ||
      input?.lowMargin ||
      (
        margin !== null &&
        margin < 10
      )
  )
}

function getRiskSignals(input, stock) {
  const previousStock =
    getPreviousStock(input)

  const stockDecreased =
    previousStock !== null &&
    stock !== null &&
    stock < previousStock

  return {
    low_stock:
      stock !== null &&
      stock <= 5,
    stock_decreased:
      stockDecreased,
    supplier_availability_unstable:
      isAvailabilityUnstable(input),
    frequent_restock:
      hasFrequentRestock(input),
    high_demand:
      hasHighDemand(input),
    many_sold_comparables:
      hasHighDemand(input),
    shipping_slow_or_costly:
      hasShippingRisk(input),
    low_margin_with_limited_stock:
      hasLowMargin(input) &&
      stock !== null &&
      stock < 12,
  }
}

function getAccountRiskNotes(signals) {
  const notes = []

  if (signals.low_stock) {
    notes.push(
      "Stock confirmado bajo; evitar comprometer inventario que no puede sostener rotacion."
    )
  }

  if (signals.stock_decreased) {
    notes.push(
      "El stock disminuyo entre snapshots; confirmar disponibilidad antes de listar."
    )
  }

  if (signals.supplier_availability_unstable) {
    notes.push(
      "Proveedor con disponibilidad inestable; mantener decisiones read-only hasta nueva confirmacion."
    )
  }

  if (signals.frequent_restock) {
    notes.push(
      "Restock frecuente detectado; la disponibilidad puede cambiar antes de completar venta."
    )
  }

  if (signals.high_demand) {
    notes.push(
      "Demanda alta con stock limitado puede agotar inventario antes de fulfillment."
    )
  }

  if (signals.shipping_slow_or_costly) {
    notes.push(
      "Shipping lento o costoso aumenta riesgo operativo antes de escalar."
    )
  }

  if (signals.low_margin_with_limited_stock) {
    notes.push(
      "Margen bajo con stock limitado no deja suficiente buffer operativo."
    )
  }

  return notes
}

function packDataIsComplete(input) {
  return Boolean(
    toBoolean(
      input?.margin_passed ??
        input?.marginPassed
    ) &&
      toBoolean(
        input?.weight_passed ??
          input?.weightPassed
      ) &&
      toBoolean(
        input?.comparables_passed ??
          input?.comparablesPassed
      ) &&
      toBoolean(
        input?.shipping_passed ??
          input?.shippingPassed
      )
  )
}

function readinessPassed(input) {
  return toBoolean(
    input?.readiness_passed ??
      input?.readinessPassed
  )
}

export function evaluateStockRotationRisk(input = {}) {
  const stock =
    getConfirmedStock(input)

  const signals =
    getRiskSignals(input, stock)

  const signalCount =
    Object.values(signals)
      .filter(Boolean)
      .length

  let stockRiskLevel = "medium"
  let stockDecision = "limited_organic_test"
  let nextSafeStep =
    "Confirmar stock, observar rotacion organica y revisar antes de escalar."
  const blockedActions = []
  const allowedActions = []

  if (stock === null || stock <= 0) {
    stockRiskLevel = "critical"
    stockDecision = "do_not_publish"
    blockedActions.push(
      "publish_listing",
      "pack_review",
      "campaign"
    )
    nextSafeStep =
      "Confirmar stock real antes de preparar listing, pack o campana."
  } else if (stock === 1) {
    stockRiskLevel = "critical"
    stockDecision = "do_not_publish"
    blockedActions.push(
      "publish_listing",
      "pack_review",
      "campaign"
    )
    nextSafeStep =
      "Monitorear stock o buscar proveedor alternativo antes de publicar."
  } else if (stock <= 3) {
    stockRiskLevel = "high"
    stockDecision = "limited_organic_test"
    blockedActions.push(
      "pack_review",
      "campaign"
    )
    allowedActions.push(
      "limited_organic_listing_max_quantity_1"
    )
    nextSafeStep =
      "Solo prueba organica limitada con aprobacion humana y cantidad maxima 1."
  } else if (stock <= 5) {
    stockRiskLevel = "medium"
    stockDecision = "limited_organic_test"
    blockedActions.push(
      "campaign",
      "large_pack_review"
    )
    allowedActions.push(
      "limited_organic_test"
    )
    nextSafeStep =
      "Ejecutar prueba organica limitada y revisar rotacion antes de escalar."
  } else if (stock < 12) {
    stockRiskLevel =
      signalCount >= 2
        ? "medium"
        : "low"
    stockDecision =
      readinessPassed(input)
        ? "eligible_for_listing_prep"
        : "limited_organic_test"
    blockedActions.push(
      "scale_without_observation"
    )
    allowedActions.push(
      readinessPassed(input)
        ? "organic_listing_prep"
        : "limited_organic_test"
    )
    nextSafeStep =
      "Evaluar listing organico si readiness pasa; observar rotacion antes de escalar."
  } else {
    const packReady =
      packDataIsComplete(input)

    stockRiskLevel =
      signalCount >= 2
        ? "medium"
        : "low"
    stockDecision =
      packReady
        ? "eligible_for_pack_review"
        : "eligible_for_listing_prep"
    allowedActions.push(
      packReady
        ? "pack_review"
        : "listing_prep"
    )

    if (!packReady) {
      blockedActions.push(
        "pack_review_until_margin_weight_comparables_shipping_pass"
      )
    }

    nextSafeStep =
      packReady
        ? "Revisar pack con margen, peso, comparables y shipping ya validados."
        : "Completar margen, peso, comparables y shipping antes de evaluar pack."
  }

  if (
    stock !== null &&
    stock < 6 &&
    !blockedActions.includes("campaign")
  ) {
    blockedActions.push(
      "campaign"
    )
  }

  return {
    stock_risk_level:
      stockRiskLevel,
    stock_decision:
      stockDecision,
    account_risk_notes:
      getAccountRiskNotes(signals),
    blocked_actions:
      uniqueStrings(blockedActions),
    allowed_actions:
      uniqueStrings(allowedActions),
    next_safe_step:
      nextSafeStep,
    human_approval_required:
      true,
  }
}

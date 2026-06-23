function toNumber(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null
  }

  const numericValue =
    typeof value === "number"
      ? value
      : Number(value)

  return Number.isFinite(numericValue)
    ? numericValue
    : null
}

function getString(value) {
  return typeof value === "string"
    ? value.trim()
    : ""
}

function getCandidateState(candidate) {
  return String(
    candidate?.state || ""
  ).toUpperCase()
}

function getInventoryAliasValue(source) {
  return (
    source?.inventory_quantity ??
    source?.inventoryQuantity ??
    source?.available_quantity ??
    source?.availableQuantity ??
    source?.quantity ??
    source?.qty ??
    source?.stock ??
    source?.inventory ??
    null
  )
}

export function getNormalizedInventoryContext(
  value = {}
) {
  if (value?.stock_context) {
    return {
      inventory_quantity:
        value.stock_context.inventory_quantity ?? null,
      inventory_status:
        value.stock_context.inventory_status || "unknown",
      inventory_source:
        value.stock_context.inventory_source || "not_exposed",
      inventory_confidence:
        value.stock_context.inventory_confidence || "low",
      stock_message:
        value.stock_context.stock_message ||
        "Cantidad no disponible. Validar manualmente antes de listar.",
    }
  }

  const numericQuantity =
    toNumber(
      getInventoryAliasValue(value)
    )

  if (numericQuantity !== null) {
    const inventoryQuantity =
      Math.trunc(numericQuantity)

    return {
      inventory_quantity:
        inventoryQuantity,
      inventory_status:
        inventoryQuantity > 0
          ? "in_stock"
          : "out_of_stock",
      inventory_source:
        "luna_numeric",
      inventory_confidence:
        "high",
      stock_message:
        inventoryQuantity > 0
          ? `Stock disponible: ${inventoryQuantity.toLocaleString("en-US")} unidades.`
          : "Producto sin stock. No listar o revisar pausa si ya está en eBay.",
    }
  }

  if (value?.available === false) {
    return {
      inventory_quantity:
        0,
      inventory_status:
        "out_of_stock",
      inventory_source:
        "luna_availability",
      inventory_confidence:
        "medium",
      stock_message:
        "Producto sin stock. No listar o revisar pausa si ya está en eBay.",
    }
  }

  if (value?.available === true) {
    return {
      inventory_quantity:
        null,
      inventory_status:
        "in_stock",
      inventory_source:
        "luna_availability",
      inventory_confidence:
        "medium",
      stock_message:
        "Producto disponible, pero Luna no expone cantidad numérica.",
    }
  }

  return {
    inventory_quantity:
      null,
    inventory_status:
      "unknown",
    inventory_source:
      "not_exposed",
    inventory_confidence:
      "low",
    stock_message:
      "Cantidad no disponible. Validar manualmente antes de listar.",
  }
}

function getEventInventoryContext(
  event,
  product
) {
  return getNormalizedInventoryContext({
    ...product,
    ...(event?.new_value || {}),
    stock_context:
      event?.new_value?.stock_context ||
      product?.stock_context ||
      null,
  })
}

function hasConsumableSignal(
  product,
  candidate
) {
  const text = [
    product?.title,
    product?.product_type,
    ...(Array.isArray(product?.tags)
      ? product.tags
      : []),
    candidate?.title,
    candidate?.product_type,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()

  return [
    "coffee",
    "cafe",
    "vitamin",
    "supplement",
    "protein",
    "nutrition",
    "food",
    "drink",
    "pack",
    "consumable",
  ].some(signal =>
    text.includes(signal)
  )
}

function getBaseAdvisorRule(
  eventType
) {
  switch (eventType) {
    case "new_product":
      return {
        severity:
          "low",
        business_signal:
          "new_supplier_product",
        advisor_message:
          "Nuevo producto detectado en Luna. Evaluar si tiene stock, margen y mercado eBay.",
        recommended_action:
          "process_candidate",
        proposed_next_step:
          "Analizar Price Intelligence y rentabilidad antes de decidir.",
        automation_level:
          0,
      }
    case "price_down":
      return {
        severity:
          "medium",
        business_signal:
          "cost_improved",
        advisor_message:
          "El costo/precio bajó. Puede mejorar margen. Recomiendo recalcular rentabilidad y revisar oportunidad.",
        recommended_action:
          "reprocess_with_updated_cost",
        proposed_next_step:
          "Reprocesar candidato con el costo actualizado.",
        automation_level:
          0,
      }
    case "price_up":
      return {
        severity:
          "high",
        business_signal:
          "cost_risk",
        advisor_message:
          "El costo/precio subió. Puede afectar margen. Si está listado, revisar precio o pausar campaña.",
        recommended_action:
          "recalculate_margin",
        proposed_next_step:
          "Recalcular margen antes de publicar o mantener una campaña.",
        automation_level:
          0,
      }
    case "low_stock":
      return {
        severity:
          "high",
        business_signal:
          "inventory_risk",
        advisor_message:
          "El producto se está quedando sin stock. Si está listado, reducir cantidad disponible o pausar para evitar cancelaciones.",
        recommended_action:
          "prepare_pause_or_reduce_quantity",
        proposed_next_step:
          "Revisar inventario antes de vender y preparar ajuste manual.",
        automation_level:
          1,
      }
    case "out_of_stock":
      return {
        severity:
          "high",
        business_signal:
          "supplier_out_of_stock",
        advisor_message:
          "Producto sin stock en Luna. No listar. Si está publicado en eBay, preparar pausa del listing.",
        recommended_action:
          "prepare_pause_listing",
        proposed_next_step:
          "Bloquear publicación nueva y preparar pausa manual si existe listing.",
        automation_level:
          1,
      }
    case "restocked":
      return {
        severity:
          "medium",
        business_signal:
          "inventory_recovered",
        advisor_message:
          "Producto volvió a tener stock. Si antes estaba bloqueado por disponibilidad, recomiendo reanalizar.",
        recommended_action:
          "resurface_for_reanalysis",
        proposed_next_step:
          "Reanalizar margen, stock y demanda antes de avanzar.",
        automation_level:
          0,
      }
    case "discount_started":
      return {
        severity:
          "medium",
        business_signal:
          "supplier_discount_started",
        advisor_message:
          "Nuevo descuento detectado. Puede ser oportunidad para margen o liquidación. Validar demanda en Terapeak/eBay Research.",
        recommended_action:
          "recalculate_profit",
        proposed_next_step:
          "Recalcular profit y validar mercado antes de listar.",
        automation_level:
          0,
      }
    case "discount_ended":
      return {
        severity:
          "high",
        business_signal:
          "supplier_discount_ended",
        advisor_message:
          "El descuento terminó. Revisar si el margen sigue siendo viable.",
        recommended_action:
          "recalculate_profit",
        proposed_next_step:
          "Recalcular rentabilidad con el costo actual.",
        automation_level:
          0,
      }
    case "stock_increased":
      return {
        severity:
          "medium",
        business_signal:
          "inventory_upside",
        advisor_message:
          "Stock aumentó. Si el producto tiene buen margen, puede ser candidato a escalar o evaluar pack.",
        recommended_action:
          "evaluate_pack_strategy",
        proposed_next_step:
          "Evaluar estrategia de pack si el producto es consumible.",
        automation_level:
          0,
      }
    case "stock_decreased_fast":
      return {
        severity:
          "high",
        business_signal:
          "inventory_velocity_risk",
        advisor_message:
          "El stock está bajando rápido. Revisar si hay demanda alta o riesgo de quedarse sin inventario.",
        recommended_action:
          "monitor_inventory",
        proposed_next_step:
          "Monitorear inventario y reducir cantidad listada si aplica.",
        automation_level:
          1,
      }
    default:
      return null
  }
}

export function getRadarAdvisorEvent(
  event,
  product = null,
  candidate = null
) {
  const eventType =
    String(event?.event_type || "")

  const baseRule =
    getBaseAdvisorRule(eventType)

  if (!baseRule) {
    return null
  }

  const candidateState =
    getCandidateState(candidate)

  const alert = {
    event_type:
      eventType,
    product_id:
      event?.product_id ||
      product?.product_id ||
      null,
    product_title:
      product?.title ||
      event?.product?.title ||
      candidate?.title ||
      "Producto sin titulo",
    supplier_sku:
      event?.supplier_variant_id ||
      product?.sku ||
      candidate?.supplier_sku ||
      null,
    previous_value:
      event?.old_value || null,
    current_value:
      event?.new_value || null,
    severity:
      baseRule.severity,
    business_signal:
      baseRule.business_signal,
    advisor_message:
      baseRule.advisor_message,
    recommended_action:
      baseRule.recommended_action,
    automation_available:
      baseRule.automation_level > 0,
    automation_level:
      baseRule.automation_level,
    required_human_approval:
      baseRule.automation_level > 0,
    proposed_next_step:
      baseRule.proposed_next_step,
    candidate_state:
      candidateState || null,
    candidate_id:
      candidate?.id || null,
    created_at:
      event?.created_at || null,
    stock_context:
      getEventInventoryContext(
        event,
        product
      ),
  }

  if (
    alert.stock_context.inventory_status === "unknown"
  ) {
    alert.required_human_approval =
      true
  }

  if (
    eventType === "low_stock" &&
    alert.stock_context.inventory_source !== "luna_numeric"
  ) {
    return null
  }

  if (
    candidateState === "BLOCKED" &&
    (
      eventType === "restocked" ||
      eventType === "price_down"
    )
  ) {
    return {
      ...alert,
      severity:
        "medium",
      recommended_action:
        "resurface_for_reanalysis",
      proposed_next_step:
        "Volver a poner el producto en cola de análisis porque cambió la condición que podía bloquearlo.",
    }
  }

  if (
    candidateState === "VALIDATED" &&
    eventType === "price_up"
  ) {
    return {
      ...alert,
      severity:
        "high",
      recommended_action:
        "recalculate_before_listing",
      proposed_next_step:
        "Recalcular margen antes de crear o avanzar el listing.",
    }
  }

  if (
    candidateState === "DRAFT_CREATED" &&
    eventType === "out_of_stock"
  ) {
    return {
      ...alert,
      severity:
        "critical",
      recommended_action:
        "review_existing_draft_inventory",
      required_human_approval:
        true,
      proposed_next_step:
        "Revisar el draft existente y preparar pausa o reducción de cantidad sin ejecutar eBay real.",
    }
  }

  if (
    (
      eventType === "low_stock" ||
      eventType === "out_of_stock"
    ) &&
    candidateState === "LISTED"
  ) {
    return {
      ...alert,
      severity:
        "critical",
      recommended_action:
        "prepare_pause_or_reduce_quantity",
      required_human_approval:
        true,
      automation_available:
        true,
      automation_level:
        1,
      proposed_next_step:
        "Preparar pausa o reducción de cantidad. No ejecutar cambios reales sin aprobación.",
    }
  }

  if (
    eventType === "discount_started" &&
    hasConsumableSignal(
      product,
      candidate
    ) &&
    alert.stock_context.inventory_source === "luna_numeric" &&
    (alert.stock_context.inventory_quantity || 0) >= 6
  ) {
    return {
      ...alert,
      recommended_action:
        "evaluate_pack_strategy",
      proposed_next_step:
        "Recalcular profit y evaluar pack si la demanda acompaña.",
    }
  }

  const inventoryQuantity =
    alert.stock_context.inventory_quantity

  if (
    eventType === "low_stock" &&
    inventoryQuantity !== null &&
    inventoryQuantity <= 3
  ) {
    return {
      ...alert,
      severity:
        "critical",
    }
  }

  return alert
}

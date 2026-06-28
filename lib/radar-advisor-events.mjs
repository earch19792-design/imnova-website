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

function getSellerRiskSearchText(
  product = null,
  candidate = null
) {
  return [
    product?.title,
    product?.product_type,
    ...(Array.isArray(product?.tags)
      ? product.tags
      : []),
    candidate?.title,
    candidate?.product_type,
    ...(Array.isArray(candidate?.tags)
      ? candidate.tags
      : []),
  ]
    .map(value =>
      typeof value === "string"
        ? value.toLowerCase()
        : ""
    )
    .filter(Boolean)
    .join(" ")
}

function getRadarSellerRiskSignal(
  product = null,
  candidate = null
) {
  const searchText =
    getSellerRiskSearchText(
      product,
      candidate
    )

  if (!searchText) {
    return null
  }

  if (
    /\b(spray|aerosol|paint|rust-oleum|striping)\b/.test(
      searchText
    )
  ) {
    return {
      seller_risk_label:
        "Shipping restringido",
      seller_risk_summary:
        "Validar restricciones de envio por aerosol, pintura o producto regulado antes de listar.",
      seller_risk_severity:
        "high",
    }
  }

  if (
    /\b(nintendo|switch|super mario|powera|bluetooth headphones)\b/.test(
      searchText
    )
  ) {
    return {
      seller_risk_label:
        "Marca / compatibilidad",
      seller_risk_summary:
        "Validar marca, UPC y compatibilidad.",
      seller_risk_severity:
        "medium",
    }
  }

  if (
    /\b(supplement|ginseng|herbal|vitamin|nutrition|moisturizer|deodorant|suppositor|skin|odor control)\b/.test(
      searchText
    )
  ) {
    return {
      seller_risk_label:
        "Compliance / claims",
      seller_risk_summary:
        "Validar claims, ingredientes y restricciones eBay.",
      seller_risk_severity:
        "high",
    }
  }

  return null
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
    const stockContextProductQuantity =
      toNumber(
        value.stock_context.product_available_quantity
      )

    if (
      value.stock_context.inventory_source ===
        "luna_authenticated_html" &&
      Number.isFinite(
        value.stock_context.inventory_quantity
      ) &&
      value.stock_context.inventory_quantity >= 10000
    ) {
      const signalQuantity =
        Math.trunc(
          value.stock_context.inventory_quantity
        )

      return {
        inventory_quantity:
          null,
        product_available_quantity:
          signalQuantity,
        inventory_status:
          "in_stock",
        inventory_source:
          "luna_authenticated_html",
        inventory_confidence:
          "low",
        inventory_scope:
          "product_or_category_signal",
        stock_message:
          `Luna muestra ${signalQuantity.toLocaleString("en-US")} unidades como señal general de disponibilidad. No se considera stock confirmado por variante.`,
      }
    }

    if (
      (
        value.stock_context.inventory_scope ===
          "product_or_category_signal" ||
        (
          stockContextProductQuantity !== null &&
          stockContextProductQuantity >= 10000
        )
      ) &&
      stockContextProductQuantity !== null
    ) {
      const signalQuantity =
        Math.trunc(stockContextProductQuantity)

      return {
        inventory_quantity:
          null,
        product_available_quantity:
          signalQuantity,
        inventory_status:
          signalQuantity > 0
            ? "in_stock"
            : "out_of_stock",
        inventory_source:
          "luna_authenticated_html",
        inventory_confidence:
          "low",
        inventory_scope:
          "product_or_category_signal",
        stock_message:
          `Luna muestra ${signalQuantity.toLocaleString("en-US")} unidades como señal general de disponibilidad. No se considera stock confirmado por variante.`,
      }
    }

    return {
      inventory_quantity:
        value.stock_context.inventory_quantity ?? null,
      product_available_quantity:
        value.stock_context.product_available_quantity ?? null,
      inventory_status:
        value.stock_context.inventory_status || "unknown",
      inventory_source:
        value.stock_context.inventory_source || "not_exposed",
      inventory_confidence:
        value.stock_context.inventory_confidence || "low",
      inventory_scope:
        value.stock_context.inventory_scope || "unknown",
      stock_message:
        value.stock_context.stock_message ||
        "Cantidad no disponible. Validar manualmente antes de listar.",
    }
  }

  const numericQuantity =
    toNumber(
      getInventoryAliasValue(value)
    )

  if (
    numericQuantity !== null &&
    value?.inventory_source === "luna_authenticated_html" &&
    numericQuantity >= 10000
  ) {
    const signalQuantity =
      Math.trunc(numericQuantity)

    return {
      inventory_quantity:
        null,
      product_available_quantity:
        signalQuantity,
      inventory_status:
        "in_stock",
      inventory_source:
        "luna_authenticated_html",
      inventory_confidence:
        "low",
      inventory_scope:
        "product_or_category_signal",
      stock_message:
        `Luna muestra ${signalQuantity.toLocaleString("en-US")} unidades como señal general de disponibilidad. No se considera stock confirmado por variante.`,
    }
  }

  if (numericQuantity !== null) {
    const inventoryQuantity =
      Math.trunc(numericQuantity)

    return {
      inventory_quantity:
        inventoryQuantity,
      product_available_quantity:
        toNumber(
          value?.product_available_quantity
        ),
      inventory_status:
        inventoryQuantity > 0
          ? "in_stock"
          : "out_of_stock",
      inventory_source:
        value?.inventory_source ===
          "luna_authenticated_html"
          ? "luna_authenticated_html"
          : "luna_numeric",
      inventory_confidence:
        "high",
      inventory_scope:
        "variant_level",
      stock_message:
        inventoryQuantity > 0
          ? `Stock disponible: ${inventoryQuantity.toLocaleString("en-US")} unidades.`
          : "Producto sin stock. No listar o revisar pausa si ya está en eBay.",
    }
  }

  const productAvailableQuantity =
    toNumber(
      value?.product_available_quantity
    )

  if (
    (
      value?.inventory_scope === "product_or_category_signal" ||
      (
        productAvailableQuantity !== null &&
        productAvailableQuantity >= 10000
      )
    ) &&
    productAvailableQuantity !== null
  ) {
    const signalQuantity =
      Math.trunc(productAvailableQuantity)

    return {
      inventory_quantity:
        null,
      product_available_quantity:
        signalQuantity,
      inventory_status:
        signalQuantity > 0
          ? "in_stock"
          : "out_of_stock",
      inventory_source:
        "luna_authenticated_html",
      inventory_confidence:
        "low",
      inventory_scope:
        "product_or_category_signal",
      stock_message:
        `Luna muestra ${signalQuantity.toLocaleString("en-US")} unidades como señal general de disponibilidad. No se considera stock confirmado por variante.`,
    }
  }

  if (
    value?.inventory_scope === "product_level" &&
    productAvailableQuantity !== null
  ) {
    const productQuantity =
      Math.trunc(productAvailableQuantity)

    return {
      inventory_quantity:
        null,
      product_available_quantity:
        productQuantity,
      inventory_status:
        productQuantity > 0
          ? "in_stock"
          : "out_of_stock",
      inventory_source:
        "luna_authenticated_html_product",
      inventory_confidence:
        "medium",
      inventory_scope:
        "product_level",
      stock_message:
        `Luna muestra ${productQuantity.toLocaleString("en-US")} unidades disponibles a nivel producto. Este producto tiene varias variantes; validar cantidad por variante antes de listar o escalar.`,
    }
  }

  if (value?.available === false) {
    return {
      inventory_quantity:
        0,
      product_available_quantity:
        null,
      inventory_status:
        "out_of_stock",
      inventory_source:
        "luna_availability",
      inventory_confidence:
        "medium",
      inventory_scope:
        "availability_only",
      stock_message:
        "Producto sin stock. No listar o revisar pausa si ya está en eBay.",
    }
  }

  if (value?.available === true) {
    return {
      inventory_quantity:
        null,
      product_available_quantity:
        null,
      inventory_status:
        "in_stock",
      inventory_source:
        "luna_availability",
      inventory_confidence:
        "medium",
      inventory_scope:
        "availability_only",
      stock_message:
        "Disponible, pero Luna no expone cantidad numérica.",
    }
  }

  return {
    inventory_quantity:
      null,
    product_available_quantity:
      null,
    inventory_status:
      "unknown",
    inventory_source:
      "not_exposed",
    inventory_confidence:
      "low",
    inventory_scope:
      "unknown",
    stock_message:
      "Cantidad no disponible. Validar manualmente antes de listar.",
  }
}

function getEventInventoryContext(
  event,
  product
) {
  const eventStockContext =
    event?.new_value?.stock_context || null

  if (
    product &&
    eventStockContext &&
    (
      eventStockContext.inventory_scope ===
        "availability_only" ||
      eventStockContext.inventory_source ===
        "luna_availability"
    )
  ) {
    const productInventoryContext =
      getNormalizedInventoryContext(
        product
      )

    if (
      productInventoryContext.inventory_scope === "variant_level" ||
      productInventoryContext.inventory_scope ===
        "product_or_category_signal" ||
      productInventoryContext.inventory_scope === "product_level"
    ) {
      return productInventoryContext
    }
  }

  return getNormalizedInventoryContext({
    ...product,
    ...(event?.new_value || {}),
    stock_context:
      event?.new_value?.stock_context ||
      product?.stock_context ||
      null,
  })
}

function hasConfirmedVariantInventory(
  stockContext
) {
  return (
    stockContext?.inventory_scope === "variant_level" &&
    (
      stockContext.inventory_source === "luna_numeric" ||
      stockContext.inventory_source === "luna_authenticated_html"
    ) &&
    Number.isFinite(
      stockContext.inventory_quantity
    )
  )
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
          "Nuevo en Luna.",
        recommended_action:
          "process_candidate",
        proposed_next_step:
          "Buscar SKU. Validar stock, margen y mercado eBay.",
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

function getRadarCommercialPlaybook(
  eventType,
  product = null
) {
  const baseGuardrail =
    "Advisory-only: no publica, no crea drafts, no modifica listings y no cambia estados."

  if (product?.is_active === false) {
    return {
      label:
        "Fuera de catalogo",
      recommendation:
        "Bloquear avance. No listar. Evaluar proveedor alternativo si el producto sigue siendo atractivo.",
      next_step:
        "Confirmar si Luna vuelve a mostrar el producto antes de cualquier avance operativo.",
      risk_level:
        "critical",
      guardrail:
        baseGuardrail,
      advisory_only:
        true,
    }
  }

  switch (eventType) {
    case "price_down":
      return {
        label:
          "Bajo precio",
        recommendation:
          "Recalcular margen. Si el margen vuelve a ser viable, reabrir oportunidad para revision.",
        next_step:
          "Actualizar costo/precio y revisar si el candidato vuelve a cumplir los minimos.",
        risk_level:
          "medium",
        guardrail:
          baseGuardrail,
        advisory_only:
          true,
      }
    case "price_up":
      return {
        label:
          "Subio precio",
        recommendation:
          "Revisar margen antes de escalar. No avanzar si el margen minimo ya no se cumple.",
        next_step:
          "Recalcular rentabilidad con el costo actual antes de listar, escalar o promocionar.",
        risk_level:
          "high",
        guardrail:
          baseGuardrail,
        advisory_only:
          true,
      }
    case "out_of_stock":
      return {
        label:
          "Sin stock",
        recommendation:
          "No listar, no crear pack y no activar campana hasta confirmar disponibilidad.",
        next_step:
          "Esperar reposicion o confirmar inventario real antes de cualquier preparacion comercial.",
        risk_level:
          "critical",
        guardrail:
          baseGuardrail,
        advisory_only:
          true,
      }
    case "restocked":
      return {
        label:
          "Volvio a stock",
        recommendation:
          "Confirmar cantidad disponible y reanalizar margen, peso, dimensiones y comparables.",
        next_step:
          "Validar stock por variante antes de volver a preparar el listing.",
        risk_level:
          "medium",
        guardrail:
          baseGuardrail,
        advisory_only:
          true,
      }
    case "stock_increased":
      return {
        label:
          "Rotacion o disponibilidad al alza",
        recommendation:
          "Priorizar revision. Validar stock, margen y competencia antes de preparar listing.",
        next_step:
          "Revisar si el cambio indica mayor oportunidad sin asumir publicacion automatica.",
        risk_level:
          "medium",
        guardrail:
          baseGuardrail,
        advisory_only:
          true,
      }
    case "discount_started":
      return {
        label:
          "Descuento iniciado",
        recommendation:
          "Evaluar margen actualizado y riesgo de liquidacion. No asumir que descuento significa oportunidad automatica.",
        next_step:
          "Recalcular profit y validar demanda antes de tratarlo como oportunidad.",
        risk_level:
          "medium",
        guardrail:
          baseGuardrail,
        advisory_only:
          true,
      }
    default:
      return null
  }
}

function deriveRadarEventIntelligence({
  eventType,
  alert,
  product = null,
}) {
  const stockContext =
    alert.stock_context || {}
  const hasAvailableStock =
    stockContext.inventory_status === "in_stock" &&
    (
      stockContext.inventory_quantity !== null ||
      stockContext.inventory_source === "luna_numeric" ||
      stockContext.inventory_source ===
        "luna_authenticated_html"
    )
  const hasAmbiguousStock =
    stockContext.inventory_status === "unknown" ||
    stockContext.inventory_source === "luna_availability" ||
    stockContext.inventory_scope === "product_level" ||
    stockContext.inventory_scope ===
      "product_or_category_signal" ||
    stockContext.inventory_scope === "availability_only"
  const stockOutCount =
    toNumber(product?.out_of_stock_count_7d) ||
    toNumber(product?.stock_out_count_7d) ||
    toNumber(product?.stockouts_7d) ||
    0

  if (
    eventType === "price_down" &&
    hasAvailableStock
  ) {
    return {
      event_intelligence_label:
        "Oportunidad de revision",
      event_intelligence_summary:
        "Precio bajo con stock disponible: revisar margen y demanda antes de decidir.",
      event_intelligence_severity:
        "medium",
      event_intelligence_advisory_only:
        true,
    }
  }

  if (
    eventType === "restocked" &&
    hasAvailableStock
  ) {
    return {
      event_intelligence_label:
        "Stock recuperado",
      event_intelligence_summary:
        "Volvio stock disponible: posible oportunidad de reanalisis sin ejecutar acciones reales.",
      event_intelligence_severity:
        "medium",
      event_intelligence_advisory_only:
        true,
    }
  }

  if (
    eventType === "out_of_stock" ||
    stockOutCount > 1
  ) {
    return {
      event_intelligence_label:
        "Riesgo de inventario",
      event_intelligence_summary:
        "Stock agotado o recurrente: revisar disponibilidad antes de listar, pausar o escalar.",
      event_intelligence_severity:
        "critical",
      event_intelligence_advisory_only:
        true,
    }
  }

  if (hasAmbiguousStock) {
    return {
      event_intelligence_label:
        "Validacion manual",
      event_intelligence_summary:
        "Confirmar stock real por SKU/parte.",
      event_intelligence_severity:
        "high",
      event_intelligence_advisory_only:
        true,
    }
  }

  if (
    alert.severity === "critical" ||
    alert.severity === "high"
  ) {
    return {
      event_intelligence_label:
        "Prioridad de revision",
      event_intelligence_summary:
        "Evento critico o severo reciente: revisar contexto antes de avanzar.",
      event_intelligence_severity:
        alert.severity,
      event_intelligence_advisory_only:
        true,
    }
  }

  return {
    event_intelligence_label:
      "Evento monitoreado",
    event_intelligence_summary:
      "Monitoreado.",
    event_intelligence_severity:
      "low",
    event_intelligence_advisory_only:
      true,
  }
}

function deriveRadarAdvisorReviewQueue({
  eventType,
  alert,
}) {
  const candidateState =
    String(alert.candidate_state || "")
      .toUpperCase()
  const stockContext =
    alert.stock_context || {}
  const hasConfirmedStock =
    hasConfirmedVariantInventory(
      stockContext
    )
  const hasAmbiguousStock =
    stockContext.inventory_status === "unknown" ||
    stockContext.inventory_source === "luna_availability" ||
    stockContext.inventory_scope === "product_level" ||
    stockContext.inventory_scope ===
      "product_or_category_signal" ||
    stockContext.inventory_scope === "availability_only"

  if (
    eventType === "out_of_stock" &&
    (
      candidateState === "LISTED" ||
      candidateState === "DRAFT_CREATED"
    )
  ) {
    return {
      seller_action_label:
        "No listar",
      seller_priority:
        "Urgente",
      seller_reason:
        "Sin stock",
      seller_next_step:
        "Buscar SKU en Radar o confirmar stock manual.",
    }
  }

  if (
    eventType === "low_stock" ||
    eventType === "stock_decreased_fast"
  ) {
    return {
      seller_action_label:
        "Validar stock",
      seller_priority:
        "Alta",
      seller_reason:
        "Stock bajo o bajando rapido",
      seller_next_step:
        "Confirmar stock manual.",
    }
  }

  if (
    eventType === "restocked" &&
    candidateState === "BLOCKED"
  ) {
    return {
      seller_action_label:
        "Reanalizar candidato",
      seller_priority:
        "Alta",
      seller_reason:
        "Producto volvio a stock",
      seller_next_step:
        "Abrir en Pipeline.",
    }
  }

  if (
    eventType === "price_up" &&
    (
      candidateState === "VALIDATED" ||
      candidateState === "DRAFT_CREATED"
    )
  ) {
    return {
      seller_action_label:
        "Recalcular margen",
      seller_priority:
        "Alta",
      seller_reason:
        "Precio subio",
      seller_next_step:
        "Revisar margen.",
    }
  }

  if (
    eventType === "price_down" &&
    hasConfirmedStock
  ) {
    return {
      seller_action_label:
        "Revisar oportunidad",
      seller_priority:
        "Media",
      seller_reason:
        "Bajo costo con stock disponible",
      seller_next_step:
        "Buscar SKU en Radar.",
    }
  }

  if (hasAmbiguousStock) {
    return {
      seller_action_label:
        "Validar stock",
      seller_priority:
        "Alta",
      seller_reason:
        "Stock no confirmado",
      seller_next_step:
        "Confirmar stock manual.",
    }
  }

  if (alert.seller_risk_label) {
    return {
      seller_action_label:
        "Revisar riesgo eBay",
      seller_priority:
        alert.seller_risk_severity === "high" ||
        alert.seller_risk_severity === "critical"
          ? "Alta"
          : "Media",
      seller_reason:
        "Riesgo de compliance, marca o envio",
      seller_next_step:
        candidateState === "BLOCKED"
          ? "Mantener bloqueado y revisar riesgo."
          : "Revisar riesgo antes de avanzar.",
    }
  }

  return {
    seller_action_label:
      "Revisar alerta",
    seller_priority:
      "Baja",
    seller_reason:
      "Evento monitoreado",
    seller_next_step:
      "Buscar SKU en Radar.",
  }
}

function withRadarAdvisorReviewQueue(
  alert
) {
  return {
    ...alert,
    ...deriveRadarAdvisorReviewQueue({
      eventType:
        alert.event_type,
      alert,
    }),
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
    supplier_variant_id:
      event?.supplier_variant_id ||
      product?.supplier_variant_id ||
      candidate?.supplier_variant_id ||
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
    commercial_playbook:
      getRadarCommercialPlaybook(
        eventType,
        product
      ),
  }

  Object.assign(
    alert,
    getRadarSellerRiskSignal(
      product,
      candidate
    ) || {}
  )

  Object.assign(
    alert,
    deriveRadarEventIntelligence({
      eventType,
      alert,
      product,
    })
  )

  if (
    alert.stock_context.inventory_status === "unknown" ||
    alert.stock_context.inventory_source === "luna_availability" ||
    (
      alert.stock_context.inventory_scope === "product_level" ||
      alert.stock_context.inventory_scope ===
        "product_or_category_signal"
    )
  ) {
    alert.required_human_approval =
      true
    alert.severity =
      "high"
    alert.recommended_action =
      "validate_stock_before_review"
    alert.advisor_message =
      "Stock no confirmado."
    alert.proposed_next_step =
      "Buscar SKU. Confirmar cantidad antes de analizar o listar."
  }

  if (
    alert.stock_context.inventory_scope ===
      "product_or_category_signal"
  ) {
    alert.advisor_message =
      "Disponibilidad general; falta variante."
    alert.proposed_next_step =
      "Buscar SKU. Confirmar variante antes de listar o escalar."
  }

  if (
    alert.stock_context.inventory_scope === "product_level"
  ) {
    const productQuantity =
      alert.stock_context.product_available_quantity
    const quantityLabel =
      Number.isFinite(productQuantity)
        ? productQuantity.toLocaleString("en-US")
        : "cantidad"

    alert.advisor_message =
      `${quantityLabel} unidades a nivel producto; falta variante.`
    alert.proposed_next_step =
      "Buscar SKU. Validar variante antes de listar."
  }

  if (
    alert.stock_context.inventory_source === "luna_availability" &&
    alert.stock_context.inventory_status === "in_stock"
  ) {
    alert.advisor_message =
      "Disponible sin cantidad numerica."
    alert.proposed_next_step =
      "Buscar SKU. Confirmar cantidad antes de listar o escalar."
  }

  if (
    candidateState === "BLOCKED" &&
    (
      alert.recommended_action ===
        "validate_stock_before_review" ||
      alert.stock_context.inventory_source ===
        "luna_availability"
    )
  ) {
    alert.recommended_action =
      "keep_blocked_until_stock_confirmed"
    alert.proposed_next_step =
      "Mantener bloqueado. Confirmar stock antes de reabrir."
  }

  if (
    eventType === "low_stock" &&
    !hasConfirmedVariantInventory(
      alert.stock_context
    )
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
    return withRadarAdvisorReviewQueue({
      ...alert,
      severity:
        "medium",
      recommended_action:
        "resurface_for_reanalysis",
      proposed_next_step:
        "Volver a poner el producto en cola de análisis porque cambió la condición que podía bloquearlo.",
    })
  }

  if (
    candidateState === "VALIDATED" &&
    eventType === "price_up"
  ) {
    return withRadarAdvisorReviewQueue({
      ...alert,
      severity:
        "high",
      recommended_action:
        "recalculate_before_listing",
      proposed_next_step:
        "Recalcular margen antes de crear o avanzar el listing.",
    })
  }

  if (
    candidateState === "DRAFT_CREATED" &&
    eventType === "out_of_stock"
  ) {
    return withRadarAdvisorReviewQueue({
      ...alert,
      severity:
        "critical",
      recommended_action:
        "review_existing_draft_inventory",
      required_human_approval:
        true,
      proposed_next_step:
        "Revisar el draft existente y preparar pausa o reducción de cantidad sin ejecutar eBay real.",
    })
  }

  if (
    (
      eventType === "low_stock" ||
      eventType === "out_of_stock"
    ) &&
    candidateState === "LISTED"
  ) {
    return withRadarAdvisorReviewQueue({
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
    })
  }

  if (
    eventType === "discount_started" &&
    hasConsumableSignal(
      product,
      candidate
    ) &&
    hasConfirmedVariantInventory(
      alert.stock_context
    ) &&
    (alert.stock_context.inventory_quantity || 0) >= 6
  ) {
    return withRadarAdvisorReviewQueue({
      ...alert,
      recommended_action:
        "evaluate_pack_strategy",
      proposed_next_step:
        "Recalcular profit y evaluar pack si la demanda acompaña.",
    })
  }

  const inventoryQuantity =
    alert.stock_context.inventory_quantity

  if (
    eventType === "low_stock" &&
    hasConfirmedVariantInventory(
      alert.stock_context
    ) &&
    inventoryQuantity !== null &&
    inventoryQuantity <= 3
  ) {
    return withRadarAdvisorReviewQueue({
      ...alert,
      severity:
        "critical",
    })
  }

  return withRadarAdvisorReviewQueue(
    alert
  )
}

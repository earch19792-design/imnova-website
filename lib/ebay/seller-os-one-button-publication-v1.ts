export const SELLER_OS_ONE_BUTTON_PUBLICATION_V1 =
  "SELLER_OS_ONE_BUTTON_PUBLICATION_V1" as const

export const SELLER_OS_ONE_BUTTON_PUBLICATION_CONFIRMATION =
  "PUBLICAR ESTE LISTING EN EBAY" as const

export type SellerOsOneButtonNextActionV1 =
  | "CONNECT_EBAY_PRODUCTION"
  | "COMPLETE_ACCOUNT_POLICIES"
  | "REFRESH_SUPPLIER_STOCK"
  | "CAPTURE_QTY1_SHIPPING"
  | "COMPLETE_FEE"
  | "RESOLVE_DUPLICATE"
  | "REVIEW_LISTING_IMAGES"
  | "COMPLETE_PRODUCT_TRUTH"
  | "WAIT_UPSTREAM"
  | "RECONCILE_EXISTING_PUBLICATION"
  | "REVIEW_CURRENT_BLOCKER"

function text(value: unknown) {
  return typeof value === "string" ? value.trim().toUpperCase() : ""
}

export function sellerOsOneButtonNextActionV1(
  error: unknown,
  blockers: readonly unknown[] = [],
): Readonly<{
  action: SellerOsOneButtonNextActionV1
  message: string
}> {
  const evidence = [text(error), ...blockers.map(text)].filter(Boolean)
    .join(" ")
  if (/OAUTH|TOKEN|AUTH_OR_PREPROD|IDENTITY_UNBOUND|ACCOUNT_AUTH/.test(
    evidence,
  )) return Object.freeze({
    action: "CONNECT_EBAY_PRODUCTION",
    message: "Conecta eBay Production una vez y vuelve a usar el mismo botón.",
  })
  if (/POLICY|POLICIES|MERCHANT_LOCATION|ACCOUNT_PROFILE/.test(evidence)) {
    return Object.freeze({
      action: "COMPLETE_ACCOUNT_POLICIES",
      message: "Falta completar o renovar las políticas de la cuenta eBay.",
    })
  }
  if (/STOCK|INVENTORY_QUANTITY|SUPPLIER_AVAILABLE/.test(evidence)) {
    return Object.freeze({
      action: "REFRESH_SUPPLIER_STOCK",
      message: "Actualiza el stock exacto del proveedor antes de publicar.",
    })
  }
  if (/SHIPPING|QTY1/.test(evidence)) return Object.freeze({
    action: "CAPTURE_QTY1_SHIPPING",
    message: "Falta el shipping real de una unidad.",
  })
  if (/FEE|ECONOMICS|PROFIT|MARKET_PRICE/.test(evidence)) {
    return Object.freeze({
      action: "COMPLETE_FEE",
      message: "Falta cerrar fees y confirmar la ganancia mínima de $4.",
    })
  }
  if (/DUPLICATE|COLLISION|ALREADY_PUBLISHED|ANOTHER_OFFER|OFFER_COLLECTION|MULTIPLE.*OFFER/.test(
    evidence,
  )) {
    return Object.freeze({
      action: "RESOLVE_DUPLICATE",
      message: "Seller OS detectó riesgo de duplicado y se detuvo.",
    })
  }
  if (/IMAGE|VISUAL|GALLERY/.test(evidence)) return Object.freeze({
    action: "REVIEW_LISTING_IMAGES",
    message: "Falta aprobar o reparar el juego final de imágenes.",
  })
  if (/PRODUCT_TRUTH|SPECIFIC|CATEGORY|CONDITION|UPC|GTIN/.test(evidence)) {
    return Object.freeze({
      action: "COMPLETE_PRODUCT_TRUTH",
      message: "Falta demostrar un dato obligatorio del producto.",
    })
  }
  if (/OUTCOME_UNKNOWN|READBACK|RECONCILIATION|IN_FLIGHT/.test(evidence)) {
    return Object.freeze({
      action: "RECONCILE_EXISTING_PUBLICATION",
      message: "Se verificará el intento existente sin volver a publicar.",
    })
  }
  if (/429|RATE_LIMIT|UPSTREAM|TIMEOUT|UNAVAILABLE|HTTP_5/.test(evidence)) {
    return Object.freeze({
      action: "WAIT_UPSTREAM",
      message: "eBay o una autoridad está temporalmente no disponible; no se publicó.",
    })
  }
  return Object.freeze({
    action: "REVIEW_CURRENT_BLOCKER",
    message: "Seller OS se detuvo antes de una operación no comprobada.",
  })
}

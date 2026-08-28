export type CanonicalListingReadinessUiInput = {
  ready: boolean
  blockers: string[]
} | null | undefined

export type CanonicalUiBlocker = {
  reasonCode: string
  explanation: string
  resolutionAction: string
}

function explainCanonicalBlocker(reasonCode: string): CanonicalUiBlocker {
  const exact: Record<string, Omit<CanonicalUiBlocker, "reasonCode">> = {
    EBAY_PREFLIGHT_SNAPSHOT_REQUIRED: {
      explanation: "La cuenta, ubicación o policies no tienen un snapshot eBay vigente.",
      resolutionAction: "Renueva la comprobación eBay desde este Workspace y vuelve a validar.",
    },
    CATEGORY_ASPECTS_NOT_VALIDATED: {
      explanation: "La categoría o sus aspectos no coinciden con la Taxonomy oficial vigente.",
      resolutionAction: "Corrige Category ID y los aspectos oficiales indicados en este Workspace.",
    },
    ASPECT_CONSTRAINTS_UNVERIFIABLE: {
      explanation: "No fue posible verificar las restricciones oficiales de los aspectos.",
      resolutionAction: "Renueva Taxonomy desde este Workspace antes de volver a validar.",
    },
    IMAGE_AUTHORIZATION_REQUIRED: {
      explanation: "El conjunto exacto de imágenes no tiene autorización canónica vigente.",
      resolutionAction: "Reabre Final Listing Review y aprueba el conjunto exacto indicado.",
    },
    IMAGE_NOT_AUTHORIZED: {
      explanation: "Una imagen del payload no pertenece al conjunto canónico aprobado.",
      resolutionAction: "Restablece en Final Listing Review el conjunto exacto aprobado.",
    },
    EBAY_ONE_CLICK_PUBLICATION_ACCOUNT_PREFLIGHT_FAILED: {
      explanation: "eBay no confirmó la cuenta, policies o ubicación exactas durante la renovación.",
      resolutionAction: "Revisa la conexión eBay mostrada aquí y vuelve a usar PUBLICAR EN EBAY.",
    },
    SMART_STOCKING_PACKAGE_SOURCE_REVALIDATION_FAILED: {
      explanation: "El paquete ya no coincide exactamente con la evidencia comercial durable.",
      resolutionAction: "Revisa el precio o costo señalado aquí antes de volver a publicar.",
    },
  }
  const known = exact[reasonCode]
  if (known) return { reasonCode, ...known }
  if (reasonCode.startsWith("REQUIRED_ASPECT_MISSING:")) {
    const aspectName = reasonCode.slice("REQUIRED_ASPECT_MISSING:".length)
      .trim() || "requerido"
    return {
      reasonCode,
      explanation: `Taxonomy exige ${aspectName}, pero el package canónico no tiene un valor respaldado.`,
      resolutionAction:
        `Completa ${aspectName} en Aspectos de este Workspace usando sólo un valor permitido por Taxonomy y probado por Product Truth.`,
    }
  }
  if (/STOCK|SUPPLY|LUNA|LISTING_INTAKE/.test(reasonCode)) return {
    reasonCode,
    explanation: "La disponibilidad o evidencia comercial vigente no permite publicar.",
    resolutionAction: "Reconfirma stock y costo del producto Luna exacto desde este Workspace.",
  }
  if (/PRICE|MARGIN|ECONOMIC|COST/.test(reasonCode)) return {
    reasonCode,
    explanation: "La economía canónica no supera una guarda obligatoria.",
    resolutionAction: "Corrige el precio mostrado en este Workspace y vuelve a validar.",
  }
  if (/PACKAGE.*SOURCE|SOURCE.*PACKAGE|DURABLE_SOURCE/.test(reasonCode)) return {
    reasonCode,
    explanation: "La fuente durable del paquete no superó la revalidación exacta.",
    resolutionAction: "Revisa la evidencia comercial indicada aquí y vuelve a validar.",
  }
  if (/CATEGORY|TAXONOMY|ASPECT/.test(reasonCode)) return {
    reasonCode,
    explanation: "La categoría o los aspectos oficiales requieren corrección.",
    resolutionAction: "Corrige Category ID o el aspecto señalado en este Workspace.",
  }
  if (/IMAGE/.test(reasonCode)) return {
    reasonCode,
    explanation: "El conjunto canónico de imágenes no supera la validación vigente.",
    resolutionAction: "Corrige el conjunto señalado en Final Listing Review.",
  }
  return {
    reasonCode,
    explanation: "La autoridad canónica de readiness detuvo la publicación.",
    resolutionAction: "Corrige el dato identificado por este reason_code y vuelve a validar en este Workspace.",
  }
}

export function canonicalListingReadyUi(
  readiness: CanonicalListingReadinessUiInput,
) {
  const uiBlockers = readiness?.blockers ?? []
  const listingReady = readiness?.ready === true && uiBlockers.length === 0
  return {
    // Keep the exact array: UI must never filter, merge or supplement canonical
    // readiness blockers with a legacy workspace authority.
    uiBlockers,
    blockerDetails: uiBlockers.map(explainCanonicalBlocker),
    blockerSectionHidden: Boolean(readiness) && uiBlockers.length === 0,
    listingReady,
    preparationPercent: listingReady ? 100 : null,
  }
}

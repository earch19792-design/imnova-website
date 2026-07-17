import type { WinnerEvidenceDecisionPackage } from "./ebay-winner-evidence-v2"

export const LOOP1_ACTIVE_LOOP = "LOOP 1"
export const LOOP1_VALIDATION_STATUS = "READY_FOR_VALIDATION"
export const LOOP1_BACKGROUND_MONITOR_STATUS = "INDEPENDENT"

export type Loop1LunaCandidateFacts = {
  supplierSku?: string | null
  supplierVariantId?: string | null
  variantTitle?: string | null
  productUrl?: string | null
  imageReference?: string | null
  lunaPrice?: number | null
  stockQuantity?: number | null
}

export type Loop1HumanConfirmations = {
  stockConfirmed: boolean
  costConfirmed: boolean
  imageConfirmed: boolean
}

export function getLoop1LunaCatalogUrl(value: string | null | undefined) {
  if (!value) return null
  try {
    const url = new URL(value)
    const isLunaHost = url.hostname === "lunaportex.com" ||
      url.hostname.endsWith(".lunaportex.com")
    return url.protocol === "https:" && isLunaHost ? url.href : null
  } catch {
    return null
  }
}

export function getLoop1SafeProductImageUrl(value: string | null | undefined) {
  if (!value) return null
  try {
    const url = new URL(value)
    const isTrustedImageHost = url.hostname === "cdn.shopify.com" ||
      url.hostname === "lunaportex.com" ||
      url.hostname.endsWith(".lunaportex.com")
    return url.protocol === "https:" && isTrustedImageHost ? url.href : null
  } catch {
    return null
  }
}

export function getLoop1WinnerAnalysisGate(
  candidate: Loop1LunaCandidateFacts | null,
  confirmations: Loop1HumanConfirmations,
) {
  if (!candidate) {
    return {
      mappingComplete: false,
      analysisEnabled: false,
      missingMapping: ["Selecciona un candidato Luna"],
      pendingConfirmations: [] as string[],
      disabledReason: "Selecciona un candidato Luna",
    }
  }
  const missingMapping = [
    !getLoop1LunaCatalogUrl(candidate.productUrl) ? "Falta URL Luna válida" : null,
    !candidate.supplierSku?.trim() ? "Falta SKU Luna" : null,
    !candidate.supplierVariantId?.trim() || !candidate.variantTitle?.trim()
      ? "Falta variante Luna"
      : null,
    !(Number(candidate.lunaPrice) > 0) ? "Falta costo Luna real" : null,
    !(Number.isInteger(Number(candidate.stockQuantity)) && Number(candidate.stockQuantity) > 0)
      ? "Falta stock Luna real"
      : null,
    !getLoop1SafeProductImageUrl(candidate.imageReference) ? "Falta imagen Luna válida" : null,
  ].filter((entry): entry is string => Boolean(entry))
  const pendingConfirmations = [
    !confirmations.stockConfirmed ? "Falta confirmar stock" : null,
    !confirmations.costConfirmed ? "Falta confirmar costo" : null,
    !confirmations.imageConfirmed ? "Falta confirmar imagen" : null,
  ].filter((entry): entry is string => Boolean(entry))
  const mappingComplete = missingMapping.length === 0
  const analysisEnabled = mappingComplete && pendingConfirmations.length === 0
  return {
    mappingComplete,
    analysisEnabled,
    missingMapping,
    pendingConfirmations,
    disabledReason: missingMapping[0] ?? pendingConfirmations[0] ?? null,
  }
}

export function getLoop1DecisionExplanation(
  decisionPackage: Pick<WinnerEvidenceDecisionPackage, "decision"> | null,
) {
  if (!decisionPackage) {
    return "Completa las confirmaciones Luna y ejecuta el análisis de mercado para obtener un veredicto."
  }
  if (decisionPackage.decision.verdict === "GO") {
    return "La identidad es sólida, la economía cumple los mínimos y existe evidencia suficiente para avanzar a revisión humana del siguiente loop."
  }
  if (decisionPackage.decision.verdict === "GO_WITH_CHANGES") {
    return "El producto puede ser viable, pero todavía requiere corregir o confirmar los puntos indicados antes de avanzar."
  }
  return decisionPackage.decision.blockers.length
    ? `No conviene avanzar todavía. Debes resolver: ${decisionPackage.decision.blockers.join(", ").replaceAll("_", " ").toLowerCase()}.`
    : "La evidencia actual no permite avanzar con seguridad. Selecciona otro producto o completa los datos faltantes."
}

export function getLoop1PackageSaveDisabledReason(input: {
  analysisEnabled: boolean
  analysisAvailable: boolean
  saving: boolean
}) {
  if (input.saving) return "El paquete se está guardando"
  if (!input.analysisEnabled) return "Completa las confirmaciones requeridas antes de guardar"
  if (!input.analysisAvailable) return "Ejecuta Analizar mercado eBay antes de guardar"
  return null
}

export function verifyLoop1DecisionPackageReadback(
  expected: Pick<WinnerEvidenceDecisionPackage, "packageHash" | "packageVersion">,
  actual: Pick<WinnerEvidenceDecisionPackage, "packageHash" | "packageVersion" | "safety">,
) {
  return expected.packageHash === actual.packageHash &&
    expected.packageVersion === actual.packageVersion &&
    actual.safety.canPublish === false &&
    actual.safety.ebayWrites === 0
}

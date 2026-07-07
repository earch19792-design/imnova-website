export const EBAY_PRO_OFFICIAL_ROUTE_VERSION =
  "EBAY_PRO_OFFICIAL_ROUTE_PRE139_V1"

export const EBAY_PRO_FUTURE_BASE_BRANCH =
  "staging/ebay-pro-seller-os"

type OfficialRouteLoop = {
  loopId: string
  label: string
}

export const EBAY_PRO_OFFICIAL_ROUTE = [
  {
    loopId:
      "PRE-139",
    label:
      "eBay Pro Staging Workstream Structure + Definition of Done Framework + Human Explanation Rule",
  },
  {
    loopId:
      "139",
    label:
      "Execution Harness con candado",
  },
  {
    loopId:
      "140",
    label:
      "Staging schema compatibility",
  },
  {
    loopId:
      "141",
    label:
      "Approved Staging Write de 3 candidatos",
  },
  {
    loopId:
      "142",
    label:
      "First Real Luna Portex Mini Scan + Automatic Scan Foundation",
  },
  {
    loopId:
      "143",
    label:
      "Benchmark Data Model + Direct Sourcing Signals + Pricing Psychology Inputs + Sold Price Intelligence",
  },
  {
    loopId:
      "144",
    label:
      "Winner Score V2 + Buy-Direct Opportunity Score + Price Confidence Score + Price War Risk Score + Perceived Value Score + Margin Protection Score",
  },
  {
    loopId:
      "145",
    label:
      "Advisor OS Candidate Review + WhatsApp Mobile Approval + Sourcing Recommendation + Pricing Advisor",
  },
  {
    loopId:
      "146",
    label:
      "Listing Package Builder + WhatsApp Listing Approval + Value-Based Pricing Strategy + Trust-Based Listing Optimization",
  },
  {
    loopId:
      "147",
    label:
      "Image Package Workflow + WhatsApp Image Alerts + Perceived Value Image Check",
  },
  {
    loopId:
      "148",
    label:
      "eBay Sandbox OAuth",
  },
  {
    loopId:
      "149",
    label:
      "eBay Sandbox Draft Listing",
  },
  {
    loopId:
      "150",
    label:
      "First Human-Approved Real Listing + WhatsApp Final Approval",
  },
  {
    loopId:
      "151",
    label:
      "Seller OS Dashboard + Mobile Decision Center + Direct Sourcing Radar + Pricing Intelligence Panel + eBay Active Listings View Mapping + Reminder: configure and order eBay Seller Hub active listing columns",
  },
  {
    loopId:
      "152",
    label:
      "Active Listing Monitor + eBay Listing Data Sync + Automatic Luna Portex Scan + Supplier Stock Guard + WhatsApp Seller Alerts + Price Adjustment Alerts + Price War Protection + Reminder: validate eBay Seller Hub active listing view as manual backup",
  },
  {
    loopId:
      "153",
    label:
      "Direct Supplier / Brand Sourcing Pipeline",
  },
] as const

export const EBAY_PRO_WORKSTREAM_POLICY = {
  version:
    EBAY_PRO_OFFICIAL_ROUTE_VERSION,
  production:
    {
      frozen:
        true,
      coreOnly:
        true,
      ebayProEnabled:
        false,
      ebayKeysAllowed:
        false,
      writesAllowed:
        false,
    },
  staging:
    {
      reservedForEbayPro:
        true,
      futureBaseBranch:
        EBAY_PRO_FUTURE_BASE_BRANCH,
    },
  main:
    {
      stabilityRule:
        "no ebay pro workstream merges unless checkpoint approved",
    },
  ebayDeveloper:
    {
      sandboxKeysetCreated:
        true,
      useBeforeLoop148:
        false,
    },
  local:
    {
      dryRunOnly:
        true,
    },
} as const

export const EBAY_PRO_DEFINITION_OF_DONE = [
  "Implementa unicamente el objetivo del loop.",
  "No agrega features fuera de la ruta oficial.",
  "Tiene tests propios del loop.",
  "Tiene dry-run o simulacion cuando aplique.",
  "Valida casos normales, bloqueados, incompletos y duplicados.",
  "Corre regresiones de modulos anteriores.",
  "Pasa npx tsc --noEmit.",
  "Pasa git diff --check y git diff --cached --check.",
  "No toca Production salvo aprobacion explicita.",
  "No escribe en Staging salvo que el loop lo autorice.",
  "No usa eBay API/OAuth/tokens salvo que el loop lo autorice.",
  "No manda WhatsApp real salvo que el loop lo autorice.",
  "No usa Supabase write/SQL salvo que el loop lo autorice.",
  "No crea ni modifica .env*.",
  "No incluye secrets, dumps, backups ni imagenes inesperadas.",
  "Reporta outputs numericos esperados.",
  "Reporta warnings y bloqueos.",
  "Confirma git status limpio.",
  "Incluye explicacion humana completa y bien redactada.",
  "Indica el siguiente loop exacto de la ruta oficial.",
] as const

export const EBAY_PRO_HUMAN_EXPLANATION_REQUIRED_SECTIONS = [
  "Que se hizo.",
  "Por que se hizo.",
  "Que problema resuelve.",
  "Que protegio.",
  "Que cambio realmente.",
  "Que NO se toco.",
  "Como esto nos acerca a vender en eBay.",
  "Que sigue exactamente en la ruta oficial.",
] as const

export const EBAY_PRO_SEMAPHORE_STATUSES = [
  "GREEN",
  "YELLOW",
  "RED",
] as const

function normalizeLoopId(
  loopId: string | number
) {
  return String(loopId).trim()
}

export function getNextEbayProLoop(
  loopId: string | number
) {
  const currentLoopId =
    normalizeLoopId(loopId)
  const currentIndex =
    EBAY_PRO_OFFICIAL_ROUTE.findIndex(
      loop =>
        loop.loopId === currentLoopId,
    )

  if (currentIndex < 0) {
    return null
  }

  return EBAY_PRO_OFFICIAL_ROUTE[currentIndex + 1] ?? null
}

export function validateEbayProOfficialRoute(
  route: readonly OfficialRouteLoop[] = EBAY_PRO_OFFICIAL_ROUTE
) {
  const loopIds =
    route.map(
      loop =>
        loop.loopId,
    )
  const uniqueLoopIds =
    new Set(loopIds)
  const hasRequiredBoundaries =
    route[0]?.loopId === "PRE-139" &&
    route[route.length - 1]?.loopId === "153"

  return {
    valid:
      hasRequiredBoundaries &&
      loopIds.length === uniqueLoopIds.size &&
      route.length === EBAY_PRO_OFFICIAL_ROUTE.length,
    startsAt:
      route[0]?.loopId ?? null,
    endsAt:
      route[route.length - 1]?.loopId ?? null,
    loopCount:
      route.length,
    duplicateLoopIds:
      loopIds.filter(
        (loopId, index) =>
          loopIds.indexOf(loopId) !== index,
      ),
  }
}

export function validateLoopDefinitionOfDoneChecklist(
  checklist: readonly string[]
) {
  const required =
    EBAY_PRO_DEFINITION_OF_DONE
  const missingItems =
    required.filter(
      item =>
        !checklist.includes(item),
    )
  const duplicateItems =
    checklist.filter(
      (item, index) =>
        checklist.indexOf(item) !== index,
    )

  return {
    valid:
      missingItems.length === 0 &&
      duplicateItems.length === 0 &&
      checklist.length === required.length,
    requiredCount:
      required.length,
    actualCount:
      checklist.length,
    missingItems,
    duplicateItems,
  }
}

export function validateHumanExplanationSections(
  sections: readonly string[]
) {
  const required =
    EBAY_PRO_HUMAN_EXPLANATION_REQUIRED_SECTIONS
  const missingSections =
    required.filter(
      section =>
        !sections.includes(section),
    )
  const duplicateSections =
    sections.filter(
      (section, index) =>
        sections.indexOf(section) !== index,
    )

  return {
    valid:
      missingSections.length === 0 &&
      duplicateSections.length === 0,
    requiredCount:
      required.length,
    actualCount:
      sections.length,
    missingSections,
    duplicateSections,
  }
}

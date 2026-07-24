export type CommercialWhatsappOutboxRow = {
  id: string
  marketplace_account_key: string
  marketplace: string
  channel: string
  delivery_class: "immediate" | "digest"
  severity: "critical" | "high" | "medium" | "low"
  status: string
  payload: Record<string, unknown>
  attempts: number
  due_at: string
}

// Keep the hydrated approved template below Meta's body limit (META_132005)
// while leaving enough room for the actionable Seller OS URL.
const TEMPLATE_TEXT_BUDGET = {
  priority: 40,
  title: 90,
  summary: 220,
  action: 300,
} as const

function sentence(value: unknown, maximum: number) {
  const normalized = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (normalized.length <= maximum) return normalized
  const bounded = normalized.slice(0, Math.max(1, maximum - 1))
  const lastSpace = bounded.lastIndexOf(" ")
  return `${bounded.slice(0, lastSpace >= maximum * .65 ? lastSpace : bounded.length).trim()}…`
}

function templateLine(value: unknown, maximum: number) {
  const clean = sentence(value, Math.max(1, maximum - 2))
  return clean ? `• ${clean}` : "• Revisar en Seller OS"
}

function priorityLabel(value: CommercialWhatsappOutboxRow["severity"]) {
  if (value === "critical") return "CRÍTICA — actuar ahora"
  if (value === "high") return "ALTA — revisar pronto"
  if (value === "medium") return "MEDIA — revisar hoy"
  return "INFORMATIVA"
}

function cleanAlertTitle(value: unknown) {
  return sentence(
    String(value ?? "")
      .replace(/^[\s:;,.—–-]+/, "")
      .replace(/\s*[:;,.—–-]+\s*$/, ""),
    TEMPLATE_TEXT_BUDGET.title,
  )
}

function cleanAlertSummary(row: CommercialWhatsappOutboxRow) {
  const raw = String(row.payload.summary ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  const listing = raw.match(/\bListing\s+[0-9]{9,20}\b/i)?.[0] ?? null
  const sku = raw.match(/\bSKU\s+[A-Za-z0-9._:-]{1,80}\b/i)?.[0] ?? null
  const identity = [listing, sku].filter(Boolean).join(" · ")
  const title = String(row.payload.title ?? "")

  if (
    title.toLowerCase().includes("costo y stock en luna") ||
    raw.includes("LUNA_MARKET_RADAR_LATEST_VARIANT_LOCAL_SNAPSHOT")
  ) {
    return sentence(
      `${identity ? `${identity}. ` : ""}La evidencia de Luna necesita reconfirmación. Seller OS no usó stock ni costo vencidos como datos actuales.`,
      TEMPLATE_TEXT_BUDGET.summary,
    )
  }

  const withoutTechnicalEvidence = raw
    .replace(/\s*Evidencia:\s*\{[\s\S]*$/i, "")
    .replace(/\{[\s\S]*\}/g, "")
    .replace(/\s+/g, " ")
    .trim()
  return sentence(
    withoutTechnicalEvidence ||
      "Seller OS detectó una señal verificada y no aplicó cambios automáticos.",
    TEMPLATE_TEXT_BUDGET.summary,
  )
}

export function renderCommercialWhatsAppMessage(
  row: CommercialWhatsappOutboxRow,
) {
  return {
    deliveryClass: row.delivery_class === "digest"
      ? "digest" as const
      : "immediate" as const,
    // The currently approved Meta template places variables immediately after
    // a colon. Prefixing every value with a bullet creates a visible separator
    // without requiring a new template approval.
    priorityLabel: templateLine(
      priorityLabel(row.severity),
      TEMPLATE_TEXT_BUDGET.priority,
    ),
    title: templateLine(
      cleanAlertTitle(row.payload.title),
      TEMPLATE_TEXT_BUDGET.title,
    ),
    summary: templateLine(cleanAlertSummary(row), TEMPLATE_TEXT_BUDGET.summary),
    action: templateLine(
      row.payload.whatsappAction ?? row.payload.action,
      TEMPLATE_TEXT_BUDGET.action,
    ),
  }
}

export function renderCommercialWhatsAppDigest(
  rows: CommercialWhatsappOutboxRow[],
) {
  const boundedRows = rows.slice(0, 10)
  const summaries = boundedRows.map((row, index) =>
    `${index + 1}. ${cleanAlertTitle(row.payload.title) || "Novedad"}`
  )
  const highestSeverity = boundedRows.some((row) => row.severity === "critical")
    ? "high" as const
    : "medium" as const
  const firstReviewUrl = boundedRows
    .map((row) => row.payload.improvementUrl ?? row.payload.actionUrl)
    .find((value) => typeof value === "string" && value.startsWith("https://"))

  return {
    deliveryClass: "digest" as const,
    priorityLabel: templateLine(
      priorityLabel(highestSeverity),
      TEMPLATE_TEXT_BUDGET.priority,
    ),
    title: templateLine(
      `${boundedRows.length} novedades comerciales`,
      TEMPLATE_TEXT_BUDGET.title,
    ),
    summary: templateLine(
      summaries.join(" · "),
      TEMPLATE_TEXT_BUDGET.summary,
    ),
    action: templateLine(
      `Revisar el resumen y autorizar sólo las acciones necesarias en Seller OS.${firstReviewUrl ? ` ${firstReviewUrl}` : ""}`,
      TEMPLATE_TEXT_BUDGET.action,
    ),
  }
}

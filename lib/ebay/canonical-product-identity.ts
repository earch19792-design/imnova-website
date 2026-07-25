import { createHash } from "node:crypto"

type AnyRecord = Record<string, unknown>
const record = (v: unknown): AnyRecord => v && typeof v === "object" && !Array.isArray(v) ? v as AnyRecord : {}

function normalizeGtin(value: unknown) {
  const raw = typeof value === "string" ? value.normalize("NFKC").replace(/[\s-]/g, "") : ""
  return /^\d{12,14}$/.test(raw) ? raw : ""
}

function validGtin(value: string) {
  if (!value) return false
  const digits = value.split("").map(Number)
  const check = digits.pop()!
  let sum = 0
  for (let i = digits.length - 1, weight = 3; i >= 0; i--, weight = weight === 3 ? 1 : 3) sum += digits[i] * weight
  return (10 - (sum % 10)) % 10 === check
}

export function resolveCanonicalProductIdentity(dossier: unknown) {
  const root = record(dossier)
  const authoritative = Array.isArray(record(root.authoritativeFactsPackage).facts) ? record(root.authoritativeFactsPackage).facts as unknown[] : []
  const resolved = Array.isArray(root.resolvedFacts) ? root.resolvedFacts as unknown[] : []
  const get = (rows: unknown[], key: string, corroboratedOnly = false) => rows.find((row) => {
    const r = record(row)
    return String(r.key ?? "").toLowerCase() === key.toLowerCase() && (!corroboratedOnly || r.status === "CORROBORATED")
  })
  const fields = ["brand", "mpn", "gtin", "color", "netContent", "unitCount", "offerPackCount", "condition", "exactProductName"]
  const identity: AnyRecord = {}
  const provenance: AnyRecord = {}
  for (const field of fields) {
    const exact = get(authoritative, field)
    const fallback = get(resolved, field, true)
    const exactValue = field === "gtin" ? normalizeGtin(record(exact).value) : record(exact).value
    const fallbackValue = field === "gtin" ? normalizeGtin(record(fallback).value) : record(fallback).value
    if (exact && fallback && exactValue !== fallbackValue) throw new Error(`PRODUCT_DOSSIER_IDENTITY_MISMATCH:${field.toUpperCase()}`)
    const value = exact ? exactValue : fallback ? fallbackValue : undefined
    if (value !== undefined && value !== null && value !== "") { identity[field] = value; provenance[field] = exact ? "authoritativeFactsPackage" : "resolvedFacts/CORROBORATED" }
  }
  if (typeof identity.gtin !== "string" || !validGtin(identity.gtin)) throw new Error("PRODUCT_DOSSIER_IDENTITY_MISMATCH:GTIN")
  return { identity, provenance, identityHash: createHash("sha256").update(JSON.stringify(identity)).digest("hex") }
}

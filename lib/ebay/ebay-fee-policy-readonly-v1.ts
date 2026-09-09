import { createHash } from "node:crypto"
import template from "../../docs/ebay-official-basic-fee-policy-snapshot-v1.json" with { type: "json" }

const clean = (s: string) => s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<[^>]*>/g, " ")
  .replace(/&amp;/g, "&").replace(/&gt;/g, ">").replace(/&(?:nbsp|#160);/g, " ").replace(/\s+/g, " ").trim()
const n = (s: string) => Number(s.replaceAll(",", ""))

/** Bounded official source producer. It updates numbers only inside the
 * already-supported tariff structures. Ambiguous/changed structures fail closed;
 * it never guesses a category, Store tier, fee basis or effective legal date. */
export function parseCurrentOfficialFeePolicyV1(html: string, now: Date): typeof template | null {
  if (html.length > 2_000_000) return null
  const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].slice(0, 100)
    .map(m => [...m[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c => clean(c[1])))
  const one = (match: (label: string) => boolean) => {
    const found = rows.filter(r => r.length >= 2 && match(r[0]))
    return found.length === 1 ? found[0].at(-1)! : ""
  }
  const general = one(s => s.startsWith("Most categories"))
    .match(/^([\d.]+)% on total amount of the sale up to \$([\d,.]+) calculated per item ([\d.]+)% on the portion of the sale over \$([\d,.]+)$/)
  const jewelry = one(s => s === "Jewelry & Watches (except Watches, Parts & Accessories)")
    .match(/^([\d.]+)% if total amount of the sale is \$([\d,.]+) or less, calculated per item ([\d.]+)% if total amount of the sale is over \$([\d,.]+), calculated per item$/)
  const watches = one(s => s === "Jewelry & Watches > Watches, Parts & Accessories")
    .match(/^([\d.]+)% on total amount of the sale up to \$([\d,.]+) calculated per item ([\d.]+)% on the portion of the sale over \$([\d,.]+) up to \$([\d,.]+) calculated per item ([\d.]+)% on the portion of the sale over \$([\d,.]+)$/)
  const fixed = clean(html).match(/For orders \$([\d,.]+) or less the per order fee is \$([\d.]+), for orders over \$([\d,.]+) the per order fee is \$([\d.]+)\./)
  if (!general || !jewelry || !watches || !fixed || general[2] !== general[4] || jewelry[2] !== jewelry[4] ||
      watches[2] !== watches[4] || watches[5] !== watches[7] || fixed[1] !== fixed[3]) return null
  const values = [general, jewelry, watches, fixed].flatMap(m => m.slice(1).map(n))
  if (values.some(v => !Number.isFinite(v) || v < 0)) return null
  const data = structuredClone(template)
  data.perOrder = { threshold: n(fixed[1]), atOrBelow: n(fixed[2]), above: n(fixed[4]) }
  for (const rule of data.rules) {
    rule.tiers = rule.id === "JEWELRY_EXCLUDING_WATCHES" ? [{ upTo: n(jewelry[2]), ratePct: n(jewelry[1]) }, { upTo: null, ratePct: n(jewelry[3]) }] :
      rule.id === "WATCHES" ? [{ upTo: n(watches[2]), ratePct: n(watches[1]) }, { upTo: n(watches[5]), ratePct: n(watches[3]) }, { upTo: null, ratePct: n(watches[6]) }] :
      [{ upTo: n(general[2]), ratePct: n(general[1]) }, { upTo: null, ratePct: n(general[3]) }]
  }
  if (data.rules.some(r => r.tiers.some(t => t.ratePct > 100))) return null
  data.snapshotVersion = "EBAY_OFFICIAL_FEE_POLICY:" + createHash("sha256").update(JSON.stringify([data.rules, data.perOrder])).digest("hex")
  data.verifiedAt = now.toISOString()
  return data
}

export async function readCurrentOfficialFeePolicyV1(now = new Date()) {
  try {
    const response = await fetch(template.source, { headers: { "Accept-Language": "en-US" }, redirect: "error",
      cache: "no-store", signal: AbortSignal.timeout(8_000) })
    if (!response.ok || !response.body || Number(response.headers.get("content-length")) > 2_000_000) return null
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0
    for (;;) {
      const { done, value } = await reader.read(); if (done) break
      size += value.byteLength; if (size > 2_000_000) { await reader.cancel(); return null }
      chunks.push(value)
    }
    return parseCurrentOfficialFeePolicyV1(Buffer.concat(chunks).toString("utf8"), now)
  } catch { return null }
}

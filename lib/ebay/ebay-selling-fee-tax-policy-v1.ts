import { createHash } from "node:crypto"
export const SELLING_FEE_TAX_SOURCE = "https://www.ebay.com/help/fees-billing/sell-fees-payments/payments-taxes-import-charges?id=4121"
export type SellingFeeTaxPolicyV1 = { source: string; digest: string; observedAt: string; freshUntil: string; applicableStates: string[] }
const states: Record<string,string> = { Hawaii:"HI", "South Dakota":"SD", Texas:"TX", Washington:"WA" }
/** Accept only the explicitly supported complete US scope; changes fail closed. */
export function parseSellingFeeTaxPolicyV1(html: string, now: Date): SellingFeeTaxPolicyV1 | null {
  if (html.length > 2_000_000) return null
  const text = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi," ").replace(/<[^>]*>/g," ")
    .replace(/&(?:nbsp|#160);/g," ").replace(/\s+/g," ")
  const scopes = [...text.matchAll(/In the US, this currently applies to sellers located in ([^.]+)\./g)]
  if (scopes.length !== 1 || !text.includes("Tax on eBay selling fees")) return null
  const names = scopes[0][1].split(/,\s*(?:and\s+)?|\s+and\s+/).map(s=>s.trim())
  if (names.length !== 4 || new Set(names).size !== 4 || names.some(s=>!states[s])) return null
  return { source: SELLING_FEE_TAX_SOURCE, digest: createHash("sha256").update(scopes[0][0]).digest("hex"),
    observedAt: now.toISOString(), freshUntil: new Date(now.getTime()+6*3600_000).toISOString(), applicableStates: names.map(s=>states[s]) }
}
let cached: SellingFeeTaxPolicyV1 | null = null
let nextReadAt = 0
let inFlight: Promise<SellingFeeTaxPolicyV1 | null> | null = null
/** Shares the existing fee producer; one bounded public-document read, no poller. */
export async function readSellingFeeTaxPolicyV1(now = new Date()): Promise<SellingFeeTaxPolicyV1 | null> {
  if (cached && Date.parse(cached.freshUntil)>now.getTime()) return cached
  if (inFlight) return inFlight
  if (now.getTime()<nextReadAt) return null
  nextReadAt=now.getTime()+15*60_000
  inFlight=(async()=>{try {
    const r=await fetch(SELLING_FEE_TAX_SOURCE,{headers:{"Accept-Language":"en-US"},redirect:"error",cache:"no-store",signal:AbortSignal.timeout(8000)})
    if (!r.ok || !r.body || Number(r.headers.get("content-length"))>2_000_000) return null
    const reader=r.body.getReader(), chunks:Uint8Array[]=[];let size=0
    for (;;) { const {done,value}=await reader.read();if(done)break;size+=value.byteLength
      if(size>2_000_000){await reader.cancel();return null} chunks.push(value) }
    cached=parseSellingFeeTaxPolicyV1(Buffer.concat(chunks).toString("utf8"),now)
    return cached
  } catch { return null } finally { inFlight=null } })()
  return inFlight
}

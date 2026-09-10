import type { MayelLiveContentV1 } from "./mayel-autonomous-content-v1"
const contentPatchRecordV1 = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {}
export function validateMayelContentPatchV1(value: unknown): Partial<MayelLiveContentV1> {
  const p = contentPatchRecordV1(value), keys = Object.keys(p)
  if (!keys.length || keys.some(k => !["title", "description", "aspects"].includes(k)) ||
      (p.title !== undefined && (typeof p.title !== "string" || !p.title.trim() || p.title.length > 80)) ||
      (p.description !== undefined && (typeof p.description !== "string" || !p.description.trim() || p.description.length > 50_000 || /<(?!br\s*\/?>)/i.test(p.description))))
    throw Error("OPTIMIZATION_CONTENT_SCOPE_INVALID")
  if (p.aspects !== undefined) {
    const aspects = contentPatchRecordV1(p.aspects)
    if (Object.keys(aspects).length < 1 || Object.keys(aspects).length > 45 || Object.entries(aspects).some(([k, v]) =>
      !k.trim() || k.length > 65 || !Array.isArray(v) || !v.length || v.some(x => typeof x !== "string" || !x.trim() || x.length > 800)))
      throw Error("OPTIMIZATION_SPECIFICS_INVALID")
  }
  return p as Partial<MayelLiveContentV1>
}


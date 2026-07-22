type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function text(value: unknown, maximum: number) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : ""
}

export function assertStoredSameDayImageSetQaPassed(assets: unknown) {
  if (!Array.isArray(assets) || assets.length !== 6 || assets.some((asset) =>
    record(record(asset).qa_result).automaticStatus !== "PASSED")) {
    throw new Error("SAME_DAY_IMAGE_SET_QA_NOT_PASSED")
  }
}

export function currentAttemptPublicObjects(entries: unknown) {
  if (!Array.isArray(entries)) return []
  return entries.map(record).filter((entry) =>
    entry.public_object_created === true &&
    Boolean(text(entry.published_storage_path, 1_000)) &&
    /^[0-9a-f]{64}$/.test(text(entry.output_sha256, 64)))
    .map((entry) => ({
      path: text(entry.published_storage_path, 1_000),
      sha256: text(entry.output_sha256, 64),
      createdByCurrentAttempt: true as const,
    }))
}

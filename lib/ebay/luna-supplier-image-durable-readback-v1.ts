const AUTHORITY_VERSION = "OPERATOR_BOUND_LUNA_SUPPLIER_IMAGE_RIGHTS_V1"

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function text(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : ""
}

function uuid(value: unknown) {
  const normalized = text(value, 40)
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(normalized) ? normalized : ""
}

export function assertAutomaticLunaImageDurableReadbackV1(input: Readonly<{
  packageData: unknown
  acceptedAssets: readonly JsonRecord[]
}>) {
  const packageData = record(input.packageData)
  const readiness = record(packageData.supplierImageReadiness)
  const imageUrls = Array.isArray(packageData.imageUrls)
    ? packageData.imageUrls.map((value) => text(value, 2_000)).filter(Boolean)
    : []
  const manifest = Array.isArray(packageData.imageAssetManifest)
    ? packageData.imageAssetManifest.map(record)
    : []
  const accepted = input.acceptedAssets.map((asset) => ({
    id: uuid(asset.id),
    status: text(asset.status, 50),
    publicUrl: text(asset.public_url, 2_000),
    outputSha256: text(asset.output_sha256, 64),
    publishedStoragePath: text(asset.published_storage_path, 1_000),
    qa: record(asset.qa_result),
  }))
  const acceptedIds = new Set(accepted.map((asset) => asset.id).filter(Boolean))
  const manifestIds = new Set(manifest.map((asset) => uuid(asset.assetId))
    .filter(Boolean))
  const manifestUrls = manifest.map((asset) => text(asset.url, 2_000))
  const exactDurableAssets = accepted.length > 0 &&
    acceptedIds.size === accepted.length &&
    accepted.every((asset) => asset.status === "approved" &&
      Boolean(asset.publicUrl) && Boolean(asset.publishedStoragePath) &&
      /^[0-9a-f]{64}$/.test(asset.outputSha256) &&
      asset.qa.approvalMode === "AUTOMATIC_DETERMINISTIC" &&
      asset.qa.imageReadiness === "IMAGE_READY_AUTO_PASS")
  const exactPackageBinding = imageUrls.length === accepted.length &&
    manifest.length === accepted.length &&
    new Set(imageUrls).size === accepted.length &&
    manifestIds.size === accepted.length &&
    acceptedIds.size === manifestIds.size &&
    [...acceptedIds].every((id) => manifestIds.has(id)) &&
    accepted.every((asset) => manifest.some((entry) =>
      uuid(entry.assetId) === asset.id &&
      text(entry.url, 2_000) === asset.publicUrl &&
      text(entry.sha256, 64) === asset.outputSha256)) &&
    imageUrls.every((url, index) => manifestUrls[index] === url)
  const exactReadiness = readiness.version ===
      "LUNA_SUPPLIER_IMAGE_AUTO_READY_V1" &&
    readiness.authorityVersion === AUTHORITY_VERSION &&
    readiness.imageRights === "PASS_INHERITED" &&
    readiness.imageOptimization === "AUTO_PASS" &&
    readiness.imageReady === true &&
    readiness.humanImageActionRequired === false &&
    Number(readiness.validCompliantImageCount) === accepted.length
  if (!exactDurableAssets || !exactPackageBinding || !exactReadiness) {
    throw new Error("LUNA_IMAGE_DURABLE_RUNTIME_READBACK_MISMATCH")
  }
  return {
    validCompliantImageCount: accepted.length,
    durableImageAssetReadback: "PASS" as const,
    finalPublicationPreflightImageCountMatch: true as const,
  }
}

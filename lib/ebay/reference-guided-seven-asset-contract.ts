export const REFERENCE_GUIDED_SEVEN_ASSET_ROLES = [
  "PRIMARY_MAIN",
  "SECONDARY_MATERIAL_DETAIL",
  "SECONDARY_PACKAGE_CONTENTS",
  "SECONDARY_SCALE_CAPACITY",
  "SECONDARY_USE_CONTEXT",
  "SECONDARY_ASPIRATIONAL_LIFESTYLE",
  "SECONDARY_HUMAN_CONTEXT",
] as const

export type ReferenceGuidedSevenAssetRole =
  typeof REFERENCE_GUIDED_SEVEN_ASSET_ROLES[number]

export const REFERENCE_GUIDED_SECONDARY_JOB_ROLE = {
  1: "SECONDARY_MATERIAL_DETAIL",
  2: "SECONDARY_PACKAGE_CONTENTS",
  3: "SECONDARY_SCALE_CAPACITY",
  4: "SECONDARY_USE_CONTEXT",
  5: "SECONDARY_ASPIRATIONAL_LIFESTYLE",
  6: "SECONDARY_HUMAN_CONTEXT",
} as const

export function orderReferenceGuidedAssetsForEbay(input: Array<{
  role: ReferenceGuidedSevenAssetRole
  url: string
}>) {
  if (input.length !== 7 || new Set(input.map((asset) => asset.role)).size !== 7 ||
    input.some((asset) => !asset.url.startsWith("https://"))) {
    throw new Error("REFERENCE_GUIDED_SEVEN_ASSET_CONTRACT_INVALID")
  }
  const byRole = new Map(input.map((asset) => [asset.role, asset]))
  const ordered = REFERENCE_GUIDED_SEVEN_ASSET_ROLES.map((role) => byRole.get(role))
  if (ordered.some((asset) => !asset)) {
    throw new Error("REFERENCE_GUIDED_SEVEN_ASSET_CONTRACT_INVALID")
  }
  return ordered.map((asset) => asset!.url)
}

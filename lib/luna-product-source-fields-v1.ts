// Capture only explicitly exposed product attributes, never vendor->brand,
// visual inference, arbitrary metadata, customer information or reference data.
export function captureLunaExplicitProductFieldsV1(value: unknown) {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {}
  const allowed = ["brand", "model", "mpn", "material", "color", "colour",
    "dimensions", "size_set", "package_contents", "pack_quantity", "set_count",
    "form_factor", "features", "intended_uses", "options"]
  return Object.fromEntries(allowed.filter((key) => Object.hasOwn(source, key) &&
    source[key] !== undefined && source[key] !== null).map((key) => [key, source[key]]))
}

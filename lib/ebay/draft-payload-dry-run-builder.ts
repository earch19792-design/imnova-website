type PayloadInputRecord = Record<string, unknown>

function asRecord(input: unknown): PayloadInputRecord {
  if (
    input &&
    typeof input === "object" &&
    !Array.isArray(input)
  ) {
    return input as PayloadInputRecord
  }

  return {}
}

function hasValue(value: unknown): boolean {
  if (typeof value === "string") {
    return value.trim().length > 0
  }

  if (typeof value === "number") {
    return Number.isFinite(value)
  }

  if (typeof value === "boolean") {
    return true
  }

  if (Array.isArray(value)) {
    return value.length > 0
  }

  return Boolean(value)
}

export function buildDraftPayloadDryRun(input?: unknown) {
  const record =
    asRecord(input)

  const title =
    hasValue(record.titlePreview)
      ? record.titlePreview
      : hasValue(record.title)
        ? record.title
        : null

  const description =
    hasValue(record.descriptionPreview)
      ? record.descriptionPreview
      : hasValue(record.description)
        ? record.description
        : null

  const itemSpecifics =
    Array.isArray(record.itemSpecifics)
      ? record.itemSpecifics
      : Array.isArray(record.itemSpecificsPreview)
        ? record.itemSpecificsPreview
        : []

  return {
    payloadMode:
      "LOCAL_DRY_RUN_NOT_EBAY_API_PAYLOAD",
    payloadBuilt:
      true,
    submittedToEbay:
      false,
    readyForEbayApi:
      false,
    readyForDraftCreation:
      false,
    readyForPublication:
      false,
    contains: {
      title:
        Boolean(title),
      description:
        Boolean(description),
      itemSpecifics:
        itemSpecifics.length > 0,
      category:
        false,
      price:
        false,
      shipping:
        false,
      returns:
        false,
      images:
        false,
    },
    blockedUntilConfirmed: [
      "category",
      "price",
      "shipping_policy",
      "return_policy",
      "image_package",
      "compliance",
      "ebay_connection",
    ],
  }
}

export function getDraftPayloadDryRunSummary() {
  return {
    draftPayloadStatus:
      "DRAFT_PAYLOAD_DRY_RUN_READY_NOT_SUBMITTED",
    payloadMode:
      "LOCAL_DRY_RUN_NOT_EBAY_API_PAYLOAD",
    payloadBuilt:
      true,
    submittedToEbay:
      false,
    readyForEbayApi:
      false,
    readyForDraftCreation:
      false,
    readyForPublication:
      false,
  }
}

export function getBlockedDraftPayloadResponse() {
  return {
    payloadMode:
      "LOCAL_DRY_RUN_NOT_EBAY_API_PAYLOAD",
    payloadBuilt:
      true,
    submittedToEbay:
      false,
    readyForEbayApi:
      false,
    readyForDraftCreation:
      false,
    readyForPublication:
      false,
    draftImpact:
      "DO_NOT_CREATE_EBAY_DRAFT",
    publicationImpact:
      "DO_NOT_PUBLISH",
  }
}

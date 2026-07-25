import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  ebayConditionContractFromVerifiedFact,
  evaluateManualListingProductSkuIdentity,
  evaluateReadonlyListingOwnership,
  normalizeManualListingUrl,
  parseManualListingRegistrationInput,
  parseSafeListingDefaults,
  safeDefaultsTemplateKey,
  safeDefaultsTemplatePriorityKeys,
} from "./ebay-manual-listing-domain.ts"
import {
  ebayProductionAccountFingerprint,
  getEbaySellerAccountScopeConfiguration,
} from "./ebay-seller-account-scope.ts"

const itemId = "123456789012"
const opportunityId = "123e4567-e89b-42d3-a456-426614174000"

test("normaliza una solicitud válida sin contenido comercial reutilizable", () => {
  const parsed = parseManualListingRegistrationInput({
    ebayItemId: itemId,
    ebayUrl: `https://www.ebay.com/itm/producto/${itemId}?campid=tracking`,
    opportunityId,
    supplierSku: " ITEM5126 ",
    safeDefaults: {
      categoryId: "261003",
      conditionId: "1000",
      fulfillmentPolicyId: "123456",
      paymentPolicyId: "payment-1",
      returnPolicyId: "return-1",
    },
  })

  assert.equal(parsed.ebayUrl, `https://www.ebay.com/itm/${itemId}`)
  assert.equal(parsed.supplierSku, "ITEM5126")
  assert.deepEqual(parsed.safeDefaults, {
    categoryId: "261003",
    conditionId: "1000",
    fulfillmentPolicyId: "123456",
    paymentPolicyId: "payment-1",
    returnPolicyId: "return-1",
  })
})

test("rechaza Item IDs no numéricos y URLs que pertenecen a otro item", () => {
  assert.throws(
    () => parseManualListingRegistrationInput({
      ebayItemId: "abc123",
      opportunityId,
      safeDefaults: {},
    }),
    /MANUAL_LISTING_ITEM_ID_INVALID/,
  )
  assert.throws(
    () => normalizeManualListingUrl(
      itemId,
      "https://www.ebay.com/itm/999999999999",
    ),
    /MANUAL_LISTING_URL_ITEM_MISMATCH/,
  )
  assert.throws(
    () => normalizeManualListingUrl(
      itemId,
      `https://ebay.com.attacker.example/itm/${itemId}`,
    ),
    /MANUAL_LISTING_URL_INVALID/,
  )
})

test("la allowlist bloquea descripción, imágenes, claims y valores de aspectos", () => {
  for (const unsafeField of [
    "title",
    "description",
    "images",
    "claims",
    "aspectValues",
    "merchantLocationKey",
    "categorySchemaVersion",
    "dimensionUnit",
    "weightUnit",
    "condition",
  ]) {
    assert.throws(
      () => parseSafeListingDefaults({ [unsafeField]: "no copiar" }),
      /MANUAL_LISTING_UNSAFE_DEFAULT_FIELD/,
    )
  }
})

test("verified falla cerrado si el conector no está configurado", () => {
  const result = evaluateReadonlyListingOwnership([], {
    ebayItemId: itemId,
    accountKey: "official",
    connectorConfigured: false,
    connectorAttempted: false,
  })
  assert.equal(result.status, "pending_manual_verification")
  assert.equal(result.method, "NOT_EXECUTED")
  assert.equal(result.connectorListingId, null)
})

test("un Item propio sólo se vincula si su Custom label coincide con el paquete", () => {
  const expected = "IMNOVA123E4567E89B42D3A456426614174000"
  assert.deepEqual(
    evaluateManualListingProductSkuIdentity(expected, expected),
    { verified: true, reason: "PRODUCT_SKU_IDENTITY_CONFIRMED" },
  )
  assert.equal(
    evaluateManualListingProductSkuIdentity(expected, null).reason,
    "EBAY_ITEM_CUSTOM_LABEL_REQUIRED",
  )
  assert.equal(
    evaluateManualListingProductSkuIdentity(expected, "ITEM5126").reason,
    "EBAY_ITEM_CUSTOM_LABEL_MISMATCH",
  )
  assert.equal(
    evaluateManualListingProductSkuIdentity(null, expected).reason,
    "EBAY_CANONICAL_LISTING_PACKAGE_REQUIRED",
  )
})

test("el scope de datos cambia con la identidad oficial y nunca usa default", () => {
  const previous = {
    alias: process.env.EBAY_SELLER_ACCOUNT_KEY,
    userId: process.env.EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_USER_ID,
    fingerprint:
      process.env.EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_ACCOUNT_FINGERPRINT,
    credentialFingerprint:
      process.env.EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_CREDENTIAL_FINGERPRINT,
  }
  try {
    process.env.EBAY_SELLER_ACCOUNT_KEY = "official-store"
    process.env.EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_USER_ID = "seller-one"
    delete process.env.EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_CREDENTIAL_FINGERPRINT
    delete process.env.EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_ACCOUNT_FINGERPRINT
    const first = getEbaySellerAccountScopeConfiguration()
    assert.equal(first.configured, true)
    assert.equal(
      first.accountKey,
      `official-store:${ebayProductionAccountFingerprint("seller-one")}`,
    )

    process.env.EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_USER_ID = "seller-two"
    const second = getEbaySellerAccountScopeConfiguration()
    assert.notEqual(second.accountKey, first.accountKey)

    delete process.env.EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_USER_ID
    process.env.EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_ACCOUNT_FINGERPRINT = "invalid"
    assert.equal(
      getEbaySellerAccountScopeConfiguration().reason,
      "OFFICIAL_ACCOUNT_IDENTITY_INCONSISTENT",
    )

    delete process.env.EBAY_SELLER_ACCOUNT_KEY
    assert.equal(
      getEbaySellerAccountScopeConfiguration().reason,
      "ACCOUNT_KEY_REQUIRED",
    )
  } finally {
    if (previous.alias === undefined) delete process.env.EBAY_SELLER_ACCOUNT_KEY
    else process.env.EBAY_SELLER_ACCOUNT_KEY = previous.alias
    if (previous.userId === undefined) {
      delete process.env.EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_USER_ID
    } else {
      process.env.EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_USER_ID = previous.userId
    }
    if (previous.fingerprint === undefined) {
      delete process.env.EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_ACCOUNT_FINGERPRINT
    } else {
      process.env.EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_ACCOUNT_FINGERPRINT =
        previous.fingerprint
    }
    if (previous.credentialFingerprint === undefined) {
      delete process.env.EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_CREDENTIAL_FINGERPRINT
    } else {
      process.env.EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_CREDENTIAL_FINGERPRINT =
        previous.credentialFingerprint
    }
  }
})

test("sólo una coincidencia exacta del conector oficial puede verificar propiedad", () => {
  const untrustedRows = [
    {
      id: "11111111-1111-4111-8111-111111111111",
      source: "manual",
      account_key: "official",
      ebay_item_id: itemId,
      listing_status: "active",
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      source: "EBAY_SELL_INVENTORY_READONLY",
      account_key: "other-account",
      ebay_item_id: itemId,
      listing_status: "active",
    },
  ]
  const pending = evaluateReadonlyListingOwnership(untrustedRows, {
    ebayItemId: itemId,
    accountKey: "official",
    connectorConfigured: true,
    connectorAttempted: true,
  })
  assert.equal(pending.status, "pending_manual_verification")

  const verified = evaluateReadonlyListingOwnership([
    ...untrustedRows,
    {
      id: "33333333-3333-4333-8333-333333333333",
      source: "EBAY_SELL_INVENTORY_READONLY",
      account_key: "official",
      ebay_item_id: itemId,
      listing_status: "active",
      ebay_sku: "ITEM5126",
    },
  ], {
    ebayItemId: itemId,
    accountKey: "official",
    connectorConfigured: true,
    connectorAttempted: true,
  })
  assert.equal(verified.status, "verified")
  assert.equal(
    verified.connectorListingId,
    "33333333-3333-4333-8333-333333333333",
  )
  assert.equal(verified.connectorEbaySku, "ITEM5126")
})

test("la clave de plantilla separa categoría y condición", () => {
  assert.equal(
    safeDefaultsTemplateKey({ categoryId: "261003", conditionId: "1000" }),
    "EBAY_US:261003:1000",
  )
  assert.equal(
    safeDefaultsTemplateKey({}),
    "EBAY_US:all-categories:all-conditions",
  )
})

test("la selección prioriza categoría y condición exactas antes de genéricos", () => {
  assert.deepEqual(
    safeDefaultsTemplatePriorityKeys("261003", "1000"),
    [
      "EBAY_US:261003:1000",
      "EBAY_US:261003:all-conditions",
      "EBAY_US:all-categories:1000",
      "EBAY_US:all-categories:all-conditions",
    ],
  )
  assert.throws(
    () => safeDefaultsTemplatePriorityKeys("competitor-category", "1000"),
    /MANUAL_LISTING_CATEGORY_ID_INVALID/,
  )
})

test("el contrato de condición traduce únicamente inventario nuevo verificado a eBay 1000", () => {
  assert.deepEqual(ebayConditionContractFromVerifiedFact("New"), {
    conditionId: "1000",
    canonicalLabel: "New",
    marketplaceId: "EBAY_US",
  })
  assert.equal(ebayConditionContractFromVerifiedFact(" Nuevo ")?.conditionId, "1000")
  assert.equal(ebayConditionContractFromVerifiedFact("Used"), null)
  assert.equal(ebayConditionContractFromVerifiedFact("Seller refurbished"), null)
})

test("una reverificación pendiente desactiva la plantilla anterior", () => {
  const migration = readFileSync(
    new URL(
      "../../supabase/migrations/20260713071000_create_ebay_manual_listing_registration.sql",
      import.meta.url,
    ),
    "utf8",
  )
  assert.match(migration, /p_verification_status <> 'verified'/)
  assert.match(migration, /status = 'superseded'/)
  assert.match(migration, /source_link_id = v_link\.id/)
  assert.match(
    migration,
    /verification_status = 'verified'\s+and excluded\.verification_status = 'verified'\s+then public\.ebay_manual_listing_links\.verified_at/,
  )

  const scopeMigration = readFileSync(
    new URL(
      "../../supabase/migrations/20260713073000_scope_ebay_seller_whatsapp_claims.sql",
      import.meta.url,
    ),
    "utf8",
  )
  assert.match(scopeMigration, /quarantine_ebay_manual_listing_after_failed_reverification/)
  assert.match(scopeMigration, /listing_status = case/)
  assert.match(scopeMigration, /'ended'/)
  assert.match(scopeMigration, /'unknown'/)
  assert.match(scopeMigration, /ownershipVerified', false/)
})

test("evidencia, vínculo y defaults verificados se guardan sin confiar en el browser", () => {
  const migration = readFileSync(
    new URL(
      "../../supabase/migrations/20260713071000_create_ebay_manual_listing_registration.sql",
      import.meta.url,
    ),
    "utf8",
  )
  const service = readFileSync(
    new URL("./ebay-manual-listing-service.ts", import.meta.url),
    "utf8",
  )
  assert.ok(
    migration.indexOf("insert into public.ebay_active_listings") <
      migration.indexOf("insert into public.ebay_manual_listing_links"),
  )
  assert.match(migration, /MANUAL_LISTING_EBAY_SKU_MISMATCH/)
  assert.match(migration, /on conflict \(sync_key\) do update/)
  assert.doesNotMatch(service, /p_connector_listing_id/)
  assert.match(service, /verification\.learnedSafeDefaults/)
  assert.match(service, /declaredDefaultsActivated: false/)
  assert.match(service, /reverifyManualEbayListingsReadonly/)
  assert.match(service, /last_verification_at/)
  assert.match(service, /EBAY_MANUAL_LISTING_REVERIFICATION_MAX_AGE_HOURS/)
  assert.doesNotMatch(
    migration,
    /coalesce\(excluded\.fulfillment_policy_id,\s*public\.ebay_seller_listing_templates/,
  )
})

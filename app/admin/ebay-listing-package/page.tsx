import type {
  ReactNode,
} from "react"
import listingPackage from "../../../tools/fixtures/ebay-first-listing-package-v1.json"
import draftMappingDryRun from "../../../tools/fixtures/ebay-draft-mapping-dry-run-v1.json"
import firstListingContentFinalization from "../../../tools/fixtures/ebay-first-listing-content-finalization-v1.json"
import listingGeneratorDryRun from "../../../tools/fixtures/ebay-listing-generator-service-dry-run-v1.json"
import productListingBridge from "../../../tools/fixtures/ebay-product-to-listing-bridge-draft-preview-v1.json"
import firstListingDraftPreview from "../../../tools/fixtures/ebay-first-listing-draft-preview-v1.json"
import productSourceAdapterSelector from "../../../tools/fixtures/ebay-product-source-adapter-selector-v1.json"
import liveProductSelectorReadOnly from "../../../tools/fixtures/ebay-live-product-selector-read-only-v1.json"
import realProductListingGeneratorIntegration from "../../../tools/fixtures/ebay-real-product-listing-generator-integration-v1.json"
import lunaPortexCatalogImagePackageQa from "../../../tools/fixtures/ebay-luna-portex-catalog-image-package-qa-v1.json"
import completeListingPackageBuilder from "../../../tools/fixtures/ebay-complete-listing-package-builder-v1.json"
import listingCompletionWorkspace from "../../../tools/fixtures/ebay-listing-completion-workspace-v1.json"
import ebaySecretEnvironmentStrategy from "../../../tools/fixtures/ebay-secret-environment-strategy-v1.json"
import ebayImageGenerationServiceDesign from "../../../tools/fixtures/ebay-image-generation-service-design-v1.json"
import ebayOnlyConnectionDesign from "../../../tools/fixtures/ebay-only-connection-design-v1.json"
import ebaySandboxIntegrationReadiness from "../../../tools/fixtures/ebay-sandbox-integration-readiness-v1.json"
import ebaySandboxCredentialsEnvConfiguration from "../../../tools/fixtures/ebay-sandbox-credentials-env-configuration-v1.json"
import ebaySandboxOauthScaffold from "../../../tools/fixtures/ebay-sandbox-oauth-scaffold-v1.json"
import ebaySandboxOauthFlowDesign from "../../../tools/fixtures/ebay-sandbox-oauth-flow-design-v1.json"
import ebaySandboxReadOnlyConnectionStatus from "../../../tools/fixtures/ebay-sandbox-read-only-connection-status-v1.json"
import listingPackageSourceAwareRefresh from "../../../tools/fixtures/ebay-listing-package-source-aware-refresh-v1.json"
import productSnapshot from "../../../tools/fixtures/ebay-luna-portex-product-snapshot-v1.json"
import productFactsReadinessGate from "../../../tools/fixtures/ebay-luna-portex-product-facts-readiness-gate-v1.json"
import commercialReadinessGate from "../../../tools/fixtures/ebay-luna-portex-commercial-readiness-gate-v1.json"
import imageAssetManifest from "../../../tools/fixtures/ebay-luna-portex-image-asset-manifest-v1.json"
import imageQaReviewGate from "../../../tools/fixtures/ebay-luna-portex-image-qa-review-gate-v1.json"
import mainImageEnhancementBrief from "../../../tools/fixtures/ebay-luna-portex-main-image-enhancement-brief-v1.json"
import imageSourceIntake from "../../../tools/fixtures/ebay-luna-portex-image-source-intake-v1.json"
import imageSourceReviewGate from "../../../tools/fixtures/ebay-luna-portex-image-source-review-gate-v1.json"
import qaReview from "../../../tools/fixtures/ebay-first-listing-qa-review-v1.json"

const safetyBadges = [
  "Preview read-only",
  "Sin conexion eBay",
  "Sin draft creado",
  "No publicar",
  "Revision humana requerida",
]

const executiveBlockers = [
  "Falta validar Terapeak",
  "Falta benchmark de ventas comparables",
  "Falta imagen autorizada de Luna Portex",
  "Pendiente imagen principal con fondo blanco",
  "Pendiente QA de imagen principal",
  "Shipping y devoluciones sin confirmar",
  "Precio y margen sin validar",
]

const imageAssetManifestCopy = {
  manifestStatus:
    "IMAGE_ASSETS_NEED_SOURCE",
  publicationImpact:
    "DO_NOT_CREATE_DRAFT_UNTIL_IMAGE_QA_APPROVED",
  sourceLabel:
    "Authorized Luna Portex catalog image",
  currentStep:
    "Waiting for authorized Luna Portex catalog image",
  enhancementStatus:
    "White-background enhancement pending",
  qaStatus:
    "Image QA required",
  draftGate:
    "Draft gate: blocked until image QA approved",
  secondarySlotRoles: [
    "material_zoom",
    "package_contents",
    "dimensions",
    "main_benefit_in_action",
    "aspirational_lifestyle",
    "hands_real_use",
  ],
}

const productSnapshotCopy = {
  title:
    "Luna Portex Product Snapshot",
  snapshotStatus:
    "PRODUCT_SNAPSHOT_NEEDS_VALIDATION",
  listingImpact:
    "LISTING_BLOCKED_UNTIL_PRODUCT_SNAPSHOT_VALIDATED",
  sourceProvider:
    "Source provider: Luna Portex",
  sourceType:
    "Source type: supplier catalog product",
  catalogReference:
    "Catalog reference required",
  productFacts:
    "Product facts need validation",
  commercialInputs:
    "Commercial inputs required",
  operationsInputs:
    "Operations inputs required",
  imageInputs:
    "Image source and QA required",
  complianceAndRisk:
    "Compliance review required",
  currentDecision:
    "Current decision: request product snapshot data",
}

const productSnapshotFieldGroups: Array<{
  title: string
  fields: Record<string, unknown>
}> = [
  {
    title:
      "Catalog reference",
    fields:
      productSnapshot.catalogReference,
  },
  {
    title:
      "Product identity",
    fields:
      productSnapshot.productIdentity,
  },
  {
    title:
      "Product facts",
    fields:
      productSnapshot.productFacts,
  },
  {
    title:
      "Commercial inputs",
    fields:
      productSnapshot.commercialInputs,
  },
  {
    title:
      "Operations inputs",
    fields:
      productSnapshot.operationsInputs,
  },
  {
    title:
      "Image inputs",
    fields:
      productSnapshot.imageInputs,
  },
  {
    title:
      "Compliance and risk",
    fields:
      productSnapshot.complianceAndRisk,
  },
  {
    title:
      "Validation gates",
    fields:
      productSnapshot.validationGates,
  },
]

const productFactsReadinessGateCopy = {
  title:
    "Product Facts Readiness Gate",
  gateStatus:
    "PRODUCT_FACTS_NOT_READY",
  gateDecision:
    "BLOCK_LISTING_PIPELINE",
  listingImpact:
    "LISTING_BLOCKED_UNTIL_PRODUCT_FACTS_VALIDATED",
  draftImpact:
    "DO_NOT_CREATE_EBAY_DRAFT",
  summary:
    "Product facts are not validated yet",
  humanReviewRequired:
    "Human product facts review required",
  currentDecision:
    "Current decision: request more product facts",
  factCheckLabels: [
    "Catalog reference confirmed",
    "Product title confirmed",
    "Brand confirmed",
    "Category confirmed",
    "Condition confirmed",
    "Dimensions confirmed",
    "Weight confirmed",
    "Material confirmed",
    "Package contents confirmed",
    "Quantity confirmed",
    "Compatibility review completed",
    "Claims review completed",
  ],
}

const commercialReadinessGateCopy = {
  title:
    "Commercial Readiness Gate",
  gateStatus:
    "COMMERCIAL_READINESS_NOT_APPROVED",
  gateDecision:
    "BLOCK_EBAY_DRAFT",
  listingImpact:
    "LISTING_BLOCKED_UNTIL_COMMERCIAL_INPUTS_VALIDATED",
  draftImpact:
    "DO_NOT_CREATE_EBAY_DRAFT",
  summary:
    "Commercial readiness is not approved yet",
  humanReviewRequired:
    "Human commercial review required",
  currentDecision:
    "Current decision: request more commercial inputs",
  commercialCheckLabels: [
    "Product cost confirmed",
    "Supplier fees confirmed",
    "eBay fee estimate confirmed",
    "Shipping cost confirmed",
    "Return risk reviewed",
    "Target margin confirmed",
    "Margin validated",
    "Terapeak validation completed",
    "Sold listings benchmark completed",
    "Availability confirmed",
    "Shipping policy confirmed",
    "Return policy confirmed",
  ],
}

const listingPackageSourceAwareRefreshCopy = {
  title:
    "Listing Package Source-Aware Refresh",
  refreshStatus:
    "SOURCE_AWARE_REFRESH_BLOCKED",
  refreshDecision:
    "DO_NOT_REFRESH_LISTING_PACKAGE_YET",
  draftImpact:
    "DO_NOT_CREATE_EBAY_DRAFT",
  publicationImpact:
    "DO_NOT_PUBLISH",
  sourceProductLinked:
    "Source product linked",
  sourceAwareRefreshBlocked:
    "Source-aware refresh blocked",
  nextRecommendedLoop:
    "Next recommended loop: LOOP 107 — Image QA Review Gate V1",
}

const listingPackageSourceAwareGateLabels = {
  product_snapshot: "Luna Portex Product Snapshot",
  product_facts: "Product Facts Readiness Gate",
  commercial_readiness: "Commercial Readiness Gate",
  image_source_review: "Image Source Review Gate",
  main_image_enhancement: "Main Image Enhancement Brief",
  listing_qa: "Listing QA Review",
}

const ebayOnlyConnectionDesignCopy = {
  title:
    "eBay Only Connection Design",
  connectionStatus:
    "EBAY_CONNECTION_NOT_STARTED",
  connectionDecision:
    "DESIGN_ONLY_DO_NOT_CONNECT",
  environmentStrategy:
    "SANDBOX_FIRST",
  authStatus:
    "OAUTH_NOT_CONFIGURED",
  draftImpact:
    "DO_NOT_CREATE_EBAY_DRAFT",
  publicationImpact:
    "DO_NOT_PUBLISH",
  connectionSummary:
    "eBay connection has not started",
  sandboxFirst:
    "Sandbox-first connection plan",
  noOauth:
    "No OAuth flow has been implemented",
  noTokens:
    "No tokens are stored",
  noApiCalls:
    "No eBay API calls are allowed",
  officialValidation:
    "Official eBay documentation validation required",
  nextRecommendedLoop:
    "Next recommended loop: LOOP 109 — eBay Sandbox Read-Only Connection Status V1",
}

const ebaySandboxReadOnlyConnectionStatusCopy = {
  title:
    "eBay Sandbox Read-Only Connection Status",
  connectionStatus:
    "SANDBOX_CONNECTION_NOT_CONFIGURED",
  readOnlyStatus:
    "READ_ONLY_CHECK_NOT_EXECUTED",
  authStatus:
    "OAUTH_NOT_CONFIGURED",
  tokenStatus:
    "NO_TOKENS_CONFIGURED",
  apiStatus:
    "NO_API_CALLS_MADE",
  draftImpact:
    "DO_NOT_CREATE_EBAY_DRAFT",
  publicationImpact:
    "DO_NOT_PUBLISH",
  statusSummary:
    "Sandbox read-only connection status is not configured",
  noOauth:
    "No OAuth has been implemented",
  noCredentials:
    "No credentials or tokens exist",
  noApiCalls:
    "No eBay API calls have been made",
  officialValidation:
    "Official eBay documentation validation required",
  nextRecommendedLoop:
    "Next recommended loop: LOOP 110 — Image Generation Service Design V1",
}

const ebaySandboxIntegrationReadinessCopy = {
  title:
    "eBay Sandbox Integration Readiness",
  integrationStatus:
    "SANDBOX_INTEGRATION_NOT_READY",
  integrationDecision:
    "COLLECT_REQUIREMENTS_DO_NOT_CONNECT",
  environmentStrategy:
    "SANDBOX_FIRST_PRODUCTION_BLOCKED",
  credentialStatus:
    "NO_CREDENTIALS_CONFIGURED",
  authStatus:
    "OAUTH_NOT_IMPLEMENTED",
  secretStatus:
    "SECRET_STRATEGY_NOT_APPROVED",
  scopeStatus:
    "SCOPES_NOT_VALIDATED",
  redirectStatus:
    "REDIRECT_CONFIGURATION_NOT_VALIDATED",
  apiStatus:
    "NO_EBAY_API_CALLS_MADE",
  draftImpact:
    "DO_NOT_CREATE_EBAY_DRAFT",
  publicationImpact:
    "DO_NOT_PUBLISH",
  readinessSummary:
    "Sandbox integration is not ready",
  developerCredentials:
    "Developer credentials identify the IMNOVA eBay app",
  neverStoreSellerPasswords:
    "IMNOVA must never store seller passwords",
  officialValidation:
    "Official eBay documentation validation required",
  nextRecommendedLoop:
    "Next recommended loop: LOOP 112 — eBay Sandbox OAuth Flow Design V1",
}

const ebaySandboxOauthFlowDesignCopy = {
  title:
    "eBay Sandbox OAuth Flow Design",
  oauthStatus:
    "OAUTH_FLOW_NOT_IMPLEMENTED",
  oauthDecision:
    "DESIGN_ONLY_DO_NOT_START_OAUTH",
  sellerAuthorizationStatus:
    "SELLER_AUTHORIZATION_NOT_STARTED",
  credentialStatus:
    "NO_CREDENTIALS_CONFIGURED",
  redirectStatus:
    "REDIRECT_CONFIGURATION_NOT_VALIDATED",
  scopeStatus:
    "SCOPES_NOT_VALIDATED",
  tokenStatus:
    "NO_TOKENS_CONFIGURED",
  apiStatus:
    "NO_EBAY_API_CALLS_MADE",
  draftImpact:
    "DO_NOT_CREATE_EBAY_DRAFT",
  publicationImpact:
    "DO_NOT_PUBLISH",
  oauthSummary:
    "Sandbox OAuth flow is not implemented",
  sellerConsent:
    "Seller authorization has not started",
  developerCredentials:
    "Developer credentials identify the IMNOVA eBay app",
  sellerAuthorizes:
    "The seller account authorizes the app later through OAuth",
  neverStoreSellerPasswords:
    "IMNOVA must never store seller passwords",
  nextRecommendedLoop:
    "Next recommended loop: LOOP 113 — eBay Secret and Environment Strategy V1",
}

const ebaySecretEnvironmentStrategyCopy = {
  title:
    "eBay Secret and Environment Strategy",
  environmentStrategy:
    "SANDBOX_FIRST_SERVER_ONLY",
  strategyStatus:
    "SECRET_ENVIRONMENT_STRATEGY_DESIGN_ONLY",
  strategyDecision:
    "DO_NOT_CONFIGURE_SECRETS_YET",
  credentialStatus:
    "NO_CREDENTIALS_CONFIGURED",
  secretStatus:
    "NO_SECRETS_CONFIGURED",
  tokenStatus:
    "NO_TOKENS_CONFIGURED",
  storageStatus:
    "TOKEN_STORAGE_NOT_IMPLEMENTED",
  logStatus:
    "LOG_REDACTION_NOT_IMPLEMENTED",
  productionStatus:
    "PRODUCTION_BLOCKED",
  draftImpact:
    "DO_NOT_CREATE_EBAY_DRAFT",
  publicationImpact:
    "DO_NOT_PUBLISH",
  strategySummary:
    "Secret and environment strategy is design-only",
  secretsNeverCommitted:
    "Secrets must never be committed",
  secretsNeverFrontend:
    "Secrets must never be exposed to frontend",
  neverStoreSellerPasswords:
    "IMNOVA must never request or store seller passwords",
  nextRecommendedLoop:
    "Next recommended loop: LOOP 114 — eBay Sandbox OAuth Scaffold V1",
}

const ebaySandboxOauthScaffoldCopy = {
  title:
    "eBay Sandbox OAuth Scaffold",
  scaffoldStatus:
    "OAUTH_SCAFFOLD_READY_BUT_DISABLED",
  scaffoldDecision:
    "SCAFFOLD_ONLY_DO_NOT_START_OAUTH",
  implementationMode:
    "DISABLED_STUBS_ONLY",
  routeStatus:
    "STUB_ROUTES_BLOCKED",
  authUrlStatus:
    "NO_AUTH_URL_GENERATED",
  callbackStatus:
    "CALLBACK_STUB_DOES_NOT_PROCESS_CODES",
  tokenStatus:
    "NO_TOKENS_CONFIGURED",
  apiStatus:
    "NO_EBAY_API_CALLS_MADE",
  draftImpact:
    "DO_NOT_CREATE_EBAY_DRAFT",
  publicationImpact:
    "DO_NOT_PUBLISH",
  scaffoldSummary:
    "Sandbox OAuth scaffold exists but is disabled",
  noAuthUrl:
    "No auth URL is generated",
  noCallbackProcessing:
    "Callback route must not process authorization codes",
  noEnvironmentReads:
    "No environment variables are read",
  nextRecommendedLoop:
    "Next recommended loop: LOOP 115 — eBay Sandbox Credentials / Env Configuration V1",
}

const ebaySandboxCredentialsEnvConfigurationCopy = {
  title:
    "eBay Sandbox Credentials / Env Configuration",
  configurationStatus:
    "SANDBOX_ENV_CONFIGURATION_NOT_READY",
  configurationDecision:
    "CHECK_ENV_PRESENCE_ONLY_DO_NOT_CONNECT",
  serverOnlyStatus:
    "SERVER_ONLY_ENV_CHECK_REQUIRED",
  credentialStatus:
    "NO_CREDENTIAL_VALUES_CONFIGURED",
  secretStatus:
    "NO_SECRET_VALUES_EXPOSED",
  tokenStatus:
    "NO_TOKENS_CONFIGURED",
  oauthStatus:
    "OAUTH_STILL_DISABLED",
  apiStatus:
    "NO_EBAY_API_CALLS_MADE",
  draftImpact:
    "DO_NOT_CREATE_EBAY_DRAFT",
  publicationImpact:
    "DO_NOT_PUBLISH",
  configurationSummary:
    "Sandbox credential/env configuration is not ready",
  presenceOnly:
    "Env status may expose presence/absence only",
  neverReturnValues:
    "Never return values",
  nextRecommendedLoop:
    "Next recommended loop: LOOP 116 — eBay Sandbox OAuth Authorization V1",
}

const ebayListingCompletionWorkspaceCopy = {
  title:
    "eBay Listing Completion Workspace",
  workspaceStatus:
    "LISTING_NOT_READY_FOR_DRAFT",
  workspaceDecision:
    "COMPLETE_MISSING_INPUTS_BEFORE_DRAFT",
  draftImpact:
    "DO_NOT_CREATE_EBAY_DRAFT",
  publicationImpact:
    "DO_NOT_PUBLISH",
  productFacts:
    "Product Facts",
  commercialReadiness:
    "Commercial Readiness",
  marketValidation:
    "Market Validation",
  listingContent:
    "Listing Content",
  imageReadiness:
    "Image Readiness",
  shippingAndReturns:
    "Shipping and Returns",
  riskAndCompliance:
    "Risk and Compliance",
  draftReadiness:
    "Draft Readiness",
  missingCriticalInputs:
    "Missing Critical Inputs",
  nextRecommendedAction:
    "Next Recommended Action",
}

const ebayDraftMappingDryRunCopy = {
  title:
    "eBay Draft Mapping Dry Run",
  mappingStatus:
    "DRAFT_MAPPING_DRY_RUN_BLOCKED",
  mappingDecision:
    "DO_NOT_MAP_TO_EBAY_DRAFT_YET",
  draftImpact:
    "DO_NOT_CREATE_EBAY_DRAFT",
  publicationImpact:
    "DO_NOT_PUBLISH",
  plannedFields:
    "Planned eBay Draft Fields",
  blockedBecause:
    "Blocked Because",
}

const ebayFirstListingContentFinalizationCopy = {
  title:
    "eBay First Listing Content Finalization",
  contentStatus:
    "CONTENT_NOT_READY_FOR_FINAL_DRAFT",
  contentDecision:
    "COMPLETE_AND_VALIDATE_CONTENT_BEFORE_DRAFT",
  keywordPolicyStatus:
    "KEYWORD_INTELLIGENCE_ALLOWED_CONTENT_COPYING_BLOCKED",
  draftImpact:
    "DO_NOT_CREATE_EBAY_DRAFT",
  publicationImpact:
    "DO_NOT_PUBLISH",
  marketIntelligenceRule:
    "Use market intelligence, do not copy competitor content",
  trafficKeywordsRule:
    "Traffic keywords may be used when generic, relevant and true",
  portexFactsRule:
    "Portex facts are required for technical claims",
  contentSections:
    "Content Sections",
  keywordPolicy:
    "Keyword Intelligence Policy",
  plannedListingContent:
    "Planned Listing Content",
  blockedBecause:
    "Blocked Because",
  requiredHumanActions:
    "Required Human Actions",
  nextRecommendedAction:
    "Next Recommended Action",
}

const ebayListingGeneratorDryRunCopy = {
  title:
    "eBay Listing Generator Service Dry Run",
  generatorStatus:
    "LISTING_GENERATOR_DRY_RUN_READY_BUT_BLOCKED",
  generatorDecision:
    "GENERATE_STRUCTURE_ONLY_DO_NOT_FINALIZE_CONTENT",
  dryRunMode:
    "STRUCTURED_DRY_RUN_NO_EXTERNAL_CALLS",
  outputStatus:
    "FINAL_LISTING_CONTENT_NOT_GENERATED",
  draftImpact:
    "DO_NOT_CREATE_EBAY_DRAFT",
  publicationImpact:
    "DO_NOT_PUBLISH",
  productsRule:
    "Products decide what the product is",
  listingRule:
    "Listing decides how the product sells on eBay",
  benchmarkRule:
    "Benchmark decides what is working in the market",
  gatesRule:
    "Gates decide whether the listing can advance",
  marketIntelligenceRule:
    "Use market intelligence, do not copy competitor content",
  trafficKeywordsRule:
    "Traffic keywords may be used when generic, relevant and true",
  portexFactsRule:
    "Portex facts are required for technical claims",
  plannedGenerationOutputs:
    "Planned Generation Outputs",
  dryRunOutput:
    "Dry Run Output",
  blockedBecause:
    "Blocked Because",
  requiredHumanActions:
    "Required Human Actions",
  nextRecommendedLoop:
    "Next recommended loop: LOOP 119 — Product to eBay Listing Bridge V1",
}

const productListingBridgeCopy = {
  title:
    "Product to eBay Listing Bridge",
  bridgeStatus:
    "PRODUCT_TO_LISTING_BRIDGE_DRY_RUN_READY",
  bridgeDecision:
    "CONNECT_PRODUCT_SOURCE_TO_LISTING_GENERATOR_DO_NOT_CREATE_DRAFT",
  previewStatus:
    "GENERATED_DRY_RUN_PREVIEW_NOT_PUBLISHABLE",
  sourceOfTruthStatus:
    "PRODUCTS_SOURCE_OF_TRUTH_REQUIRED",
  dryRunMode:
    "PRODUCT_SOURCE_CONTRACT_NO_EXTERNAL_CALLS",
  draftImpact:
    "DO_NOT_CREATE_EBAY_DRAFT",
  publicationImpact:
    "DO_NOT_PUBLISH",
  productsRule:
    "Products decide what the product is",
  listingRule:
    "Listing decides how the product sells on eBay",
  benchmarkRule:
    "Benchmark decides what is working in the market",
  gatesRule:
    "Gates decide whether the listing can advance",
  previewTitle:
    "Generated Listing Draft Preview",
  titleCandidate:
    "Storage Organizer, New, 1 Pack",
  blockedFacts:
    "Blocked unconfirmed facts",
  gateResult:
    "Gate result",
  readinessScore:
    "Readiness score",
  requiredHumanActions:
    "Required human actions",
  nextRecommendedLoop:
    "Next recommended loop: LOOP 120 — First eBay Listing Draft Preview V1",
}

const firstListingDraftPreviewCopy = {
  title:
    "First eBay Listing Draft Preview",
  draftPreviewStatus:
    "FIRST_LISTING_DRAFT_PREVIEW_GENERATED",
  draftPreviewDecision:
    "SHOW_PREVIEW_DO_NOT_CREATE_EBAY_DRAFT",
  previewMode:
    "SAFE_DRY_RUN_CONFIRMED_FACTS_ONLY",
  publishabilityStatus:
    "NOT_PUBLISHABLE_BLOCKED_BY_GATES",
  draftImpact:
    "DO_NOT_CREATE_EBAY_DRAFT",
  publicationImpact:
    "DO_NOT_PUBLISH",
  generatedListingPreview:
    "Generated Listing Preview",
  titleCandidate:
    "Storage Organizer, New, 1 Pack",
  keywordPlan:
    "Keyword plan",
  descriptionPreview:
    "Description preview",
  itemSpecificsPreview:
    "Item specifics preview",
  blockedFields:
    "Blocked fields",
  missingInputs:
    "Missing inputs",
  gateResult:
    "Gate result",
  readinessScore:
    "Readiness score",
  requiredHumanActions:
    "Required human actions",
  nextRecommendedLoop:
    "Next recommended loop: LOOP 121 — Real Product Source Adapter / Product Selector V1",
}

const productSourceAdapterSelectorCopy = {
  title:
    "Product Source Adapter / Selector",
  sourceAdapterStatus:
    "PRODUCT_SOURCE_ADAPTER_READY_READ_ONLY",
  selectorStatus:
    "PRODUCT_SELECTOR_READY_NO_LIVE_SELECTION_YET",
  sourceOfTruthStatus:
    "PRODUCTS_MODULE_IS_SOURCE_OF_TRUTH",
  listingUsageDecision:
    "USE_PRODUCT_FACTS_BY_REFERENCE_DO_NOT_DUPLICATE_AS_TRUTH",
  draftImpact:
    "DO_NOT_CREATE_EBAY_DRAFT",
  publicationImpact:
    "DO_NOT_PUBLISH",
  productsRule:
    "Products decide what the product is",
  listingRule:
    "Listing decides how the product sells on eBay",
  benchmarkRule:
    "Benchmark decides what is working in the market",
  gatesRule:
    "Gates decide whether the listing can advance",
  productSelectorContract:
    "Product Selector Contract",
  selectedProductPreview:
    "Selected Product Preview",
  listingBridgeInputContract:
    "Listing Bridge Input Contract",
  blockedBecause:
    "Blocked Because",
  requiredHumanActions:
    "Required Human Actions",
  nextRecommendedLoop:
    "Next recommended loop: LOOP 122 — Live Product Selector Read-Only V1",
}

const liveProductSelectorReadOnlyCopy = {
  title:
    "Live Product Selector Read-Only",
  selectorVersion:
    "LIVE_PRODUCT_SELECTOR_READ_ONLY_V1",
  selectorStatus:
    "LIVE_PRODUCT_SELECTOR_READ_ONLY_READY",
  selectorDecision:
    "READ_PRODUCTS_ONLY_DO_NOT_MUTATE",
  sourceOfTruthStatus:
    "PRODUCTS_MODULE_REMAINS_SOURCE_OF_TRUTH",
  productListContract:
    "Product List Contract",
  selectedProductReadOnlyPreview:
    "Selected Product Read-Only Preview",
  listingGeneratorBridgeContract:
    "Listing Generator Bridge Contract",
  productsRule:
    "Products decide what the product is",
  listingRule:
    "Listing decides how the product sells on eBay",
  benchmarkRule:
    "Benchmark decides what is working in the market",
  gatesRule:
    "Gates decide whether the listing can advance",
  productName:
    "Storage Organizer",
  supplier:
    "Portex",
  mutationRule:
    "No product mutation is allowed from the listing selector",
  nextRecommendedLoop:
    "Next recommended loop: LOOP 123 — Real Product Facts Mapping to Listing Generator V1",
}

const realProductListingGeneratorIntegrationCopy = {
  title:
    "Real Product Listing Generator Integration",
  integrationVersion:
    "EBAY_REAL_PRODUCT_LISTING_GENERATOR_INTEGRATION_V1",
  integrationStatus:
    "REAL_PRODUCT_LISTING_GENERATOR_INTEGRATION_READY",
  productReadDecision:
    "READ_PRODUCTS_ONLY_SAFE_FALLBACK_IF_UNAVAILABLE",
  factsMappingStatus:
    "PRODUCT_FACTS_MAPPING_READY_WITH_MISSING_FIELD_BLOCKERS",
  generatorStatus:
    "LISTING_PREVIEW_FROM_SELECTED_PRODUCT_READY",
  gatesStatus:
    "READINESS_GATES_ACTIVE_DRAFT_BLOCKED",
  generatedListingPreview:
    "Generated Listing Preview",
  titlePreview:
    "Title preview",
  basicKeywordPlan:
    "Basic keyword plan",
  descriptionPreview:
    "Description preview",
  itemSpecificsPreview:
    "Item specifics preview",
  missingProductFacts:
    "Missing Product Facts",
  blockedListingFields:
    "Blocked Listing Fields",
  readinessGates:
    "Readiness Gates",
  readinessScore:
    "Readiness score",
  nextRecommendedLoop:
    "Next recommended loop: LOOP 124 — eBay Draft Payload Dry Run Builder V1",
}

const lunaPortexCatalogImagePackageQaCopy = {
  title:
    "Luna Portex Catalog Image Package + eBay Image QA",
  imagePackageVersion:
    "EBAY_LUNA_PORTEX_CATALOG_IMAGE_PACKAGE_QA_V1",
  imagePackageStatus:
    "LUNA_PORTEX_CATALOG_IMAGE_PACKAGE_QA_READY",
  visualSourceDecision:
    "USE_LUNA_PORTEX_CATALOG_IMAGE_AS_VISUAL_SOURCE_OF_TRUTH",
  mainImagePolicyStatus:
    "SOURCE_BASED_MAIN_IMAGE_OPTIMIZATION_ALLOWED",
  secondaryImagePolicyStatus:
    "AI_ASSISTED_SECONDARY_IMAGES_ALLOWED_FROM_CATALOG_SOURCE_ONLY",
  imageQaStatus:
    "IMAGE_QA_GATES_ACTIVE_IMAGES_NOT_GENERATED",
  visualSourceTruth:
    "Luna Portex Catalog Image = visual source of truth",
  mainImagePolicy:
    "Main image policy",
  secondaryImagePackagePlan:
    "Secondary image package plan",
  imageQaGates:
    "Image QA gates",
  blockedReasons:
    "Blocked reasons",
  requiredHumanActions:
    "Required human actions",
  photorealismRule:
    "must look photorealistic",
  aiLookRule:
    "must not look AI-generated",
  nextRecommendedLoop:
    "Next recommended loop: LOOP 125 — eBay Draft Payload Dry Run Builder V1",
}

const completeListingPackageBuilderCopy = {
  title:
    "Complete Listing Package Builder",
  packageVersion:
    "EBAY_COMPLETE_LISTING_PACKAGE_BUILDER_V1",
  packageStatus:
    "COMPLETE_LISTING_PACKAGE_BUILDER_READY",
  productSourceStatus:
    "READ_ONLY_PRODUCTS_SOURCE_WITH_SAFE_FALLBACK",
  listingContentStatus:
    "GENERATED_LISTING_PREVIEW_READY",
  catalogImageStatus:
    "LUNA_PORTEX_CATALOG_IMAGE_REFERENCE_READY_OR_BLOCKED",
  secondaryImagePromptStatus:
    "SECONDARY_IMAGE_PROMPTS_READY_IMAGES_NOT_GENERATED",
  draftPayloadStatus:
    "DRAFT_PAYLOAD_DRY_RUN_READY_NOT_SUBMITTED",
  readinessStatus:
    "READINESS_GATES_ACTIVE_DRAFT_AND_PUBLICATION_BLOCKED",
  selectedProduct:
    "Selected Product",
  generatedListingContent:
    "Generated Listing Content",
  catalogImagePackage:
    "Catalog Image Package",
  secondaryImagePrompts:
    "Secondary Image Prompts",
  draftPayloadDryRun:
    "Draft Payload Dry Run",
  readinessGates:
    "Readiness Gates",
  blockedFields:
    "Blocked Fields",
  requiredHumanActions:
    "Required Human Actions",
  catalogImageMissing:
    "Catalog image reference missing",
  nextRecommendedLoop:
    "Next loop: LOOP 126 — Listing Review & Approval Workspace V1",
}

const ebayImageGenerationServiceDesignCopy = {
  title:
    "Image Generation Service Design",
  serviceStatus:
    "IMAGE_GENERATION_SERVICE_NOT_IMPLEMENTED",
  serviceDecision:
    "DESIGN_ONLY_DO_NOT_GENERATE_IMAGES",
  generationMode:
    "DRY_RUN_DESIGN_ONLY",
  openAiStatus:
    "OPENAI_NOT_CONFIGURED",
  sourceStatus:
    "SOURCE_EVIDENCE_NOT_APPROVED",
  imageGenerationImpact:
    "DO_NOT_GENERATE_IMAGES",
  imageUploadImpact:
    "DO_NOT_UPLOAD_IMAGES",
  draftImpact:
    "DO_NOT_CREATE_EBAY_DRAFT",
  publicationImpact:
    "DO_NOT_PUBLISH",
  serviceSummary:
    "Image generation service is not implemented",
  noOpenAi:
    "No OpenAI API call is allowed",
  noGeneration:
    "No image generation is allowed",
  noUploadStorage:
    "No image upload or storage is allowed",
  nextRecommendedLoop:
    "Next recommended loop: LOOP 111 — Image Generation Dry Run Contract V1",
}

const imageSourceIntakeCopy = {
  intakeStatus:
    "SOURCE_EVIDENCE_REQUIRED",
  draftImpact:
    "DRAFT_BLOCKED_UNTIL_SOURCE_EVIDENCE_APPROVED",
  humanReviewRequired:
    "Human source review required",
  reviewStatus:
    "Source review not started",
  approvalGate:
    "Approval required before image QA and eBay draft",
  checklistLabels: [
    "Source is Luna Portex catalog",
    "Authorized use confirmed",
    "Image matches the listing product",
    "No competitor image is used",
    "No restricted watermark or competitor logo",
    "White-background enhancement permission confirmed",
  ],
}

const imageSourceReviewGateCopy = {
  gateStatus:
    "SOURCE_REVIEW_NOT_APPROVED",
  gateDecision:
    "BLOCK_IMAGE_WORKFLOW",
  draftImpact:
    "DRAFT_BLOCKED_UNTIL_SOURCE_REVIEW_APPROVED",
  summary:
    "Source evidence has not been approved yet",
  imageEnhancementBlocked:
    "Image enhancement: Blocked",
  imageQaBlocked:
    "Image QA: Blocked",
  draftMappingBlocked:
    "eBay draft mapping: Blocked",
  draftCreationBlocked:
    "eBay draft creation: Blocked",
  humanReviewRequired:
    "Human source review required",
  requestMoreEvidence:
    "Request more source evidence",
}

const mainImageEnhancementBriefCopy = {
  briefStatus:
    "ENHANCEMENT_BRIEF_READY_BUT_SOURCE_BLOCKED",
  executionStatus:
    "DO_NOT_ENHANCE_YET",
  draftImpact:
    "DRAFT_BLOCKED_UNTIL_SOURCE_REVIEW_AND_IMAGE_QA_APPROVED",
  sourceReviewRequired:
    "Source review required before enhancement",
  authorizedSource:
    "Authorized Luna Portex catalog image required",
  pureWhiteBackground:
    "Pure white background",
  squareImage:
    "1:1 eBay main image",
  minimumResolution:
    "Minimum 1600px",
  productCentered:
    "Product centered",
  noProductAlteration:
    "No product alteration",
  noTextOverlay:
    "No text overlay",
  noTrustBadges:
    "No trust badges",
  noUsaFlag:
    "No USA flag",
  noCompetitorBranding:
    "No competitor branding",
  notOpenAiPayload:
    "Not an OpenAI payload",
  blocked:
    "Enhancement blocked until source review approval",
}

const imageQaReviewGateCopy = {
  title:
    "Image QA Review Gate",
  gateStatus:
    "IMAGE_QA_NOT_READY",
  gateDecision:
    "BLOCK_IMAGE_QA_APPROVAL",
  listingImpact:
    "LISTING_BLOCKED_UNTIL_IMAGE_QA_APPROVED",
  draftImpact:
    "DO_NOT_CREATE_EBAY_DRAFT",
  publicationImpact:
    "DO_NOT_PUBLISH",
  summary:
    "Image QA is not ready",
  currentDecision:
    "Current decision: request more image work",
  imageQaCheckLabels: [
    "Authorized source evidence approved",
    "Main image candidate exists",
    "Main image enhancement executed",
    "Main image background compliant",
    "Main image has no text, badges or watermarks",
    "Main image product not altered",
    "Secondary image package ready",
    "Secondary images QA approved",
    "Image policy review completed",
    "Human image review completed",
  ],
}

const decisionCards = [
  {
    label:
      "No crear draft",
    detail:
      "QA necesita datos antes de considerar cualquier draft de eBay.",
    tone:
      "border-rose-300/25 bg-rose-300/[0.06] text-rose-50",
  },
  {
    label:
      "No publicar",
    detail:
      "Terapeak, benchmark, shipping, imagenes y margen siguen incompletos.",
    tone:
      "border-rose-300/25 bg-rose-300/[0.06] text-rose-50",
  },
  {
    label:
      "Solo preparacion interna",
    detail:
      "Usar este paquete para ordenar el trabajo, no para ejecutar acciones reales.",
    tone:
      "border-amber-300/25 bg-amber-300/[0.06] text-amber-50",
  },
]

const actionPlan = [
  {
    title:
      "Datos del producto",
    items: [
      "dimensions",
      "material",
      "package contents",
    ],
  },
  {
    title:
      "Validacion de mercado",
    items: [
      "Terapeak validation",
      "Sold listings benchmark",
    ],
  },
  {
    title:
      "Operacion",
    items: [
      "shipping policy",
      "return policy",
      "stock location",
      "Luna Portex packing fee",
    ],
  },
  {
    title:
      "Imagenes",
    items: [
      "authorized Luna Portex catalog image",
      "white-background main image enhancement",
      "secondary images",
      "image QA",
    ],
  },
  {
    title:
      "Aprobacion",
    items: [
      "human review before draft",
      "human approval before publish",
    ],
  },
]

const sellerWorkflowOrder = [
  {
    step:
      "1",
    title:
      "Confirmar producto fuente",
    detail:
      "Seleccionar el producto del catalogo Luna Portex y validar el snapshot antes de usarlo en el listing package.",
  },
  {
    step:
      "2",
    title:
      "Validar datos del listing",
    detail:
      "Confirmar titulo, marca, categoria, condicion, dimensiones, peso, contenido, cantidad, compatibilidad y claims.",
  },
  {
    step:
      "3",
    title:
      "Validar rentabilidad",
    detail:
      "Confirmar costo, fees, shipping, riesgo de devolucion, margen, Terapeak, ventas comparables, stock y politicas operativas.",
  },
  {
    step:
      "4",
    title:
      "Aprobar fuente e imagenes",
    detail:
      "Aprobar evidencia autorizada de imagen antes de enhancement, image QA, imagenes secundarias o eBay draft mapping.",
  },
  {
    step:
      "5",
    title:
      "Actualizar paquete y mapear draft",
    detail:
      "Actualizar el listing package y mapear un eBay draft solo despues de aprobar fuente, datos, rentabilidad, imagenes y revision humana.",
  },
]

const sellerCommandMenu = [
  {
    href:
      "#source-product",
    label:
      "Producto fuente",
    detail:
      "Empezar aqui. Confirmar que producto Luna Portex usaria este listing.",
  },
  {
    href:
      "#facts-gate",
    label:
      "Datos del listing",
    detail:
      "Validar los datos del producto que eBay y el comprador necesitan.",
  },
  {
    href:
      "#commercial-gate",
    label:
      "Rentabilidad",
    detail:
      "Revisar costo, fees, margen, shipping, devoluciones, stock y prueba de mercado.",
  },
  {
    href:
      "#image-plan",
    label:
      "Imagenes",
    detail:
      "Revisar evidencia de fuente, readiness de enhancement e image QA.",
  },
  {
    href:
      "#source-aware-refresh",
    label:
      "Refresh del paquete",
    detail:
      "Ver por que el listing package aun no puede actualizarse ni mapearse a eBay.",
  },
  {
    href:
      "#qa-details",
    label:
      "QA final",
    detail:
      "Revisar bloqueos pendientes antes de cualquier draft o decision de publicacion.",
  },
]

const imageWorkflowOrder = [
  {
    step:
      "1",
    title:
      "Capturar fuente",
    detail:
      "Registrar evidencia Luna Portex sin usar imagenes reales, URLs, uploads ni llamadas externas.",
  },
  {
    step:
      "2",
    title:
      "Revisar fuente",
    detail:
      "La revision humana debe aprobar el uso autorizado antes de cualquier enhancement o QA.",
  },
  {
    step:
      "3",
    title:
      "Brief de imagen principal",
    detail:
      "El brief puede describir requisitos, pero la ejecucion sigue bloqueada hasta aprobar la fuente.",
  },
  {
    step:
      "4",
    title:
      "QA de imagenes",
    detail:
      "QA sigue bloqueado hasta tener candidato final, paquete secundario, policy review y revision humana.",
  },
  {
    step:
      "5",
    title:
      "Mapeo de imagenes al draft",
    detail:
      "No mapear imagenes a un eBay draft hasta que image QA este aprobado.",
  },
]

const disabledActions = [
  {
    label:
      "Import Sold Listings",
    reason:
      "Disabled: benchmark import not implemented yet",
  },
  {
    label:
      "Validate Terapeak",
    reason:
      "Disabled: manual validation required first",
  },
  {
    label:
      "Create eBay Draft",
    reason:
      "Disabled: QA needs data",
  },
  {
    label:
      "Publish to eBay",
    reason:
      "Disabled: Terapeak and benchmark missing",
  },
  {
    label:
      "Create Pack Listing",
    reason:
      "Disabled: waiting for conversion data",
  },
  {
    label:
      "Generate Images",
    reason:
      "Disabled: authorized catalog source and image QA required",
  },
]

const statusMarkers = [
  "LISTING_PACKAGE_NEEDS_DATA",
  "NOT_READY_TO_PUBLISH",
  "LISTING_QA_NEEDS_DATA",
  "DO_NOT_CREATE_DRAFT",
  "DO_NOT_PUBLISH",
  "TERAPEAK_VALIDATION_REQUIRED",
  "SOLD_LISTINGS_BENCHMARK_REQUIRED",
  "WAITING_FOR_CONVERSION_DATA",
  "PACKING_FEE_VERIFICATION_REQUIRED",
  "AUTHORIZED_CATALOG_IMAGE_REQUIRED_FOR_MAIN_IMAGE",
  "CATALOG_IMAGE_ENHANCEMENT_REQUIRED",
  "ebay_only_connector_or_import",
  "structured_requirement_only",
  "pack x2",
  "pack x3",
  "pack x6",
  "pack x12",
]

const trustSignalLabels = {
  freeShipping:
    "Free Shipping",
  shipsFromUsa:
    "Ships from USA",
  inStockInUsa:
    "In Stock in USA",
  usaFlag:
    "USA flag",
}

function formatValue(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return "Not provided"
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false"
  }

  return String(value)
}

function Section({
  id,
  title,
  eyebrow,
  children,
}: {
  id?: string
  title: string
  eyebrow?: string
  children: ReactNode
}) {
  return (
    <section
      id={id}
      className="min-w-0 rounded-3xl border border-white/10 bg-white/[0.03] p-6"
    >
      {eyebrow ? (
        <p className="break-words text-[11px] font-semibold uppercase leading-5 tracking-[0.08em] text-cyan-100/50 [overflow-wrap:anywhere]">
          {eyebrow}
        </p>
      ) : null}
      <h2 className="break-words text-lg font-black text-white [overflow-wrap:anywhere]">
        {title}
      </h2>
      <div className="mt-5">
        {children}
      </div>
    </section>
  )
}

function FieldGrid({
  fields,
}: {
  fields: Array<[string, unknown]>
}) {
  return (
    <dl className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {fields.map(([label, value]) => (
        <div
          key={label}
          className="min-w-0 rounded-2xl border border-white/10 bg-black/20 p-4"
        >
          <dt className="break-words text-[11px] font-semibold uppercase leading-5 tracking-[0.08em] text-white/40 [overflow-wrap:anywhere]">
            {label}
          </dt>
          <dd className="mt-2 break-words text-sm font-bold leading-6 text-white [overflow-wrap:anywhere]">
            {formatValue(value)}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function ListBlock({
  items,
}: {
  items: string[]
}) {
  return (
    <ul className="grid gap-3 text-sm leading-6 text-white/70">
      {items.map((item) => (
        <li
          key={item}
          className="min-w-0 break-words rounded-2xl border border-white/10 bg-black/20 px-4 py-3 [overflow-wrap:anywhere]"
        >
          {item}
        </li>
      ))}
    </ul>
  )
}

export default function EbayListingPackagePage() {
  const trustSignals =
    listingPackage.trustSignals
  const optionalTrustVisual =
    listingPackage.optionalUsBuyerTrustVisual
  const soldListingsBenchmark =
    listingPackage.soldListingsBenchmarkStrategy
  const sellOneLikeThis =
    soldListingsBenchmark.sellOneLikeThisStrategy
  const completeListingCatalogImageReference =
    completeListingPackageBuilder.catalogImagePackage.primaryCatalogImageReference as
      | string
      | null

  return (
    <main className="min-h-screen bg-[#05070d] px-6 py-8 text-white md:px-10 lg:px-14">
      <div className="mx-auto flex max-w-7xl flex-col gap-8">
        <a
          href="/admin"
          className="w-fit rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-cyan-100/70 transition hover:border-cyan-300/30 hover:text-cyan-100"
        >
          Volver a Admin
        </a>

        <section className="rounded-[28px] border border-cyan-300/15 bg-cyan-300/[0.04] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.3)] md:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase leading-5 tracking-[0.08em] text-cyan-100/60">
                Professional Listing MVP
              </p>
              <h1 className="mt-4 text-4xl font-black text-white md:text-5xl">
                Listing Package QA
              </h1>
              <p className="mt-4 max-w-3xl text-sm leading-7 text-white/60">
                Vista vendedor del primer listing package y QA review. Preview read-only. Sin conexion eBay. No se creo draft. No publicar todavia. Requiere revision humana.
              </p>
            </div>

            <div className="flex max-w-xl flex-wrap gap-2 lg:justify-end">
              {safetyBadges.map((badge) => (
                <span
                  key={badge}
                  className="break-words rounded-full border border-white/10 bg-black/25 px-3 py-2 text-xs font-semibold leading-5 text-white/70 [overflow-wrap:anywhere]"
                >
                  {badge}
                </span>
              ))}
            </div>
          </div>
        </section>

        <Section title="Menu del vendedor" eyebrow="Vista vendedor">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {sellerCommandMenu.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="min-w-0 rounded-3xl border border-white/10 bg-black/20 p-5 transition hover:border-cyan-300/30 hover:bg-cyan-300/[0.055]"
              >
                <h3 className="break-words text-base font-black text-white [overflow-wrap:anywhere]">
                  {item.label}
                </h3>
                <p className="mt-3 text-sm leading-6 text-white/65">
                  {item.detail}
                </p>
              </a>
            ))}
          </div>
        </Section>

        <Section
          id="executive-status"
          title="Estado ejecutivo"
          eyebrow="Vista vendedor"
        >
          <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-3xl border border-rose-300/25 bg-rose-300/[0.06] p-5">
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  [
                    "Estado: no listo",
                    "Faltan requisitos criticos del listing.",
                  ],
                  [
                    "Riesgo principal: no publicar",
                    "Publicar ahora dependeria de datos sin validar.",
                  ],
                  [
                    "Siguiente paso: completar datos criticos",
                    "Resolver bloqueos de mercado, operacion, imagen y margen antes de crear un draft.",
                  ],
                  [
                    "Uso permitido: preparacion interna",
                    "Usar esta vista para ordenar el trabajo del vendedor con seguridad.",
                  ],
                ].map(([title, detail]) => (
                  <div
                    key={title}
                    className="min-w-0 rounded-2xl border border-white/10 bg-black/25 p-4"
                  >
                    <h3 className="break-words text-sm font-black leading-6 text-white [overflow-wrap:anywhere]">
                      {title}
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-white/65">
                      {detail}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-3xl border border-amber-300/20 bg-amber-300/[0.055] p-5">
              <h3 className="text-sm font-black text-white">
                Bloqueos para publicar
              </h3>
              <ul className="mt-4 space-y-3 text-sm font-semibold text-amber-50/85">
                {executiveBlockers.map((blocker) => (
                  <li
                    key={blocker}
                    className="break-words rounded-2xl border border-white/10 bg-black/20 px-4 py-3 [overflow-wrap:anywhere]"
                  >
                    {blocker}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            {decisionCards.map((card) => (
              <article
                key={card.label}
                className={`min-w-0 rounded-3xl border p-5 ${card.tone}`}
              >
                <h3 className="break-words text-lg font-black leading-7 [overflow-wrap:anywhere]">
                  {card.label}
                </h3>
                <p className="mt-3 text-sm leading-6 opacity-80">
                  {card.detail}
                </p>
              </article>
            ))}
          </div>
        </Section>

        <Section title="Ruta de trabajo del vendedor" eyebrow="Vista vendedor">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            {sellerWorkflowOrder.map((item) => (
              <article
                key={item.step}
                className="min-w-0 rounded-3xl border border-cyan-300/15 bg-cyan-300/[0.04] p-5"
              >
                <p className="text-[11px] font-black uppercase leading-5 tracking-[0.08em] text-cyan-100/60">
                  Paso {item.step}
                </p>
                <h3 className="mt-3 break-words text-sm font-black leading-6 text-white [overflow-wrap:anywhere]">
                  {item.title}
                </h3>
                <p className="mt-3 text-sm leading-6 text-white/65">
                  {item.detail}
                </p>
              </article>
            ))}
          </div>
        </Section>

        <Section title="Vista previa del listing">
          <div className="grid gap-5 xl:grid-cols-[minmax(220px,280px)_minmax(0,1fr)]">
            <div className="flex min-h-[240px] flex-col items-center justify-center rounded-3xl border border-dashed border-white/20 bg-white/[0.035] p-6 text-center xl:min-h-0">
              <p className="break-words text-lg font-black leading-7 text-white [overflow-wrap:anywhere]">
                Falta imagen autorizada de Luna Portex
              </p>
              <div className="mt-5 space-y-2 text-sm font-semibold text-white/65">
                <p>
                  Requiere fondo blanco
                </p>
                <p>
                  No generar producto con AI
                </p>
                <p>
                  No alterar el producto
                </p>
                <p>
                  Sin badges ni banderas
                </p>
                <p>
                  Requiere autorizacion de fuente
                </p>
              </div>
            </div>

            <div className="min-w-0 rounded-3xl border border-white/10 bg-black/20 p-5">
              <p className="break-words text-[11px] font-semibold uppercase leading-5 tracking-[0.08em] text-white/40 [overflow-wrap:anywhere]">
                Vista previa para vendedor
              </p>

              <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <h2 className="break-words text-[11px] font-semibold uppercase leading-5 tracking-[0.08em] text-white/40 [overflow-wrap:anywhere]">
                  Titulo
                </h2>
                <p className="mt-3 break-words text-lg font-bold leading-7 text-cyan-100">
                  {listingPackage.listingTitle}
                </p>
              </div>

              <ul className="mt-4 grid gap-3 text-sm leading-6 text-white/70">
                {listingPackage.buyerFacingCopy.bullets.map((bullet) => (
                  <li
                    key={bullet}
                    className="break-words rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3"
                  >
                    {bullet}
                  </li>
                ))}
              </ul>

              <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/40">
                  Short description
                </p>
                <p className="mt-3 break-words text-sm leading-7 text-white/60">
                  {listingPackage.buyerFacingCopy.descriptionPlainText}
                </p>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {[
                  [
                    "Condition",
                    listingPackage.condition.suggestedCondition,
                  ],
                  [
                    "Category",
                    "Pending confirmation",
                  ],
                  [
                    "Price: Pending",
                    "Cost, fees, margin, and sold price benchmark required.",
                  ],
                  [
                    "Shipping: Pending",
                    "Shipping policy and stock location must be confirmed.",
                  ],
                  [
                    "Returns: Pending",
                    "Return policy must be confirmed.",
                  ],
                  [
                    "Draft status: Blocked",
                    qaReview.draftRecommendation,
                  ],
                  [
                    "Publish status: Blocked",
                    qaReview.publicationRecommendation,
                  ],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.03] p-4"
                  >
                    <p className="break-words text-[11px] font-semibold uppercase leading-5 tracking-[0.08em] text-white/40 [overflow-wrap:anywhere]">
                      {label}
                    </p>
                    <p className="mt-2 break-words text-sm font-bold leading-6 text-white [overflow-wrap:anywhere]">
                      {value}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Section>

        <Section title="Plan de accion">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            {actionPlan.map((group) => (
              <article
                key={group.title}
                className="min-w-0 rounded-3xl border border-white/10 bg-black/20 p-5"
              >
                <h3 className="break-words text-sm font-black leading-6 text-white [overflow-wrap:anywhere]">
                  {group.title}
                </h3>
                <ul className="mt-4 space-y-2 text-sm leading-6 text-white/65">
                  {group.items.map((item) => (
                    <li key={item} className="break-words [overflow-wrap:anywhere]">
                      {item}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </Section>

        <Section title="Acciones humanas requeridas">
          <ListBlock items={qaReview.requiredHumanActions} />
        </Section>

        <Section id="source-product" title="Linked Source Product" eyebrow="Vista vendedor">
          <div className="grid gap-5">
            <div className="rounded-3xl border border-white/10 bg-black/20 p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="break-words text-[11px] font-semibold uppercase leading-5 tracking-[0.08em] text-cyan-100/60 [overflow-wrap:anywhere]">
                    {productSnapshotCopy.title}
                  </p>
                  <h3 className="mt-2 text-xl font-black text-white">
                    Linked Source Product
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-white/65">
                    {productSnapshotCopy.currentDecision}
                  </p>
                </div>

                <div className="grid gap-3 text-sm font-bold text-white lg:min-w-[360px]">
                  <span className="break-words rounded-2xl border border-amber-300/20 bg-amber-300/[0.06] px-4 py-3 [overflow-wrap:anywhere]">
                    {productSnapshotCopy.snapshotStatus}
                  </span>
                  <span className="break-words rounded-2xl border border-rose-300/20 bg-rose-300/[0.06] px-4 py-3 [overflow-wrap:anywhere]">
                    {productSnapshotCopy.listingImpact}
                  </span>
                </div>
              </div>

              <div className="mt-5">
                <FieldGrid
                  fields={[
                    [
                      productSnapshotCopy.sourceProvider,
                      productSnapshot.sourceProvider,
                    ],
                    [
                      productSnapshotCopy.sourceType,
                      productSnapshot.sourceType,
                    ],
                    [
                      productSnapshotCopy.catalogReference,
                      productSnapshot.catalogReference.catalogReferenceStatus,
                    ],
                    [
                      productSnapshotCopy.productFacts,
                      productSnapshot.productFacts.factsStatus,
                    ],
                    [
                      productSnapshotCopy.commercialInputs,
                      productSnapshot.commercialInputs.commercialStatus,
                    ],
                    [
                      productSnapshotCopy.operationsInputs,
                      productSnapshot.operationsInputs.operationsStatus,
                    ],
                    [
                      productSnapshotCopy.imageInputs,
                      productSnapshot.imageInputs.imageStatus,
                    ],
                    [
                      productSnapshotCopy.complianceAndRisk,
                      productSnapshot.complianceAndRisk.riskStatus,
                    ],
                    [
                      productSnapshotCopy.currentDecision,
                      productSnapshot.validationGates.currentDecision,
                    ],
                  ]}
                />
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              {productSnapshotFieldGroups.map((group) => (
                <article
                  key={group.title}
                  className="rounded-2xl border border-white/10 bg-black/20 p-5"
                >
                  <h4 className="text-sm font-black text-white">
                    {group.title}
                  </h4>
                  <div className="mt-3">
                    <FieldGrid fields={Object.entries(group.fields)} />
                  </div>
                </article>
              ))}
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Missing data
                </h4>
                <div className="mt-4 grid gap-3">
                  {productSnapshot.missingData.map((group) => (
                    <div
                      key={group.group}
                      className="rounded-xl border border-white/10 bg-white/[0.03] p-3"
                    >
                      <p className="text-sm font-bold text-white">
                        {group.group}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-white/60">
                        {group.items.join(", ")}
                      </p>
                    </div>
                  ))}
                </div>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Compact Safety Flags
                </h4>
                <div className="mt-3">
                  <FieldGrid fields={Object.entries(productSnapshot.safetyFlags)} />
                </div>
              </article>
            </div>
          </div>
        </Section>

        <Section id="facts-gate" title="Product Facts Readiness Gate" eyebrow="Vista vendedor">
          <div className="grid gap-5">
            <div className="rounded-3xl border border-white/10 bg-black/20 p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="break-words text-[11px] font-semibold uppercase leading-5 tracking-[0.08em] text-cyan-100/60 [overflow-wrap:anywhere]">
                    {productFactsReadinessGateCopy.title}
                  </p>
                  <h3 className="mt-2 text-xl font-black text-white">
                    {productFactsReadinessGateCopy.gateStatus}
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-white/65">
                    {productFactsReadinessGateCopy.summary}.{" "}
                    {productFactsReadinessGateCopy.humanReviewRequired}.
                  </p>
                </div>

                <div className="grid gap-3 text-sm font-bold text-white lg:min-w-[360px]">
                  <span className="break-words rounded-2xl border border-rose-300/20 bg-rose-300/[0.06] px-4 py-3 [overflow-wrap:anywhere]">
                    {productFactsReadinessGateCopy.gateDecision}
                  </span>
                  <span className="break-words rounded-2xl border border-rose-300/20 bg-rose-300/[0.06] px-4 py-3 [overflow-wrap:anywhere]">
                    {productFactsReadinessGateCopy.listingImpact}
                  </span>
                  <span className="break-words rounded-2xl border border-amber-300/20 bg-amber-300/[0.06] px-4 py-3 [overflow-wrap:anywhere]">
                    {productFactsReadinessGateCopy.draftImpact}
                  </span>
                </div>
              </div>

              <div className="mt-5">
                <FieldGrid
                  fields={[
                    [
                      "Gate status",
                      productFactsReadinessGate.gateStatus,
                    ],
                    [
                      "Gate decision",
                      productFactsReadinessGate.gateDecision,
                    ],
                    [
                      "Listing impact",
                      productFactsReadinessGate.listingImpact,
                    ],
                    [
                      "Draft impact",
                      productFactsReadinessGate.draftImpact,
                    ],
                    [
                      productFactsReadinessGateCopy.currentDecision,
                      productFactsReadinessGate.humanDecision.currentDecision,
                    ],
                  ]}
                />
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Review Inputs
                </h4>
                <div className="mt-3">
                  <FieldGrid fields={Object.entries(productFactsReadinessGate.reviewInputs)} />
                </div>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Human Decision
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={[
                      [
                        "Required",
                        productFactsReadinessGate.humanDecision.required,
                      ],
                      [
                        "Decision status",
                        productFactsReadinessGate.humanDecision.decisionStatus,
                      ],
                      [
                        "Approval status",
                        productFactsReadinessGate.humanDecision.approvalStatus,
                      ],
                      [
                        productFactsReadinessGateCopy.currentDecision,
                        productFactsReadinessGate.humanDecision.currentDecision,
                      ],
                      [
                        "Allowed decision values",
                        productFactsReadinessGate.humanDecision.allowedDecisionValues.join(", "),
                      ],
                    ]}
                  />
                </div>
              </article>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
              <h4 className="text-sm font-black text-white">
                Fact Checks
              </h4>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {productFactsReadinessGate.factChecks.map((check) => (
                  <article
                    key={check.checkId}
                    className="rounded-xl border border-rose-300/15 bg-rose-300/[0.045] p-4"
                  >
                    <p className="text-sm font-black text-white">
                      {check.label}
                    </p>
                    <p className="mt-2 break-words text-[11px] font-bold uppercase leading-5 tracking-[0.08em] text-rose-100/70 [overflow-wrap:anywhere]">
                      {check.status}
                    </p>
                    <p className="mt-3 text-sm leading-6 text-white/60">
                      {check.reason}
                    </p>
                  </article>
                ))}
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Blocked Workflows
                </h4>
                <div className="mt-4 grid gap-3">
                  {productFactsReadinessGate.blockedWorkflows.map((workflow) => (
                    <div
                      key={workflow.workflow}
                      className="rounded-xl border border-white/10 bg-white/[0.03] p-3"
                    >
                      <p className="text-sm font-bold text-white">
                        {workflow.workflow}
                      </p>
                      <p className="mt-1 break-words text-[11px] font-bold uppercase leading-5 tracking-[0.08em] text-amber-100/70 [overflow-wrap:anywhere]">
                        {workflow.status}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-white/60">
                        {workflow.reason}
                      </p>
                    </div>
                  ))}
                </div>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Unlock Requirements
                </h4>
                <div className="mt-4">
                  <ListBlock items={productFactsReadinessGate.unlockRequirements} />
                </div>
              </article>
            </div>

            <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
              <h4 className="text-sm font-black text-white">
                Compact Safety Flags
              </h4>
              <div className="mt-3">
                <FieldGrid fields={Object.entries(productFactsReadinessGate.safetyFlags)} />
              </div>
            </article>
          </div>
        </Section>

        <Section id="commercial-gate" title="Commercial Readiness Gate" eyebrow="Vista vendedor">
          <div className="grid gap-5">
            <div className="rounded-3xl border border-white/10 bg-black/20 p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="break-words text-[11px] font-semibold uppercase leading-5 tracking-[0.08em] text-cyan-100/60 [overflow-wrap:anywhere]">
                    {commercialReadinessGateCopy.title}
                  </p>
                  <h3 className="mt-2 text-xl font-black text-white">
                    {commercialReadinessGateCopy.gateStatus}
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-white/65">
                    {commercialReadinessGateCopy.summary}.{" "}
                    {commercialReadinessGateCopy.humanReviewRequired}.
                  </p>
                </div>

                <div className="grid gap-3 text-sm font-bold text-white lg:min-w-[360px]">
                  <span className="break-words rounded-2xl border border-rose-300/20 bg-rose-300/[0.06] px-4 py-3 [overflow-wrap:anywhere]">
                    {commercialReadinessGateCopy.gateDecision}
                  </span>
                  <span className="break-words rounded-2xl border border-rose-300/20 bg-rose-300/[0.06] px-4 py-3 [overflow-wrap:anywhere]">
                    {commercialReadinessGateCopy.listingImpact}
                  </span>
                  <span className="break-words rounded-2xl border border-amber-300/20 bg-amber-300/[0.06] px-4 py-3 [overflow-wrap:anywhere]">
                    {commercialReadinessGateCopy.draftImpact}
                  </span>
                </div>
              </div>

              <div className="mt-5">
                <FieldGrid
                  fields={[
                    [
                      "Gate status",
                      commercialReadinessGate.gateStatus,
                    ],
                    [
                      "Gate decision",
                      commercialReadinessGate.gateDecision,
                    ],
                    [
                      "Listing impact",
                      commercialReadinessGate.listingImpact,
                    ],
                    [
                      "Draft impact",
                      commercialReadinessGate.draftImpact,
                    ],
                    [
                      commercialReadinessGateCopy.currentDecision,
                      commercialReadinessGate.humanDecision.currentDecision,
                    ],
                  ]}
                />
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Review Inputs
                </h4>
                <div className="mt-3">
                  <FieldGrid fields={Object.entries(commercialReadinessGate.reviewInputs)} />
                </div>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Human Decision
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={[
                      [
                        "Required",
                        commercialReadinessGate.humanDecision.required,
                      ],
                      [
                        "Decision status",
                        commercialReadinessGate.humanDecision.decisionStatus,
                      ],
                      [
                        "Approval status",
                        commercialReadinessGate.humanDecision.approvalStatus,
                      ],
                      [
                        commercialReadinessGateCopy.currentDecision,
                        commercialReadinessGate.humanDecision.currentDecision,
                      ],
                      [
                        "Allowed decision values",
                        commercialReadinessGate.humanDecision.allowedDecisionValues.join(", "),
                      ],
                    ]}
                  />
                </div>
              </article>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
              <h4 className="text-sm font-black text-white">
                Commercial Checks
              </h4>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {commercialReadinessGate.commercialChecks.map((check) => (
                  <article
                    key={check.checkId}
                    className="rounded-xl border border-rose-300/15 bg-rose-300/[0.045] p-4"
                  >
                    <p className="text-sm font-black text-white">
                      {check.label}
                    </p>
                    <p className="mt-2 break-words text-[11px] font-bold uppercase leading-5 tracking-[0.08em] text-rose-100/70 [overflow-wrap:anywhere]">
                      {check.status}
                    </p>
                    <p className="mt-3 text-sm leading-6 text-white/60">
                      {check.reason}
                    </p>
                  </article>
                ))}
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Blocked Workflows
                </h4>
                <div className="mt-4 grid gap-3">
                  {commercialReadinessGate.blockedWorkflows.map((workflow) => (
                    <div
                      key={workflow.workflow}
                      className="rounded-xl border border-white/10 bg-white/[0.03] p-3"
                    >
                      <p className="text-sm font-bold text-white">
                        {workflow.workflow}
                      </p>
                      <p className="mt-1 break-words text-[11px] font-bold uppercase leading-5 tracking-[0.08em] text-amber-100/70 [overflow-wrap:anywhere]">
                        {workflow.status}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-white/60">
                        {workflow.reason}
                      </p>
                    </div>
                  ))}
                </div>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Unlock Requirements
                </h4>
                <div className="mt-4">
                  <ListBlock items={commercialReadinessGate.unlockRequirements} />
                </div>
              </article>
            </div>

            <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
              <h4 className="text-sm font-black text-white">
                Compact Safety Flags
              </h4>
              <div className="mt-3">
                <FieldGrid fields={Object.entries(commercialReadinessGate.safetyFlags)} />
              </div>
            </article>
          </div>
        </Section>

        <Section id="source-aware-refresh" title="Listing Package Source-Aware Refresh" eyebrow="Vista vendedor">
          <div className="grid gap-5">
            <div className="rounded-3xl border border-white/10 bg-black/20 p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="break-words text-[11px] font-semibold uppercase leading-5 tracking-[0.08em] text-cyan-100/60 [overflow-wrap:anywhere]">
                    {listingPackageSourceAwareRefreshCopy.title}
                  </p>
                  <h3 className="mt-2 text-xl font-black text-white">
                    {listingPackageSourceAwareRefreshCopy.refreshStatus}
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-white/65">
                    {listingPackageSourceAwareRefresh.refreshSummary}
                  </p>
                </div>

                <div className="grid gap-3 text-sm font-bold text-white lg:min-w-[360px]">
                  <span className="break-words rounded-2xl border border-rose-300/20 bg-rose-300/[0.06] px-4 py-3 [overflow-wrap:anywhere]">
                    {listingPackageSourceAwareRefreshCopy.refreshDecision}
                  </span>
                  <span className="break-words rounded-2xl border border-rose-300/20 bg-rose-300/[0.06] px-4 py-3 [overflow-wrap:anywhere]">
                    {listingPackageSourceAwareRefreshCopy.draftImpact}
                  </span>
                  <span className="break-words rounded-2xl border border-amber-300/20 bg-amber-300/[0.06] px-4 py-3 [overflow-wrap:anywhere]">
                    {listingPackageSourceAwareRefreshCopy.publicationImpact}
                  </span>
                </div>
              </div>

              <div className="mt-5">
                <FieldGrid
                  fields={[
                    [
                      "Refresh status",
                      listingPackageSourceAwareRefresh.refreshStatus,
                    ],
                    [
                      "Refresh decision",
                      listingPackageSourceAwareRefresh.refreshDecision,
                    ],
                    [
                      "Draft impact",
                      listingPackageSourceAwareRefresh.draftImpact,
                    ],
                    [
                      "Publication impact",
                      listingPackageSourceAwareRefresh.publicationImpact,
                    ],
                    [
                      listingPackageSourceAwareRefreshCopy.sourceProductLinked,
                      listingPackageSourceAwareRefresh.sourceAwareness.sourceProductLinked,
                    ],
                    [
                      listingPackageSourceAwareRefreshCopy.sourceAwareRefreshBlocked,
                      listingPackageSourceAwareRefresh.sourceAwareness.sourceAwareRefreshAllowed,
                    ],
                  ]}
                />
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Source Awareness
                </h4>
                <div className="mt-3">
                  <FieldGrid fields={Object.entries(listingPackageSourceAwareRefresh.sourceAwareness)} />
                </div>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Readiness Matrix
                </h4>
                <div className="mt-3">
                  <FieldGrid fields={Object.entries(listingPackageSourceAwareRefresh.readinessMatrix)} />
                </div>
              </article>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
              <h4 className="text-sm font-black text-white">
                Blocking Gates
              </h4>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {listingPackageSourceAwareRefresh.blockingGates.map((gate) => (
                  <article
                    key={gate.gateId}
                    className="rounded-xl border border-rose-300/15 bg-rose-300/[0.045] p-4"
                  >
                    <p className="text-sm font-black text-white">
                      {listingPackageSourceAwareGateLabels[
                        gate.gateId as keyof typeof listingPackageSourceAwareGateLabels
                      ] ?? gate.label}
                    </p>
                    <p className="mt-2 break-words text-[11px] font-bold uppercase leading-5 tracking-[0.08em] text-rose-100/70 [overflow-wrap:anywhere]">
                      {gate.status}
                    </p>
                    <p className="mt-3 text-sm leading-6 text-white/60">
                      {gate.decision}
                    </p>
                  </article>
                ))}
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Blocked Workflows
                </h4>
                <div className="mt-4 grid gap-3">
                  {listingPackageSourceAwareRefresh.blockedWorkflows.map((workflow) => (
                    <div
                      key={workflow.workflow}
                      className="rounded-xl border border-white/10 bg-white/[0.03] p-3"
                    >
                      <p className="text-sm font-bold text-white">
                        {workflow.workflow}
                      </p>
                      <p className="mt-1 break-words text-[11px] font-bold uppercase leading-5 tracking-[0.08em] text-amber-100/70 [overflow-wrap:anywhere]">
                        {workflow.status}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-white/60">
                        {workflow.reason}
                      </p>
                    </div>
                  ))}
                </div>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Required Human Actions
                </h4>
                <div className="mt-4">
                  <ListBlock items={listingPackageSourceAwareRefresh.requiredHumanActions} />
                </div>
              </article>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Next Recommended Loop
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={[
                      [
                        listingPackageSourceAwareRefreshCopy.nextRecommendedLoop,
                        listingPackageSourceAwareRefresh.nextRecommendedLoop.loop,
                      ],
                      [
                        "Reason",
                        listingPackageSourceAwareRefresh.nextRecommendedLoop.reason,
                      ],
                      [
                        "After that",
                        listingPackageSourceAwareRefresh.nextRecommendedLoop.afterThat,
                      ],
                    ]}
                  />
                </div>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Compact Safety Flags
                </h4>
                <div className="mt-3">
                  <FieldGrid fields={Object.entries(listingPackageSourceAwareRefresh.safetyFlags)} />
                </div>
              </article>
            </div>
          </div>
        </Section>

        <Section title="eBay Only Connection Design">
          <div className="grid gap-5">
            <div className="rounded-3xl border border-white/10 bg-black/20 p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="break-words text-[11px] font-semibold uppercase leading-5 tracking-[0.08em] text-cyan-100/60 [overflow-wrap:anywhere]">
                    {ebayOnlyConnectionDesign.designVersion}
                  </p>
                  <h3 className="mt-2 text-xl font-black text-white">
                    {ebayOnlyConnectionDesignCopy.title}
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-white/65">
                    {ebayOnlyConnectionDesign.connectionSummary}
                  </p>
                </div>

                <div className="grid gap-3 text-sm font-bold text-white lg:min-w-[360px]">
                  <span className="break-words rounded-2xl border border-rose-300/20 bg-rose-300/[0.06] px-4 py-3 [overflow-wrap:anywhere]">
                    {ebayOnlyConnectionDesignCopy.connectionStatus}
                  </span>
                  <span className="break-words rounded-2xl border border-rose-300/20 bg-rose-300/[0.06] px-4 py-3 [overflow-wrap:anywhere]">
                    {ebayOnlyConnectionDesignCopy.connectionDecision}
                  </span>
                  <span className="break-words rounded-2xl border border-amber-300/20 bg-amber-300/[0.06] px-4 py-3 [overflow-wrap:anywhere]">
                    {ebayOnlyConnectionDesignCopy.environmentStrategy}
                  </span>
                </div>
              </div>

              <div className="mt-5">
                <FieldGrid
                  fields={[
                    [
                      "Connection status",
                      ebayOnlyConnectionDesign.connectionStatus,
                    ],
                    [
                      "Connection decision",
                      ebayOnlyConnectionDesign.connectionDecision,
                    ],
                    [
                      "Environment strategy",
                      ebayOnlyConnectionDesign.environmentStrategy,
                    ],
                    [
                      "Auth status",
                      ebayOnlyConnectionDesign.authStatus,
                    ],
                    [
                      "Draft impact",
                      ebayOnlyConnectionDesign.draftImpact,
                    ],
                    [
                      "Publication impact",
                      ebayOnlyConnectionDesign.publicationImpact,
                    ],
                    [
                      ebayOnlyConnectionDesignCopy.sandboxFirst,
                      ebayOnlyConnectionDesign.connectionReadiness
                        .sandboxFirstRequired,
                    ],
                    [
                      ebayOnlyConnectionDesignCopy.noOauth,
                      ebayOnlyConnectionDesign.connectionReadiness
                        .oauthFlowImplemented,
                    ],
                    [
                      ebayOnlyConnectionDesignCopy.noTokens,
                      ebayOnlyConnectionDesign.connectionReadiness
                        .tokenStorageImplemented,
                    ],
                    [
                      ebayOnlyConnectionDesignCopy.noApiCalls,
                      ebayOnlyConnectionDesign.safetyFlags.ebayApiUsed,
                    ],
                    [
                      ebayOnlyConnectionDesignCopy.officialValidation,
                      ebayOnlyConnectionDesign.connectionReadiness
                        .officialDocsValidationRequired,
                    ],
                  ]}
                />
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Connection Readiness
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={Object.entries(
                      ebayOnlyConnectionDesign.connectionReadiness
                    )}
                  />
                </div>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Integration Boundaries
                </h4>
                <div className="mt-4 grid gap-4">
                  <div>
                    <h5 className="text-sm font-black text-white">
                      Allowed in this loop
                    </h5>
                    <div className="mt-3">
                      <ListBlock
                        items={
                          ebayOnlyConnectionDesign.integrationBoundaries
                            .allowedInThisLoop
                        }
                      />
                    </div>
                  </div>

                  <div>
                    <h5 className="text-sm font-black text-white">
                      Forbidden in this loop
                    </h5>
                    <div className="mt-3">
                      <ListBlock
                        items={
                          ebayOnlyConnectionDesign.integrationBoundaries
                            .forbiddenInThisLoop
                        }
                      />
                    </div>
                  </div>

                  <p className="rounded-2xl border border-amber-300/20 bg-amber-300/[0.045] p-4 text-sm leading-6 text-amber-50/80">
                    {
                      ebayOnlyConnectionDesign.integrationBoundaries
                        .officialValidationPolicy
                    }
                  </p>
                </div>
              </article>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
              <h4 className="text-sm font-black text-white">
                Connection Phases
              </h4>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {ebayOnlyConnectionDesign.connectionPhases.map((phase) => (
                  <article
                    key={phase.phaseId}
                    className="rounded-xl border border-white/10 bg-white/[0.03] p-4"
                  >
                    <p className="break-words text-sm font-black leading-6 text-white [overflow-wrap:anywhere]">
                      {phase.label}
                    </p>
                    <p className="mt-2 break-words text-[11px] font-bold uppercase leading-5 tracking-[0.08em] text-amber-100/70 [overflow-wrap:anywhere]">
                      {phase.status}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-white/60">
                      {phase.reason}
                    </p>
                  </article>
                ))}
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Blocked Workflows
                </h4>
                <div className="mt-4 grid gap-3">
                  {ebayOnlyConnectionDesign.blockedWorkflows.map((workflow) => (
                    <div
                      key={workflow.workflow}
                      className="rounded-xl border border-white/10 bg-white/[0.03] p-3"
                    >
                      <p className="break-words text-sm font-bold text-white [overflow-wrap:anywhere]">
                        {workflow.workflow}
                      </p>
                      <p className="mt-1 break-words text-[11px] font-bold uppercase leading-5 tracking-[0.08em] text-amber-100/70 [overflow-wrap:anywhere]">
                        {workflow.status}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-white/60">
                        {workflow.reason}
                      </p>
                    </div>
                  ))}
                </div>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Required Human Actions
                </h4>
                <div className="mt-4">
                  <ListBlock
                    items={ebayOnlyConnectionDesign.requiredHumanActions}
                  />
                </div>
              </article>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Next Recommended Loop
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={[
                      [
                        ebayOnlyConnectionDesignCopy.nextRecommendedLoop,
                        ebayOnlyConnectionDesign.nextRecommendedLoop.loop,
                      ],
                      [
                        "Reason",
                        ebayOnlyConnectionDesign.nextRecommendedLoop.reason,
                      ],
                    ]}
                  />
                </div>
                <div className="mt-4">
                  <ListBlock
                    items={
                      ebayOnlyConnectionDesign.nextRecommendedLoop.constraints
                    }
                  />
                </div>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Compact Safety Flags
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={Object.entries(
                      ebayOnlyConnectionDesign.safetyFlags
                    )}
                  />
                </div>
              </article>
            </div>
          </div>
        </Section>

        <Section title="eBay Sandbox Read-Only Connection Status">
          <div className="grid gap-5">
            <div className="rounded-3xl border border-white/10 bg-black/20 p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="break-words text-[11px] font-semibold uppercase leading-5 tracking-[0.08em] text-cyan-100/60 [overflow-wrap:anywhere]">
                    {ebaySandboxReadOnlyConnectionStatus.statusVersion}
                  </p>
                  <h3 className="mt-2 text-xl font-black text-white">
                    {ebaySandboxReadOnlyConnectionStatusCopy.title}
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-white/65">
                    {ebaySandboxReadOnlyConnectionStatus.statusSummary}
                  </p>
                </div>

                <div className="grid gap-3 text-sm font-bold text-white lg:min-w-[360px]">
                  <span className="break-words rounded-2xl border border-rose-300/20 bg-rose-300/[0.06] px-4 py-3 [overflow-wrap:anywhere]">
                    {ebaySandboxReadOnlyConnectionStatusCopy.connectionStatus}
                  </span>
                  <span className="break-words rounded-2xl border border-rose-300/20 bg-rose-300/[0.06] px-4 py-3 [overflow-wrap:anywhere]">
                    {ebaySandboxReadOnlyConnectionStatusCopy.readOnlyStatus}
                  </span>
                  <span className="break-words rounded-2xl border border-amber-300/20 bg-amber-300/[0.06] px-4 py-3 [overflow-wrap:anywhere]">
                    {ebaySandboxReadOnlyConnectionStatusCopy.tokenStatus}
                  </span>
                </div>
              </div>

              <div className="mt-5">
                <FieldGrid
                  fields={[
                    [
                      "Environment",
                      ebaySandboxReadOnlyConnectionStatus.environment,
                    ],
                    [
                      "Connection mode",
                      ebaySandboxReadOnlyConnectionStatus.connectionMode,
                    ],
                    [
                      "Connection status",
                      ebaySandboxReadOnlyConnectionStatus.connectionStatus,
                    ],
                    [
                      "Read-only status",
                      ebaySandboxReadOnlyConnectionStatus.readOnlyStatus,
                    ],
                    [
                      "Auth status",
                      ebaySandboxReadOnlyConnectionStatus.authStatus,
                    ],
                    [
                      "Token status",
                      ebaySandboxReadOnlyConnectionStatus.tokenStatus,
                    ],
                    [
                      "API status",
                      ebaySandboxReadOnlyConnectionStatus.apiStatus,
                    ],
                    [
                      "Draft impact",
                      ebaySandboxReadOnlyConnectionStatus.draftImpact,
                    ],
                    [
                      "Publication impact",
                      ebaySandboxReadOnlyConnectionStatus.publicationImpact,
                    ],
                    [
                      ebaySandboxReadOnlyConnectionStatusCopy.noOauth,
                      ebaySandboxReadOnlyConnectionStatus.readiness
                        .oauthFlowImplemented,
                    ],
                    [
                      ebaySandboxReadOnlyConnectionStatusCopy.noCredentials,
                      ebaySandboxReadOnlyConnectionStatus.safetyFlags
                        .secretsIncluded,
                    ],
                    [
                      ebaySandboxReadOnlyConnectionStatusCopy.noApiCalls,
                      ebaySandboxReadOnlyConnectionStatus.apiStatus,
                    ],
                    [
                      ebaySandboxReadOnlyConnectionStatusCopy.officialValidation,
                      ebaySandboxReadOnlyConnectionStatus.readiness
                        .officialDocsValidationRequired,
                    ],
                  ]}
                />
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Connection Readiness
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={Object.entries(
                      ebaySandboxReadOnlyConnectionStatus.readiness
                    )}
                  />
                </div>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Status Checks
                </h4>
                <div className="mt-4 grid gap-3">
                  {ebaySandboxReadOnlyConnectionStatus.statusChecks.map((check) => (
                    <div
                      key={check.checkId}
                      className="rounded-xl border border-white/10 bg-white/[0.03] p-3"
                    >
                      <p className="break-words text-sm font-bold text-white [overflow-wrap:anywhere]">
                        {check.label}
                      </p>
                      <p className="mt-1 break-words text-[11px] font-bold uppercase leading-5 tracking-[0.08em] text-amber-100/70 [overflow-wrap:anywhere]">
                        {check.status}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-white/60">
                        {check.reason}
                      </p>
                    </div>
                  ))}
                </div>
              </article>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Blocked Workflows
                </h4>
                <div className="mt-4 grid gap-3">
                  {ebaySandboxReadOnlyConnectionStatus.blockedWorkflows.map((workflow) => (
                    <div
                      key={workflow.workflow}
                      className="rounded-xl border border-white/10 bg-white/[0.03] p-3"
                    >
                      <p className="break-words text-sm font-bold text-white [overflow-wrap:anywhere]">
                        {workflow.workflow}
                      </p>
                      <p className="mt-1 break-words text-[11px] font-bold uppercase leading-5 tracking-[0.08em] text-amber-100/70 [overflow-wrap:anywhere]">
                        {workflow.status}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-white/60">
                        {workflow.reason}
                      </p>
                    </div>
                  ))}
                </div>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Required Human Actions
                </h4>
                <div className="mt-4">
                  <ListBlock
                    items={
                      ebaySandboxReadOnlyConnectionStatus.requiredHumanActions
                    }
                  />
                </div>
              </article>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Next Recommended Loop
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={[
                      [
                        ebaySandboxReadOnlyConnectionStatusCopy.nextRecommendedLoop,
                        ebaySandboxReadOnlyConnectionStatus.nextRecommendedLoop.loop,
                      ],
                      [
                        "Reason",
                        ebaySandboxReadOnlyConnectionStatus.nextRecommendedLoop.reason,
                      ],
                    ]}
                  />
                </div>
                <div className="mt-4">
                  <ListBlock
                    items={
                      ebaySandboxReadOnlyConnectionStatus.nextRecommendedLoop
                        .constraints
                    }
                  />
                </div>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Compact Safety Flags
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={Object.entries(
                      ebaySandboxReadOnlyConnectionStatus.safetyFlags
                    )}
                  />
                </div>
              </article>
            </div>
          </div>
        </Section>

        <Section title="eBay Sandbox Integration Readiness">
          <div className="grid gap-5">
            <div className="rounded-3xl border border-white/10 bg-black/20 p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="break-words text-[11px] font-semibold uppercase leading-5 tracking-[0.08em] text-cyan-100/60 [overflow-wrap:anywhere]">
                    {ebaySandboxIntegrationReadiness.readinessVersion}
                  </p>
                  <h3 className="mt-2 text-xl font-black text-white">
                    {ebaySandboxIntegrationReadinessCopy.title}
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-white/65">
                    {ebaySandboxIntegrationReadiness.readinessSummary}
                  </p>
                </div>

                <div className="grid gap-3 text-sm font-bold text-white lg:min-w-[360px]">
                  <span className="break-words rounded-2xl border border-rose-300/20 bg-rose-300/[0.06] px-4 py-3 [overflow-wrap:anywhere]">
                    {ebaySandboxIntegrationReadinessCopy.integrationStatus}
                  </span>
                  <span className="break-words rounded-2xl border border-rose-300/20 bg-rose-300/[0.06] px-4 py-3 [overflow-wrap:anywhere]">
                    {ebaySandboxIntegrationReadinessCopy.integrationDecision}
                  </span>
                  <span className="break-words rounded-2xl border border-amber-300/20 bg-amber-300/[0.06] px-4 py-3 [overflow-wrap:anywhere]">
                    {ebaySandboxIntegrationReadinessCopy.environmentStrategy}
                  </span>
                </div>
              </div>

              <div className="mt-5">
                <FieldGrid
                  fields={[
                    [
                      "Integration status",
                      ebaySandboxIntegrationReadiness.integrationStatus,
                    ],
                    [
                      "Integration decision",
                      ebaySandboxIntegrationReadiness.integrationDecision,
                    ],
                    [
                      "Environment strategy",
                      ebaySandboxIntegrationReadiness.environmentStrategy,
                    ],
                    [
                      "Credential status",
                      ebaySandboxIntegrationReadiness.credentialStatus,
                    ],
                    [
                      "Auth status",
                      ebaySandboxIntegrationReadiness.authStatus,
                    ],
                    [
                      "Secret status",
                      ebaySandboxIntegrationReadiness.secretStatus,
                    ],
                    [
                      "Scope status",
                      ebaySandboxIntegrationReadiness.scopeStatus,
                    ],
                    [
                      "Redirect status",
                      ebaySandboxIntegrationReadiness.redirectStatus,
                    ],
                    [
                      "API status",
                      ebaySandboxIntegrationReadiness.apiStatus,
                    ],
                    [
                      "Draft impact",
                      ebaySandboxIntegrationReadiness.draftImpact,
                    ],
                    [
                      "Publication impact",
                      ebaySandboxIntegrationReadiness.publicationImpact,
                    ],
                    [
                      ebaySandboxIntegrationReadinessCopy.officialValidation,
                      ebaySandboxIntegrationReadiness.integrationReadiness
                        .scopesValidatedAgainstOfficialDocs,
                    ],
                  ]}
                />
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Integration Readiness
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={Object.entries(
                      ebaySandboxIntegrationReadiness.integrationReadiness
                    )}
                  />
                </div>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Developer Account Readiness
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={Object.entries(
                      ebaySandboxIntegrationReadiness.developerAccountReadiness
                    )}
                  />
                </div>
                <p className="mt-4 rounded-2xl border border-cyan-300/20 bg-cyan-300/[0.045] p-4 text-sm leading-6 text-cyan-50/80">
                  {ebaySandboxIntegrationReadinessCopy.developerCredentials}.{" "}
                  {ebaySandboxIntegrationReadinessCopy.neverStoreSellerPasswords}.
                </p>
              </article>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Sandbox Application Readiness
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={Object.entries(
                      ebaySandboxIntegrationReadiness.sandboxApplicationReadiness
                    )}
                  />
                </div>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  OAuth Readiness
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={Object.entries(
                      ebaySandboxIntegrationReadiness.oauthReadiness
                    )}
                  />
                </div>
              </article>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Scope Validation Readiness
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={Object.entries(
                      ebaySandboxIntegrationReadiness.scopeValidationReadiness
                    )}
                  />
                </div>
                <p className="mt-4 rounded-2xl border border-amber-300/20 bg-amber-300/[0.045] p-4 text-sm leading-6 text-amber-50/80">
                  {ebaySandboxIntegrationReadiness.scopeValidationReadiness.notes}
                </p>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Secret Handling Readiness
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={Object.entries(
                      ebaySandboxIntegrationReadiness.secretHandlingReadiness
                    )}
                  />
                </div>
              </article>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
              <h4 className="text-sm font-black text-white">
                Required Readiness Checks
              </h4>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {ebaySandboxIntegrationReadiness.requiredReadinessChecks.map((check) => (
                  <article
                    key={check.checkId}
                    className="rounded-xl border border-white/10 bg-white/[0.03] p-4"
                  >
                    <p className="break-words text-sm font-black leading-6 text-white [overflow-wrap:anywhere]">
                      {check.label}
                    </p>
                    <p className="mt-2 break-words text-[11px] font-bold uppercase leading-5 tracking-[0.08em] text-amber-100/70 [overflow-wrap:anywhere]">
                      {check.status}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-white/60">
                      {check.reason}
                    </p>
                  </article>
                ))}
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Blocked Workflows
                </h4>
                <div className="mt-4 grid gap-3">
                  {ebaySandboxIntegrationReadiness.blockedWorkflows.map((workflow) => (
                    <div
                      key={workflow.workflow}
                      className="rounded-xl border border-white/10 bg-white/[0.03] p-3"
                    >
                      <p className="break-words text-sm font-bold text-white [overflow-wrap:anywhere]">
                        {workflow.workflow}
                      </p>
                      <p className="mt-1 break-words text-[11px] font-bold uppercase leading-5 tracking-[0.08em] text-amber-100/70 [overflow-wrap:anywhere]">
                        {workflow.status}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-white/60">
                        {workflow.reason}
                      </p>
                    </div>
                  ))}
                </div>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Required Human Actions
                </h4>
                <div className="mt-4">
                  <ListBlock
                    items={
                      ebaySandboxIntegrationReadiness.requiredHumanActions
                    }
                  />
                </div>
              </article>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Next Recommended Loop
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={[
                      [
                        ebaySandboxIntegrationReadinessCopy.nextRecommendedLoop,
                        ebaySandboxIntegrationReadiness.nextRecommendedLoop.loop,
                      ],
                      [
                        "Reason",
                        ebaySandboxIntegrationReadiness.nextRecommendedLoop.reason,
                      ],
                    ]}
                  />
                </div>
                <div className="mt-4">
                  <ListBlock
                    items={
                      ebaySandboxIntegrationReadiness.nextRecommendedLoop
                        .constraints
                    }
                  />
                </div>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Compact Safety Flags
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={Object.entries(
                      ebaySandboxIntegrationReadiness.safetyFlags
                    )}
                  />
                </div>
              </article>
            </div>
          </div>
        </Section>

        <Section title="eBay Sandbox OAuth Flow Design">
          <div className="grid gap-5">
            <div className="rounded-3xl border border-white/10 bg-black/20 p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="break-words text-[11px] font-semibold uppercase leading-5 tracking-[0.08em] text-cyan-100/60 [overflow-wrap:anywhere]">
                    {ebaySandboxOauthFlowDesign.oauthDesignVersion}
                  </p>
                  <h3 className="mt-2 text-xl font-black text-white">
                    {ebaySandboxOauthFlowDesignCopy.title}
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-white/65">
                    {ebaySandboxOauthFlowDesign.oauthSummary}
                  </p>
                </div>

                <div className="grid gap-3 text-sm font-bold text-white lg:min-w-[360px]">
                  <span className="break-words rounded-2xl border border-rose-300/20 bg-rose-300/[0.06] px-4 py-3 [overflow-wrap:anywhere]">
                    {ebaySandboxOauthFlowDesignCopy.oauthStatus}
                  </span>
                  <span className="break-words rounded-2xl border border-rose-300/20 bg-rose-300/[0.06] px-4 py-3 [overflow-wrap:anywhere]">
                    {ebaySandboxOauthFlowDesignCopy.oauthDecision}
                  </span>
                  <span className="break-words rounded-2xl border border-amber-300/20 bg-amber-300/[0.06] px-4 py-3 [overflow-wrap:anywhere]">
                    {ebaySandboxOauthFlowDesignCopy.sellerAuthorizationStatus}
                  </span>
                </div>
              </div>

              <div className="mt-5">
                <FieldGrid
                  fields={[
                    [
                      "OAuth status",
                      ebaySandboxOauthFlowDesign.oauthStatus,
                    ],
                    [
                      "OAuth decision",
                      ebaySandboxOauthFlowDesign.oauthDecision,
                    ],
                    [
                      "Seller authorization status",
                      ebaySandboxOauthFlowDesign.sellerAuthorizationStatus,
                    ],
                    [
                      "Credential status",
                      ebaySandboxOauthFlowDesign.credentialStatus,
                    ],
                    [
                      "Redirect status",
                      ebaySandboxOauthFlowDesign.redirectStatus,
                    ],
                    [
                      "Scope status",
                      ebaySandboxOauthFlowDesign.scopeStatus,
                    ],
                    [
                      "Token status",
                      ebaySandboxOauthFlowDesign.tokenStatus,
                    ],
                    [
                      "API status",
                      ebaySandboxOauthFlowDesign.apiStatus,
                    ],
                    [
                      "Draft impact",
                      ebaySandboxOauthFlowDesign.draftImpact,
                    ],
                    [
                      "Publication impact",
                      ebaySandboxOauthFlowDesign.publicationImpact,
                    ],
                    [
                      ebaySandboxOauthFlowDesignCopy.sellerConsent,
                      ebaySandboxOauthFlowDesign.oauthReadiness
                        .sellerConsentStarted,
                    ],
                  ]}
                />
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  OAuth Readiness
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={Object.entries(
                      ebaySandboxOauthFlowDesign.oauthReadiness
                    )}
                  />
                </div>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Seller Authorization Model
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={Object.entries(
                      ebaySandboxOauthFlowDesign.sellerAuthorizationModel
                    )}
                  />
                </div>
                <p className="mt-4 rounded-2xl border border-cyan-300/20 bg-cyan-300/[0.045] p-4 text-sm leading-6 text-cyan-50/80">
                  {ebaySandboxOauthFlowDesignCopy.developerCredentials}.{" "}
                  {ebaySandboxOauthFlowDesignCopy.sellerAuthorizes}.{" "}
                  {ebaySandboxOauthFlowDesignCopy.neverStoreSellerPasswords}.
                </p>
              </article>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
              <h4 className="text-sm font-black text-white">
                OAuth Flow Phases
              </h4>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {ebaySandboxOauthFlowDesign.oauthFlowPhases.map((phase) => (
                  <article
                    key={phase.phaseId}
                    className="rounded-xl border border-white/10 bg-white/[0.03] p-4"
                  >
                    <p className="break-words text-sm font-black leading-6 text-white [overflow-wrap:anywhere]">
                      {phase.label}
                    </p>
                    <p className="mt-2 break-words text-[11px] font-bold uppercase leading-5 tracking-[0.08em] text-amber-100/70 [overflow-wrap:anywhere]">
                      {phase.status}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-white/60">
                      {phase.reason}
                    </p>
                  </article>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
              <h4 className="text-sm font-black text-white">
                Required OAuth Checks
              </h4>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {ebaySandboxOauthFlowDesign.requiredOauthChecks.map((check) => (
                  <article
                    key={check.checkId}
                    className="rounded-xl border border-white/10 bg-white/[0.03] p-4"
                  >
                    <p className="break-words text-sm font-black leading-6 text-white [overflow-wrap:anywhere]">
                      {check.label}
                    </p>
                    <p className="mt-2 break-words text-[11px] font-bold uppercase leading-5 tracking-[0.08em] text-amber-100/70 [overflow-wrap:anywhere]">
                      {check.status}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-white/60">
                      {check.reason}
                    </p>
                  </article>
                ))}
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Blocked Workflows
                </h4>
                <div className="mt-4 grid gap-3">
                  {ebaySandboxOauthFlowDesign.blockedWorkflows.map((workflow) => (
                    <div
                      key={workflow.workflow}
                      className="rounded-xl border border-white/10 bg-white/[0.03] p-3"
                    >
                      <p className="break-words text-sm font-bold text-white [overflow-wrap:anywhere]">
                        {workflow.workflow}
                      </p>
                      <p className="mt-1 break-words text-[11px] font-bold uppercase leading-5 tracking-[0.08em] text-amber-100/70 [overflow-wrap:anywhere]">
                        {workflow.status}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-white/60">
                        {workflow.reason}
                      </p>
                    </div>
                  ))}
                </div>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Required Human Actions
                </h4>
                <div className="mt-4">
                  <ListBlock
                    items={
                      ebaySandboxOauthFlowDesign.requiredHumanActions
                    }
                  />
                </div>
              </article>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Next Recommended Loop
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={[
                      [
                        ebaySandboxOauthFlowDesignCopy.nextRecommendedLoop,
                        ebaySandboxOauthFlowDesign.nextRecommendedLoop.loop,
                      ],
                      [
                        "Reason",
                        ebaySandboxOauthFlowDesign.nextRecommendedLoop.reason,
                      ],
                    ]}
                  />
                </div>
                <div className="mt-4">
                  <ListBlock
                    items={
                      ebaySandboxOauthFlowDesign.nextRecommendedLoop
                        .constraints
                    }
                  />
                </div>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Compact Safety Flags
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={Object.entries(
                      ebaySandboxOauthFlowDesign.safetyFlags
                    )}
                  />
                </div>
              </article>
            </div>
          </div>
        </Section>

        <Section title="eBay Secret and Environment Strategy">
          <div className="grid gap-5">
            <div className="rounded-3xl border border-white/10 bg-black/20 p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="break-words text-[11px] font-semibold uppercase leading-5 tracking-[0.08em] text-cyan-100/60 [overflow-wrap:anywhere]">
                    {ebaySecretEnvironmentStrategy.strategyVersion}
                  </p>
                  <h3 className="mt-2 text-xl font-black text-white">
                    {ebaySecretEnvironmentStrategyCopy.title}
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-white/65">
                    {ebaySecretEnvironmentStrategy.strategySummary}
                  </p>
                </div>

                <div className="grid gap-3 text-sm font-bold text-white lg:min-w-[360px]">
                  <span className="break-words rounded-2xl border border-rose-300/20 bg-rose-300/[0.06] px-4 py-3 [overflow-wrap:anywhere]">
                    {ebaySecretEnvironmentStrategyCopy.strategyStatus}
                  </span>
                  <span className="break-words rounded-2xl border border-rose-300/20 bg-rose-300/[0.06] px-4 py-3 [overflow-wrap:anywhere]">
                    {ebaySecretEnvironmentStrategyCopy.strategyDecision}
                  </span>
                  <span className="break-words rounded-2xl border border-amber-300/20 bg-amber-300/[0.06] px-4 py-3 [overflow-wrap:anywhere]">
                    {ebaySecretEnvironmentStrategyCopy.environmentStrategy}
                  </span>
                </div>
              </div>

              <div className="mt-5">
                <FieldGrid
                  fields={[
                    [
                      "Environment strategy",
                      ebaySecretEnvironmentStrategy.environmentStrategy,
                    ],
                    [
                      "Strategy status",
                      ebaySecretEnvironmentStrategy.strategyStatus,
                    ],
                    [
                      "Strategy decision",
                      ebaySecretEnvironmentStrategy.strategyDecision,
                    ],
                    [
                      "Credential status",
                      ebaySecretEnvironmentStrategy.credentialStatus,
                    ],
                    [
                      "Secret status",
                      ebaySecretEnvironmentStrategy.secretStatus,
                    ],
                    [
                      "Token status",
                      ebaySecretEnvironmentStrategy.tokenStatus,
                    ],
                    [
                      "Storage status",
                      ebaySecretEnvironmentStrategy.storageStatus,
                    ],
                    [
                      "Log status",
                      ebaySecretEnvironmentStrategy.logStatus,
                    ],
                    [
                      "Production status",
                      ebaySecretEnvironmentStrategy.productionStatus,
                    ],
                    [
                      "Draft impact",
                      ebaySecretEnvironmentStrategy.draftImpact,
                    ],
                    [
                      "Publication impact",
                      ebaySecretEnvironmentStrategy.publicationImpact,
                    ],
                  ]}
                />
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Environment Readiness
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={Object.entries(
                      ebaySecretEnvironmentStrategy.environmentReadiness
                    )}
                  />
                </div>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Server-Only Policy
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={Object.entries(
                      ebaySecretEnvironmentStrategy.serverOnlyPolicy
                    )}
                  />
                </div>
                <p className="mt-4 rounded-2xl border border-cyan-300/20 bg-cyan-300/[0.045] p-4 text-sm leading-6 text-cyan-50/80">
                  {ebaySecretEnvironmentStrategyCopy.secretsNeverCommitted}.{" "}
                  {ebaySecretEnvironmentStrategyCopy.secretsNeverFrontend}.{" "}
                  {ebaySecretEnvironmentStrategyCopy.neverStoreSellerPasswords}.
                </p>
              </article>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
              <h4 className="text-sm font-black text-white">
                Secret Categories
              </h4>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {ebaySecretEnvironmentStrategy.secretCategories.map((category) => (
                  <article
                    key={category.categoryId}
                    className="rounded-xl border border-white/10 bg-white/[0.03] p-4"
                  >
                    <p className="break-words text-sm font-black leading-6 text-white [overflow-wrap:anywhere]">
                      {category.label}
                    </p>
                    <p className="mt-2 break-words text-[11px] font-bold uppercase leading-5 tracking-[0.08em] text-amber-100/70 [overflow-wrap:anywhere]">
                      {category.status}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-white/60">
                      {category.reason}
                    </p>
                  </article>
                ))}
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Storage Rules
                </h4>
                <div className="mt-4 grid gap-3">
                  {ebaySecretEnvironmentStrategy.storageRules.map((rule) => (
                    <div
                      key={rule.ruleId}
                      className="rounded-xl border border-white/10 bg-white/[0.03] p-3"
                    >
                      <p className="break-words text-sm font-bold text-white [overflow-wrap:anywhere]">
                        {rule.label}
                      </p>
                      <p className="mt-1 break-words text-[11px] font-bold uppercase leading-5 tracking-[0.08em] text-amber-100/70 [overflow-wrap:anywhere]">
                        {rule.status}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-white/60">
                        {rule.reason}
                      </p>
                    </div>
                  ))}
                </div>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Log Redaction Rules
                </h4>
                <div className="mt-4 grid gap-3">
                  {ebaySecretEnvironmentStrategy.logRedactionRules.map((rule) => (
                    <div
                      key={rule.ruleId}
                      className="rounded-xl border border-white/10 bg-white/[0.03] p-3"
                    >
                      <p className="break-words text-sm font-bold text-white [overflow-wrap:anywhere]">
                        {rule.label}
                      </p>
                      <p className="mt-1 break-words text-[11px] font-bold uppercase leading-5 tracking-[0.08em] text-amber-100/70 [overflow-wrap:anywhere]">
                        {rule.status}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-white/60">
                        {rule.reason}
                      </p>
                    </div>
                  ))}
                </div>
              </article>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
              <h4 className="text-sm font-black text-white">
                Required Strategy Checks
              </h4>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {ebaySecretEnvironmentStrategy.requiredStrategyChecks.map((check) => (
                  <article
                    key={check.checkId}
                    className="rounded-xl border border-white/10 bg-white/[0.03] p-4"
                  >
                    <p className="break-words text-sm font-black leading-6 text-white [overflow-wrap:anywhere]">
                      {check.label}
                    </p>
                    <p className="mt-2 break-words text-[11px] font-bold uppercase leading-5 tracking-[0.08em] text-amber-100/70 [overflow-wrap:anywhere]">
                      {check.status}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-white/60">
                      {check.reason}
                    </p>
                  </article>
                ))}
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Blocked Workflows
                </h4>
                <div className="mt-4 grid gap-3">
                  {ebaySecretEnvironmentStrategy.blockedWorkflows.map((workflow) => (
                    <div
                      key={workflow.workflow}
                      className="rounded-xl border border-white/10 bg-white/[0.03] p-3"
                    >
                      <p className="break-words text-sm font-bold text-white [overflow-wrap:anywhere]">
                        {workflow.workflow}
                      </p>
                      <p className="mt-1 break-words text-[11px] font-bold uppercase leading-5 tracking-[0.08em] text-amber-100/70 [overflow-wrap:anywhere]">
                        {workflow.status}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-white/60">
                        {workflow.reason}
                      </p>
                    </div>
                  ))}
                </div>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Required Human Actions
                </h4>
                <div className="mt-4">
                  <ListBlock
                    items={
                      ebaySecretEnvironmentStrategy.requiredHumanActions
                    }
                  />
                </div>
              </article>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Next Recommended Loop
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={[
                      [
                        ebaySecretEnvironmentStrategyCopy.nextRecommendedLoop,
                        ebaySecretEnvironmentStrategy.nextRecommendedLoop.loop,
                      ],
                      [
                        "Reason",
                        ebaySecretEnvironmentStrategy.nextRecommendedLoop.reason,
                      ],
                    ]}
                  />
                </div>
                <div className="mt-4">
                  <ListBlock
                    items={
                      ebaySecretEnvironmentStrategy.nextRecommendedLoop
                        .constraints
                    }
                  />
                </div>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Compact Safety Flags
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={Object.entries(
                      ebaySecretEnvironmentStrategy.safetyFlags
                    )}
                  />
                </div>
              </article>
            </div>
          </div>
        </Section>

        <Section title="eBay Sandbox OAuth Scaffold">
          <div className="grid gap-5">
            <div className="rounded-3xl border border-white/10 bg-black/20 p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="break-words text-[11px] font-semibold uppercase leading-5 tracking-[0.08em] text-cyan-100/60 [overflow-wrap:anywhere]">
                    {ebaySandboxOauthScaffold.scaffoldVersion}
                  </p>
                  <h3 className="mt-2 text-xl font-black text-white">
                    {ebaySandboxOauthScaffoldCopy.title}
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-white/65">
                    {ebaySandboxOauthScaffold.scaffoldSummary}
                  </p>
                </div>

                <div className="grid gap-3 text-sm font-bold text-white lg:min-w-[360px]">
                  <span className="break-words rounded-2xl border border-rose-300/20 bg-rose-300/[0.06] px-4 py-3 [overflow-wrap:anywhere]">
                    {ebaySandboxOauthScaffoldCopy.scaffoldStatus}
                  </span>
                  <span className="break-words rounded-2xl border border-rose-300/20 bg-rose-300/[0.06] px-4 py-3 [overflow-wrap:anywhere]">
                    {ebaySandboxOauthScaffoldCopy.scaffoldDecision}
                  </span>
                  <span className="break-words rounded-2xl border border-amber-300/20 bg-amber-300/[0.06] px-4 py-3 [overflow-wrap:anywhere]">
                    {ebaySandboxOauthScaffoldCopy.implementationMode}
                  </span>
                </div>
              </div>

              <div className="mt-5">
                <FieldGrid
                  fields={[
                    [
                      "Scaffold status",
                      ebaySandboxOauthScaffold.scaffoldStatus,
                    ],
                    [
                      "Scaffold decision",
                      ebaySandboxOauthScaffold.scaffoldDecision,
                    ],
                    [
                      "Implementation mode",
                      ebaySandboxOauthScaffold.implementationMode,
                    ],
                    [
                      "Route status",
                      ebaySandboxOauthScaffold.routeStatus,
                    ],
                    [
                      "Auth URL status",
                      ebaySandboxOauthScaffold.authUrlStatus,
                    ],
                    [
                      "Callback status",
                      ebaySandboxOauthScaffold.callbackStatus,
                    ],
                    [
                      "Token status",
                      ebaySandboxOauthScaffold.tokenStatus,
                    ],
                    [
                      "API status",
                      ebaySandboxOauthScaffold.apiStatus,
                    ],
                    [
                      "Draft impact",
                      ebaySandboxOauthScaffold.draftImpact,
                    ],
                    [
                      "Publication impact",
                      ebaySandboxOauthScaffold.publicationImpact,
                    ],
                  ]}
                />
              </div>

              <p className="mt-4 rounded-2xl border border-cyan-300/20 bg-cyan-300/[0.045] p-4 text-sm leading-6 text-cyan-50/80">
                {ebaySandboxOauthScaffoldCopy.noAuthUrl}.{" "}
                {ebaySandboxOauthScaffoldCopy.noCallbackProcessing}.{" "}
                {ebaySandboxOauthScaffoldCopy.noEnvironmentReads}.
              </p>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Scaffold Readiness
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={Object.entries(
                      ebaySandboxOauthScaffold.scaffoldReadiness
                    )}
                  />
                </div>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Route Scaffold
                </h4>
                <div className="mt-4 grid gap-3">
                  {Object.entries(ebaySandboxOauthScaffold.routeScaffold).map(
                    ([routeKey, route]) => (
                      <div
                        key={routeKey}
                        className="rounded-xl border border-white/10 bg-white/[0.03] p-3"
                      >
                        <p className="break-words text-sm font-bold text-white [overflow-wrap:anywhere]">
                          {route.path}
                        </p>
                        <p className="mt-1 break-words text-[11px] font-bold uppercase leading-5 tracking-[0.08em] text-amber-100/70 [overflow-wrap:anywhere]">
                          {route.method} · {route.status}
                        </p>
                        <p className="mt-2 text-sm leading-6 text-white/60">
                          {route.allowedBehavior}
                        </p>
                        <p className="mt-2 text-sm leading-6 text-white/50">
                          {route.forbiddenBehavior}
                        </p>
                      </div>
                    )
                  )}
                </div>
              </article>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
              <h4 className="text-sm font-black text-white">
                Blocked Responses
              </h4>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                {Object.entries(ebaySandboxOauthScaffold.blockedResponses).map(
                  ([responseKey, payload]) => (
                    <article
                      key={responseKey}
                      className="rounded-xl border border-white/10 bg-white/[0.03] p-4"
                    >
                      <p className="break-words text-sm font-black leading-6 text-white [overflow-wrap:anywhere]">
                        {responseKey}
                      </p>
                      <p className="mt-2 break-words text-[11px] font-bold uppercase leading-5 tracking-[0.08em] text-amber-100/70 [overflow-wrap:anywhere]">
                        {payload.code}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-white/60">
                        {payload.message}
                      </p>
                    </article>
                  )
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
              <h4 className="text-sm font-black text-white">
                Required Scaffold Checks
              </h4>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {ebaySandboxOauthScaffold.requiredScaffoldChecks.map((check) => (
                  <article
                    key={check.checkId}
                    className="rounded-xl border border-white/10 bg-white/[0.03] p-4"
                  >
                    <p className="break-words text-sm font-black leading-6 text-white [overflow-wrap:anywhere]">
                      {check.label}
                    </p>
                    <p className="mt-2 break-words text-[11px] font-bold uppercase leading-5 tracking-[0.08em] text-amber-100/70 [overflow-wrap:anywhere]">
                      {check.status}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-white/60">
                      {check.reason}
                    </p>
                  </article>
                ))}
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Blocked Workflows
                </h4>
                <div className="mt-4 grid gap-3">
                  {ebaySandboxOauthScaffold.blockedWorkflows.map((workflow) => (
                    <div
                      key={workflow.workflow}
                      className="rounded-xl border border-white/10 bg-white/[0.03] p-3"
                    >
                      <p className="break-words text-sm font-bold text-white [overflow-wrap:anywhere]">
                        {workflow.workflow}
                      </p>
                      <p className="mt-1 break-words text-[11px] font-bold uppercase leading-5 tracking-[0.08em] text-amber-100/70 [overflow-wrap:anywhere]">
                        {workflow.status}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-white/60">
                        {workflow.reason}
                      </p>
                    </div>
                  ))}
                </div>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Required Human Actions
                </h4>
                <div className="mt-4">
                  <ListBlock
                    items={
                      ebaySandboxOauthScaffold.requiredHumanActions
                    }
                  />
                </div>
              </article>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Next Recommended Loop
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={[
                      [
                        ebaySandboxOauthScaffoldCopy.nextRecommendedLoop,
                        ebaySandboxOauthScaffold.nextRecommendedLoop.loop,
                      ],
                      [
                        "Reason",
                        ebaySandboxOauthScaffold.nextRecommendedLoop.reason,
                      ],
                    ]}
                  />
                </div>
                <div className="mt-4">
                  <ListBlock
                    items={
                      ebaySandboxOauthScaffold.nextRecommendedLoop
                        .constraints
                    }
                  />
                </div>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Compact Safety Flags
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={Object.entries(
                      ebaySandboxOauthScaffold.safetyFlags
                    )}
                  />
                </div>
              </article>
            </div>
          </div>
        </Section>

        <Section title="eBay Sandbox Credentials / Env Configuration">
          <div className="grid gap-5">
            <div className="rounded-3xl border border-white/10 bg-black/20 p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="break-words text-[11px] font-semibold uppercase leading-5 tracking-[0.08em] text-cyan-100/60 [overflow-wrap:anywhere]">
                    {ebaySandboxCredentialsEnvConfiguration.configurationVersion}
                  </p>
                  <h3 className="mt-2 text-xl font-black text-white">
                    {ebaySandboxCredentialsEnvConfigurationCopy.title}
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-white/65">
                    {ebaySandboxCredentialsEnvConfiguration.configurationSummary}
                  </p>
                </div>

                <div className="grid gap-3 text-sm font-bold text-white lg:min-w-[360px]">
                  <span className="break-words rounded-2xl border border-rose-300/20 bg-rose-300/[0.06] px-4 py-3 [overflow-wrap:anywhere]">
                    {ebaySandboxCredentialsEnvConfigurationCopy.configurationStatus}
                  </span>
                  <span className="break-words rounded-2xl border border-rose-300/20 bg-rose-300/[0.06] px-4 py-3 [overflow-wrap:anywhere]">
                    {ebaySandboxCredentialsEnvConfigurationCopy.configurationDecision}
                  </span>
                  <span className="break-words rounded-2xl border border-amber-300/20 bg-amber-300/[0.06] px-4 py-3 [overflow-wrap:anywhere]">
                    {ebaySandboxCredentialsEnvConfigurationCopy.serverOnlyStatus}
                  </span>
                </div>
              </div>

              <div className="mt-5">
                <FieldGrid
                  fields={[
                    [
                      "Configuration status",
                      ebaySandboxCredentialsEnvConfiguration.configurationStatus,
                    ],
                    [
                      "Configuration decision",
                      ebaySandboxCredentialsEnvConfiguration.configurationDecision,
                    ],
                    [
                      "Server-only status",
                      ebaySandboxCredentialsEnvConfiguration.serverOnlyStatus,
                    ],
                    [
                      "Credential status",
                      ebaySandboxCredentialsEnvConfiguration.credentialStatus,
                    ],
                    [
                      "Secret status",
                      ebaySandboxCredentialsEnvConfiguration.secretStatus,
                    ],
                    [
                      "Token status",
                      ebaySandboxCredentialsEnvConfiguration.tokenStatus,
                    ],
                    [
                      "OAuth status",
                      ebaySandboxCredentialsEnvConfiguration.oauthStatus,
                    ],
                    [
                      "API status",
                      ebaySandboxCredentialsEnvConfiguration.apiStatus,
                    ],
                    [
                      "Draft impact",
                      ebaySandboxCredentialsEnvConfiguration.draftImpact,
                    ],
                    [
                      "Publication impact",
                      ebaySandboxCredentialsEnvConfiguration.publicationImpact,
                    ],
                  ]}
                />
              </div>

              <p className="mt-4 rounded-2xl border border-cyan-300/20 bg-cyan-300/[0.045] p-4 text-sm leading-6 text-cyan-50/80">
                {ebaySandboxCredentialsEnvConfigurationCopy.presenceOnly}.{" "}
                {ebaySandboxCredentialsEnvConfigurationCopy.neverReturnValues}.
              </p>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Environment Readiness
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={Object.entries(
                      ebaySandboxCredentialsEnvConfiguration.environmentReadiness
                    )}
                  />
                </div>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Env Status Contract
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={[
                      [
                        "Route path",
                        ebaySandboxCredentialsEnvConfiguration.envStatusContract
                          .routePath,
                      ],
                      [
                        "Method",
                        ebaySandboxCredentialsEnvConfiguration.envStatusContract
                          .method,
                      ],
                      [
                        "Blocked response code",
                        ebaySandboxCredentialsEnvConfiguration.envStatusContract
                          .blockedResponseCode,
                      ],
                      [
                        "Value exposure policy",
                        ebaySandboxCredentialsEnvConfiguration.envStatusContract
                          .valueExposurePolicy,
                      ],
                    ]}
                  />
                </div>
                <div className="mt-4">
                  <ListBlock
                    items={
                      ebaySandboxCredentialsEnvConfiguration.envStatusContract
                        .allowedBehavior
                    }
                  />
                </div>
              </article>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
              <h4 className="text-sm font-black text-white">
                Required Environment Keys
              </h4>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {ebaySandboxCredentialsEnvConfiguration.requiredEnvironmentKeys.map((envKey) => (
                  <article
                    key={envKey.key}
                    className="rounded-xl border border-white/10 bg-white/[0.03] p-4"
                  >
                    <p className="break-words text-sm font-black leading-6 text-white [overflow-wrap:anywhere]">
                      {envKey.key}
                    </p>
                    <p className="mt-2 break-words text-[11px] font-bold uppercase leading-5 tracking-[0.08em] text-amber-100/70 [overflow-wrap:anywhere]">
                      {envKey.status} · {envKey.category}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-white/60">
                      {envKey.label}
                    </p>
                  </article>
                ))}
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Server-Only Rules
                </h4>
                <div className="mt-4 grid gap-3">
                  {ebaySandboxCredentialsEnvConfiguration.serverOnlyRules.map((rule) => (
                    <div
                      key={rule.ruleId}
                      className="rounded-xl border border-white/10 bg-white/[0.03] p-3"
                    >
                      <p className="break-words text-sm font-bold text-white [overflow-wrap:anywhere]">
                        {rule.label}
                      </p>
                      <p className="mt-1 break-words text-[11px] font-bold uppercase leading-5 tracking-[0.08em] text-amber-100/70 [overflow-wrap:anywhere]">
                        {rule.status}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-white/60">
                        {rule.reason}
                      </p>
                    </div>
                  ))}
                </div>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Blocked Workflows
                </h4>
                <div className="mt-4 grid gap-3">
                  {ebaySandboxCredentialsEnvConfiguration.blockedWorkflows.map((workflow) => (
                    <div
                      key={workflow.workflow}
                      className="rounded-xl border border-white/10 bg-white/[0.03] p-3"
                    >
                      <p className="break-words text-sm font-bold text-white [overflow-wrap:anywhere]">
                        {workflow.workflow}
                      </p>
                      <p className="mt-1 break-words text-[11px] font-bold uppercase leading-5 tracking-[0.08em] text-amber-100/70 [overflow-wrap:anywhere]">
                        {workflow.status}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-white/60">
                        {workflow.reason}
                      </p>
                    </div>
                  ))}
                </div>
              </article>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Required Human Actions
                </h4>
                <div className="mt-4">
                  <ListBlock
                    items={
                      ebaySandboxCredentialsEnvConfiguration.requiredHumanActions
                    }
                  />
                </div>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Next Recommended Loop
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={[
                      [
                        ebaySandboxCredentialsEnvConfigurationCopy.nextRecommendedLoop,
                        ebaySandboxCredentialsEnvConfiguration.nextRecommendedLoop.loop,
                      ],
                      [
                        "Reason",
                        ebaySandboxCredentialsEnvConfiguration.nextRecommendedLoop
                          .reason,
                      ],
                    ]}
                  />
                </div>
                <div className="mt-4">
                  <ListBlock
                    items={
                      ebaySandboxCredentialsEnvConfiguration.nextRecommendedLoop
                        .constraints
                    }
                  />
                </div>
              </article>
            </div>

            <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
              <h4 className="text-sm font-black text-white">
                Compact Safety Flags
              </h4>
              <div className="mt-3">
                <FieldGrid
                  fields={Object.entries(
                    ebaySandboxCredentialsEnvConfiguration.safetyFlags
                  )}
                />
              </div>
            </article>
          </div>
        </Section>

        <Section title="eBay Listing Completion Workspace">
          <div className="grid gap-5">
            <div className="rounded-3xl border border-white/10 bg-black/20 p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="break-words text-[11px] font-semibold uppercase leading-5 tracking-[0.08em] text-cyan-100/60 [overflow-wrap:anywhere]">
                    {listingCompletionWorkspace.workspaceVersion}
                  </p>
                  <h3 className="mt-2 text-xl font-black text-white">
                    {ebayListingCompletionWorkspaceCopy.title}
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-white/65">
                    {listingCompletionWorkspace.workspaceSummary}
                  </p>
                </div>

                <div className="grid gap-3 text-sm font-bold text-white lg:min-w-[360px]">
                  <span className="break-words rounded-2xl border border-rose-300/20 bg-rose-300/[0.06] px-4 py-3 [overflow-wrap:anywhere]">
                    {ebayListingCompletionWorkspaceCopy.workspaceStatus}
                  </span>
                  <span className="break-words rounded-2xl border border-rose-300/20 bg-rose-300/[0.06] px-4 py-3 [overflow-wrap:anywhere]">
                    {ebayListingCompletionWorkspaceCopy.workspaceDecision}
                  </span>
                </div>
              </div>

              <div className="mt-5">
                <FieldGrid
                  fields={[
                    [
                      "Workspace status",
                      listingCompletionWorkspace.workspaceStatus,
                    ],
                    [
                      "Workspace decision",
                      listingCompletionWorkspace.workspaceDecision,
                    ],
                    [
                      "Draft readiness",
                      listingCompletionWorkspace.draftReadiness,
                    ],
                    [
                      "Publication readiness",
                      listingCompletionWorkspace.publicationReadiness,
                    ],
                    [
                      "Draft impact",
                      listingCompletionWorkspace.draftImpact,
                    ],
                    [
                      "Publication impact",
                      listingCompletionWorkspace.publicationImpact,
                    ],
                  ]}
                />
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
              <h4 className="text-sm font-black text-white">
                Listing Completion Sections
              </h4>
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                {listingCompletionWorkspace.readinessSections.map((section) => (
                  <article
                    key={section.sectionId}
                    className="rounded-xl border border-white/10 bg-white/[0.03] p-4"
                  >
                    <h5 className="break-words text-sm font-black text-white [overflow-wrap:anywhere]">
                      {section.label}
                    </h5>
                    <p className="mt-2 break-words text-[11px] font-bold uppercase leading-5 tracking-[0.08em] text-amber-100/70 [overflow-wrap:anywhere]">
                      {section.status}
                    </p>
                    <p className="mt-3 text-sm leading-6 text-white/60">
                      {section.requiredToUnlock}
                    </p>
                    <div className="mt-4">
                      <ListBlock items={section.missingInputs} />
                    </div>
                  </article>
                ))}
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Missing Critical Inputs
                </h4>
                <div className="mt-4">
                  <ListBlock
                    items={
                      listingCompletionWorkspace.missingCriticalInputs
                    }
                  />
                </div>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Next Recommended Action
                </h4>
                <p className="mt-3 rounded-xl border border-amber-300/20 bg-amber-300/[0.06] p-4 text-sm font-semibold leading-6 text-amber-50/80">
                  {listingCompletionWorkspace.nextRecommendedAction}
                </p>
                <div className="mt-4">
                  <FieldGrid
                    fields={[
                      [
                        "readyForSandboxDraftWhenConnected",
                        listingCompletionWorkspace.completionSummary
                          .readyForSandboxDraftWhenConnected,
                      ],
                      [
                        "draftImpact",
                        listingCompletionWorkspace.draftImpact,
                      ],
                      [
                        "publicationImpact",
                        listingCompletionWorkspace.publicationImpact,
                      ],
                    ]}
                  />
                </div>
              </article>
            </div>
          </div>
        </Section>

        <Section title="eBay Draft Mapping Dry Run">
          <div className="grid gap-5">
            <div className="rounded-3xl border border-white/10 bg-black/20 p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="break-words text-[11px] font-semibold uppercase leading-5 tracking-[0.08em] text-cyan-100/60 [overflow-wrap:anywhere]">
                    {draftMappingDryRun.mappingVersion}
                  </p>
                  <h3 className="mt-2 text-xl font-black text-white">
                    {ebayDraftMappingDryRunCopy.title}
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-white/65">
                    {draftMappingDryRun.mappingSummary}
                  </p>
                </div>

                <div className="grid gap-3 text-sm font-bold text-white lg:min-w-[360px]">
                  <span className="break-words rounded-2xl border border-rose-300/20 bg-rose-300/[0.06] px-4 py-3 [overflow-wrap:anywhere]">
                    {ebayDraftMappingDryRunCopy.mappingStatus}
                  </span>
                  <span className="break-words rounded-2xl border border-rose-300/20 bg-rose-300/[0.06] px-4 py-3 [overflow-wrap:anywhere]">
                    {ebayDraftMappingDryRunCopy.mappingDecision}
                  </span>
                </div>
              </div>

              <div className="mt-5">
                <FieldGrid
                  fields={[
                    [
                      "Mapping status",
                      draftMappingDryRun.mappingStatus,
                    ],
                    [
                      "Mapping decision",
                      draftMappingDryRun.mappingDecision,
                    ],
                    [
                      "Draft impact",
                      draftMappingDryRun.draftImpact,
                    ],
                    [
                      "Publication impact",
                      draftMappingDryRun.publicationImpact,
                    ],
                  ]}
                />
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
              <h4 className="text-sm font-black text-white">
                Planned eBay Draft Fields
              </h4>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {draftMappingDryRun.plannedEbayDraftFields.map((field) => (
                  <article
                    key={field.fieldId}
                    className="rounded-xl border border-white/10 bg-white/[0.03] p-4"
                  >
                    <h5 className="break-words text-sm font-black text-white [overflow-wrap:anywhere]">
                      {field.label}
                    </h5>
                    <div className="mt-3">
                      <FieldGrid
                        fields={[
                          [
                            "mapped",
                            field.mapped,
                          ],
                          [
                            "sourceReady",
                            field.sourceReady,
                          ],
                          [
                            "required",
                            field.required,
                          ],
                        ]}
                      />
                    </div>
                    <p className="mt-3 text-sm leading-6 text-white/60">
                      {field.reason}
                    </p>
                  </article>
                ))}
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Blocked Because
                </h4>
                <div className="mt-4">
                  <ListBlock items={draftMappingDryRun.blockedBecause} />
                </div>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Dry Run Decision
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={Object.entries(
                      draftMappingDryRun.dryRunDecision
                    )}
                  />
                </div>
              </article>
            </div>
          </div>
        </Section>

        <Section title="eBay First Listing Content Finalization">
          <div className="grid gap-5">
            <div className="rounded-3xl border border-white/10 bg-black/20 p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="break-words text-[11px] font-semibold uppercase leading-5 tracking-[0.08em] text-cyan-100/60 [overflow-wrap:anywhere]">
                    {firstListingContentFinalization.contentVersion}
                  </p>
                  <h3 className="mt-2 text-xl font-black text-white">
                    {ebayFirstListingContentFinalizationCopy.title}
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-white/65">
                    {firstListingContentFinalization.contentSummary}
                  </p>
                </div>

                <div className="grid gap-3 text-sm font-bold text-white lg:min-w-[360px]">
                  <span className="break-words rounded-2xl border border-rose-300/20 bg-rose-300/[0.06] px-4 py-3 [overflow-wrap:anywhere]">
                    {ebayFirstListingContentFinalizationCopy.contentStatus}
                  </span>
                  <span className="break-words rounded-2xl border border-rose-300/20 bg-rose-300/[0.06] px-4 py-3 [overflow-wrap:anywhere]">
                    {ebayFirstListingContentFinalizationCopy.contentDecision}
                  </span>
                  <span className="break-words rounded-2xl border border-amber-300/20 bg-amber-300/[0.06] px-4 py-3 [overflow-wrap:anywhere]">
                    {ebayFirstListingContentFinalizationCopy.keywordPolicyStatus}
                  </span>
                </div>
              </div>

              <div className="mt-5">
                <FieldGrid
                  fields={[
                    [
                      "Content status",
                      firstListingContentFinalization.contentStatus,
                    ],
                    [
                      "Content decision",
                      firstListingContentFinalization.contentDecision,
                    ],
                    [
                      "Keyword policy status",
                      firstListingContentFinalization.keywordPolicyStatus,
                    ],
                    [
                      "Draft impact",
                      firstListingContentFinalization.draftImpact,
                    ],
                    [
                      "Publication impact",
                      firstListingContentFinalization.publicationImpact,
                    ],
                  ]}
                />
              </div>

              <div className="mt-4 grid gap-3 lg:grid-cols-3">
                <p className="rounded-2xl border border-cyan-300/20 bg-cyan-300/[0.045] p-4 text-sm font-semibold leading-6 text-cyan-50/80">
                  {ebayFirstListingContentFinalizationCopy.marketIntelligenceRule}.
                </p>
                <p className="rounded-2xl border border-cyan-300/20 bg-cyan-300/[0.045] p-4 text-sm font-semibold leading-6 text-cyan-50/80">
                  {ebayFirstListingContentFinalizationCopy.trafficKeywordsRule}.
                </p>
                <p className="rounded-2xl border border-cyan-300/20 bg-cyan-300/[0.045] p-4 text-sm font-semibold leading-6 text-cyan-50/80">
                  {ebayFirstListingContentFinalizationCopy.portexFactsRule}.
                </p>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
              <h4 className="text-sm font-black text-white">
                Content Sections
              </h4>
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                {firstListingContentFinalization.contentSections.map((section) => (
                  <article
                    key={section.sectionId}
                    className="rounded-xl border border-white/10 bg-white/[0.03] p-4"
                  >
                    <h5 className="break-words text-sm font-black text-white [overflow-wrap:anywhere]">
                      {section.label}
                    </h5>
                    <p className="mt-2 break-words text-[11px] font-bold uppercase leading-5 tracking-[0.08em] text-amber-100/70 [overflow-wrap:anywhere]">
                      {section.status}
                    </p>
                    <p className="mt-3 text-sm leading-6 text-white/60">
                      {section.requiredToUnlock}
                    </p>
                    <div className="mt-4">
                      <ListBlock items={section.missingInputs} />
                    </div>
                  </article>
                ))}
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Keyword Intelligence Policy
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={[
                      [
                        "Policy status",
                        firstListingContentFinalization.keywordIntelligencePolicy
                          .policyStatus,
                      ],
                      [
                        "Core rule",
                        firstListingContentFinalization.keywordIntelligencePolicy
                          .coreRule,
                      ],
                    ]}
                  />
                </div>
                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  <div>
                    <p className="mb-3 break-words text-[11px] font-semibold uppercase leading-5 tracking-[0.08em] text-white/40 [overflow-wrap:anywhere]">
                      Allowed
                    </p>
                    <ListBlock
                      items={
                        firstListingContentFinalization.keywordIntelligencePolicy
                          .allowed
                      }
                    />
                  </div>
                  <div>
                    <p className="mb-3 break-words text-[11px] font-semibold uppercase leading-5 tracking-[0.08em] text-white/40 [overflow-wrap:anywhere]">
                      Blocked
                    </p>
                    <ListBlock
                      items={
                        firstListingContentFinalization.keywordIntelligencePolicy
                          .blocked
                      }
                    />
                  </div>
                </div>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Planned Listing Content
                </h4>
                <div className="mt-3 grid gap-3">
                  {Object.entries(
                    firstListingContentFinalization.plannedListingContent
                  ).map(([key, value]) => (
                    <div
                      key={key}
                      className="rounded-xl border border-white/10 bg-white/[0.03] p-3"
                    >
                      <p className="break-words text-sm font-bold text-white [overflow-wrap:anywhere]">
                        {key}
                      </p>
                      <div className="mt-3">
                        <FieldGrid
                          fields={Object.entries(value)}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Blocked Because
                </h4>
                <div className="mt-4">
                  <ListBlock
                    items={firstListingContentFinalization.blockedBecause}
                  />
                </div>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Required Human Actions
                </h4>
                <div className="mt-4">
                  <ListBlock
                    items={
                      firstListingContentFinalization.requiredHumanActions
                    }
                  />
                </div>
              </article>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Next Recommended Action
                </h4>
                <p className="mt-3 rounded-xl border border-amber-300/20 bg-amber-300/[0.06] p-4 text-sm font-semibold leading-6 text-amber-50/80">
                  {firstListingContentFinalization.nextRecommendedAction}
                </p>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Compact Safety Flags
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={Object.entries(
                      firstListingContentFinalization.safetyFlags
                    )}
                  />
                </div>
              </article>
            </div>
          </div>
        </Section>

        <Section title="eBay Listing Generator Service Dry Run">
          <div className="grid gap-5">
            <div className="rounded-3xl border border-white/10 bg-black/20 p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="break-words text-[11px] font-semibold uppercase leading-5 tracking-[0.08em] text-cyan-100/60 [overflow-wrap:anywhere]">
                    {listingGeneratorDryRun.generatorVersion}
                  </p>
                  <h3 className="mt-2 text-xl font-black text-white">
                    {ebayListingGeneratorDryRunCopy.title}
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-white/65">
                    {listingGeneratorDryRun.generatorSummary}
                  </p>
                </div>

                <div className="grid gap-3 text-sm font-bold text-white lg:min-w-[360px]">
                  <span className="break-words rounded-2xl border border-rose-300/20 bg-rose-300/[0.06] px-4 py-3 [overflow-wrap:anywhere]">
                    {ebayListingGeneratorDryRunCopy.generatorStatus}
                  </span>
                  <span className="break-words rounded-2xl border border-rose-300/20 bg-rose-300/[0.06] px-4 py-3 [overflow-wrap:anywhere]">
                    {ebayListingGeneratorDryRunCopy.generatorDecision}
                  </span>
                  <span className="break-words rounded-2xl border border-amber-300/20 bg-amber-300/[0.06] px-4 py-3 [overflow-wrap:anywhere]">
                    {ebayListingGeneratorDryRunCopy.dryRunMode}
                  </span>
                </div>
              </div>

              <div className="mt-5">
                <FieldGrid
                  fields={[
                    [
                      "Generator status",
                      listingGeneratorDryRun.generatorStatus,
                    ],
                    [
                      "Generator decision",
                      listingGeneratorDryRun.generatorDecision,
                    ],
                    [
                      "Dry run mode",
                      listingGeneratorDryRun.dryRunMode,
                    ],
                    [
                      "Output status",
                      listingGeneratorDryRun.outputStatus,
                    ],
                    [
                      "Draft impact",
                      listingGeneratorDryRun.draftImpact,
                    ],
                    [
                      "Publication impact",
                      listingGeneratorDryRun.publicationImpact,
                    ],
                  ]}
                />
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
              <h4 className="text-sm font-black text-white">
                Architecture Policy
              </h4>
              <div className="mt-3">
                <FieldGrid
                  fields={[
                    [
                      "Products",
                      ebayListingGeneratorDryRunCopy.productsRule,
                    ],
                    [
                      "Listing",
                      ebayListingGeneratorDryRunCopy.listingRule,
                    ],
                    [
                      "Benchmark",
                      ebayListingGeneratorDryRunCopy.benchmarkRule,
                    ],
                    [
                      "Gates",
                      ebayListingGeneratorDryRunCopy.gatesRule,
                    ],
                    [
                      "Operating principle",
                      listingGeneratorDryRun.architecturePolicy
                        .operatingPrinciple,
                    ],
                    [
                      "Product source of truth",
                      listingGeneratorDryRun.architecturePolicy
                        .productSourceOfTruth,
                    ],
                  ]}
                />
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Benchmark Keyword Policy
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={[
                      [
                        "Policy status",
                        listingGeneratorDryRun.benchmarkKeywordPolicy
                          .policyStatus,
                      ],
                      [
                        "Core rule",
                        listingGeneratorDryRun.benchmarkKeywordPolicy
                          .coreRule,
                      ],
                      [
                        "Keyword use allowed",
                        listingGeneratorDryRun.benchmarkKeywordPolicy
                          .keywordUseAllowed,
                      ],
                      [
                        "Competitor content copying allowed",
                        listingGeneratorDryRun.benchmarkKeywordPolicy
                          .competitorContentCopyingAllowed,
                      ],
                      [
                        "Competitor images copying allowed",
                        listingGeneratorDryRun.benchmarkKeywordPolicy
                          .competitorImagesCopyingAllowed,
                      ],
                    ]}
                  />
                </div>
                <div className="mt-4 grid gap-3">
                  {listingGeneratorDryRun.benchmarkKeywordPolicy.keywordClasses.map((keywordClass) => (
                    <article
                      key={keywordClass.classId}
                      className="rounded-xl border border-white/10 bg-white/[0.03] p-3"
                    >
                      <h5 className="text-sm font-bold text-white">
                        {keywordClass.label}
                      </h5>
                      <p className="mt-1 text-[11px] font-bold uppercase leading-5 tracking-[0.08em] text-amber-100/70">
                        allowed: {formatValue(keywordClass.allowed)}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-white/60">
                        {keywordClass.rule}
                      </p>
                    </article>
                  ))}
                </div>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Input Readiness
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={Object.entries(
                      listingGeneratorDryRun.inputReadiness
                    )}
                  />
                </div>
              </article>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
              <h4 className="text-sm font-black text-white">
                Planned Generation Outputs
              </h4>
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                {listingGeneratorDryRun.plannedGenerationOutputs.map((output) => (
                  <article
                    key={output.outputId}
                    className="rounded-xl border border-white/10 bg-white/[0.03] p-4"
                  >
                    <h5 className="break-words text-sm font-black text-white [overflow-wrap:anywhere]">
                      {output.label}
                    </h5>
                    <p className="mt-2 break-words text-[11px] font-bold uppercase leading-5 tracking-[0.08em] text-amber-100/70 [overflow-wrap:anywhere]">
                      {output.status}
                    </p>
                    <p className="mt-3 text-sm leading-6 text-white/60">
                      {output.reason}
                    </p>
                    <p className="mt-3 text-sm font-semibold text-cyan-50/80">
                      finalValueIncluded: {formatValue(output.finalValueIncluded)}
                    </p>
                  </article>
                ))}
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Dry Run Output
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={[
                      [
                        "structuredPlanGenerated",
                        listingGeneratorDryRun.dryRunOutput
                          .structuredPlanGenerated,
                      ],
                      [
                        "finalListingContentGenerated",
                        listingGeneratorDryRun.dryRunOutput
                          .finalListingContentGenerated,
                      ],
                      [
                        "ebayDraftMapped",
                        listingGeneratorDryRun.dryRunOutput.ebayDraftMapped,
                      ],
                      [
                        "ebayDraftCreated",
                        listingGeneratorDryRun.dryRunOutput.ebayDraftCreated,
                      ],
                      [
                        "publishedToEbay",
                        listingGeneratorDryRun.dryRunOutput.publishedToEbay,
                      ],
                    ]}
                  />
                </div>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Blocked Because
                </h4>
                <div className="mt-4">
                  <ListBlock items={listingGeneratorDryRun.blockedBecause} />
                </div>
              </article>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Required Human Actions
                </h4>
                <div className="mt-4">
                  <ListBlock
                    items={listingGeneratorDryRun.requiredHumanActions}
                  />
                </div>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Next Recommended Loop
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={[
                      [
                        ebayListingGeneratorDryRunCopy.nextRecommendedLoop,
                        listingGeneratorDryRun.nextRecommendedLoop.loop,
                      ],
                      [
                        "Reason",
                        listingGeneratorDryRun.nextRecommendedLoop.reason,
                      ],
                    ]}
                  />
                </div>
                <div className="mt-4">
                  <ListBlock
                    items={
                      listingGeneratorDryRun.nextRecommendedLoop.constraints
                    }
                  />
                </div>
              </article>
            </div>
          </div>
        </Section>

        <Section title="Product to eBay Listing Bridge">
          <div className="grid gap-5">
            <div className="rounded-3xl border border-white/10 bg-black/20 p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="break-words text-[11px] font-semibold uppercase leading-5 tracking-[0.08em] text-cyan-100/60 [overflow-wrap:anywhere]">
                    {productListingBridge.bridgeVersion}
                  </p>
                  <h3 className="mt-2 text-xl font-black text-white">
                    {productListingBridgeCopy.title}
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-white/65">
                    {productListingBridge.bridgeSummary}
                  </p>
                </div>

                <div className="grid gap-3 text-sm font-bold text-white lg:min-w-[360px]">
                  <span className="break-words rounded-2xl border border-cyan-300/20 bg-cyan-300/[0.06] px-4 py-3 [overflow-wrap:anywhere]">
                    {productListingBridgeCopy.bridgeStatus}
                  </span>
                  <span className="break-words rounded-2xl border border-amber-300/20 bg-amber-300/[0.06] px-4 py-3 [overflow-wrap:anywhere]">
                    {productListingBridgeCopy.previewStatus}
                  </span>
                  <span className="break-words rounded-2xl border border-rose-300/20 bg-rose-300/[0.06] px-4 py-3 [overflow-wrap:anywhere]">
                    {productListingBridgeCopy.draftImpact}
                  </span>
                </div>
              </div>

              <div className="mt-5">
                <FieldGrid
                  fields={[
                    [
                      "Bridge status",
                      productListingBridge.bridgeStatus,
                    ],
                    [
                      "Bridge decision",
                      productListingBridge.bridgeDecision,
                    ],
                    [
                      "Preview status",
                      productListingBridge.previewStatus,
                    ],
                    [
                      "Source-of-truth status",
                      productListingBridge.sourceOfTruthStatus,
                    ],
                    [
                      "Dry run mode",
                      productListingBridge.dryRunMode,
                    ],
                    [
                      "Draft impact",
                      productListingBridge.draftImpact,
                    ],
                    [
                      "Publication impact",
                      productListingBridge.publicationImpact,
                    ],
                  ]}
                />
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Architecture Policy
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={[
                      [
                        "Products",
                        productListingBridgeCopy.productsRule,
                      ],
                      [
                        "Listing",
                        productListingBridgeCopy.listingRule,
                      ],
                      [
                        "Benchmark",
                        productListingBridgeCopy.benchmarkRule,
                      ],
                      [
                        "Gates",
                        productListingBridgeCopy.gatesRule,
                      ],
                      [
                        "Operating principle",
                        productListingBridge.architecturePolicy
                          .operatingPrinciple,
                      ],
                      [
                        "Bridge role",
                        productListingBridge.architecturePolicy.bridgeRole,
                      ],
                    ]}
                  />
                </div>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Product Source Contract
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={[
                      [
                        "Source mode",
                        productListingBridge.productSourceContract.sourceMode,
                      ],
                      [
                        "Source module",
                        productListingBridge.productSourceContract.sourceModule,
                      ],
                      [
                        "Supplier source",
                        productListingBridge.productSourceContract.supplierSource,
                      ],
                      [
                        "Product ID",
                        productListingBridge.productSourceContract.productId,
                      ],
                      [
                        "Product fact authority",
                        productListingBridge.productSourceContract
                          .productFactAuthority,
                      ],
                    ]}
                  />
                </div>
              </article>
            </div>

            <div className="rounded-3xl border border-cyan-300/20 bg-cyan-300/[0.04] p-5">
              <h4 className="text-sm font-black text-white">
                {productListingBridgeCopy.previewTitle}
              </h4>
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <article className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <h5 className="text-sm font-black text-white">
                    Title candidate
                  </h5>
                  <p className="mt-3 break-words rounded-xl border border-white/10 bg-white/[0.04] p-4 text-lg font-black text-cyan-50 [overflow-wrap:anywhere]">
                    {
                      productListingBridge.generatedListingDraftPreview
                        .titleCandidate.value
                    }
                  </p>
                  <div className="mt-4">
                    <FieldGrid
                      fields={[
                        [
                          "Status",
                          productListingBridge.generatedListingDraftPreview
                            .titleCandidate.status,
                        ],
                        [
                          "Publishable",
                          productListingBridge.generatedListingDraftPreview
                            .publishable,
                        ],
                        [
                          "Final content",
                          productListingBridge.generatedListingDraftPreview
                            .finalContent,
                        ],
                      ]}
                    />
                  </div>
                </article>

                <article className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <h5 className="text-sm font-black text-white">
                    Item specifics preview
                  </h5>
                  <div className="mt-3 grid gap-3">
                    {productListingBridge.generatedListingDraftPreview.itemSpecificsDraft.specifics.map((specific) => (
                      <div
                        key={specific.name}
                        className="rounded-xl border border-white/10 bg-white/[0.03] p-3"
                      >
                        <p className="text-sm font-bold text-white">
                          {specific.name}: {specific.value}
                        </p>
                        <p className="mt-1 text-[11px] font-bold uppercase leading-5 tracking-[0.08em] text-amber-100/70">
                          final: {formatValue(specific.final)}
                        </p>
                      </div>
                    ))}
                  </div>
                </article>
              </div>

              <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
                <h5 className="text-sm font-black text-white">
                  Description preview
                </h5>
                <div className="mt-3 grid gap-3">
                  {productListingBridge.generatedListingDraftPreview.descriptionDraft.sections.map((section) => (
                    <article
                      key={section.section}
                      className="rounded-xl border border-white/10 bg-white/[0.03] p-3"
                    >
                      <h6 className="text-sm font-bold text-white">
                        {section.section}
                      </h6>
                      <p className="mt-2 text-sm leading-6 text-white/65">
                        {section.text}
                      </p>
                    </article>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  {productListingBridgeCopy.blockedFacts}
                </h4>
                <div className="mt-4 grid gap-3">
                  {productListingBridge.blockedUnconfirmedFacts.map((fact) => (
                    <article
                      key={fact.factId}
                      className="rounded-xl border border-white/10 bg-white/[0.03] p-3"
                    >
                      <h5 className="break-words text-sm font-black text-white [overflow-wrap:anywhere]">
                        {fact.factId}
                      </h5>
                      <p className="mt-1 break-words text-[11px] font-bold uppercase leading-5 tracking-[0.08em] text-amber-100/70 [overflow-wrap:anywhere]">
                        {fact.status}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-white/60">
                        {fact.reason}
                      </p>
                    </article>
                  ))}
                </div>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  {productListingBridgeCopy.gateResult}
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={[
                      [
                        productListingBridgeCopy.readinessScore,
                        productListingBridge.gateResult.readinessScore,
                      ],
                      [
                        "Can generate preview",
                        productListingBridge.gateResult.canGeneratePreview,
                      ],
                      [
                        "Can generate final listing",
                        productListingBridge.gateResult
                          .canGenerateFinalListing,
                      ],
                      [
                        "Can create eBay draft",
                        productListingBridge.gateResult.canCreateEbayDraft,
                      ],
                      [
                        "Can publish to eBay",
                        productListingBridge.gateResult.canPublishToEbay,
                      ],
                    ]}
                  />
                </div>
                <div className="mt-4">
                  <ListBlock
                    items={productListingBridge.gateResult.blockingGates}
                  />
                </div>
              </article>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  {productListingBridgeCopy.requiredHumanActions}
                </h4>
                <div className="mt-4">
                  <ListBlock items={productListingBridge.requiredHumanActions} />
                </div>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Next Recommended Loop
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={[
                      [
                        productListingBridgeCopy.nextRecommendedLoop,
                        productListingBridge.nextRecommendedLoop.loop,
                      ],
                      [
                        "Reason",
                        productListingBridge.nextRecommendedLoop.reason,
                      ],
                      [
                        "Expected outcome",
                        productListingBridge.nextRecommendedLoop
                          .expectedOutcome,
                      ],
                    ]}
                  />
                </div>
              </article>
            </div>
          </div>
        </Section>

        <Section title="First eBay Listing Draft Preview">
          <div className="grid gap-5">
            <div className="rounded-3xl border border-white/10 bg-black/20 p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="break-words text-[11px] font-semibold uppercase leading-5 tracking-[0.08em] text-cyan-100/60 [overflow-wrap:anywhere]">
                    {firstListingDraftPreview.draftPreviewVersion}
                  </p>
                  <h3 className="mt-2 text-xl font-black text-white">
                    {firstListingDraftPreviewCopy.title}
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-white/65">
                    {firstListingDraftPreview.draftPreviewSummary}
                  </p>
                </div>

                <div className="grid gap-3 text-sm font-bold text-white lg:min-w-[360px]">
                  <span className="break-words rounded-2xl border border-cyan-300/20 bg-cyan-300/[0.06] px-4 py-3 [overflow-wrap:anywhere]">
                    {firstListingDraftPreviewCopy.draftPreviewStatus}
                  </span>
                  <span className="break-words rounded-2xl border border-amber-300/20 bg-amber-300/[0.06] px-4 py-3 [overflow-wrap:anywhere]">
                    {firstListingDraftPreviewCopy.previewMode}
                  </span>
                  <span className="break-words rounded-2xl border border-rose-300/20 bg-rose-300/[0.06] px-4 py-3 [overflow-wrap:anywhere]">
                    {firstListingDraftPreviewCopy.publishabilityStatus}
                  </span>
                </div>
              </div>

              <div className="mt-5">
                <FieldGrid
                  fields={[
                    [
                      "Draft preview status",
                      firstListingDraftPreview.draftPreviewStatus,
                    ],
                    [
                      "Draft preview decision",
                      firstListingDraftPreview.draftPreviewDecision,
                    ],
                    [
                      "Preview mode",
                      firstListingDraftPreview.previewMode,
                    ],
                    [
                      "Publishability status",
                      firstListingDraftPreview.publishabilityStatus,
                    ],
                    [
                      "Draft impact",
                      firstListingDraftPreview.draftImpact,
                    ],
                    [
                      "Publication impact",
                      firstListingDraftPreview.publicationImpact,
                    ],
                  ]}
                />
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Architecture Policy
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={[
                      [
                        "Products",
                        firstListingDraftPreview.architecturePolicy
                          .productsRule,
                      ],
                      [
                        "Listing",
                        firstListingDraftPreview.architecturePolicy
                          .listingRule,
                      ],
                      [
                        "Benchmark",
                        firstListingDraftPreview.architecturePolicy
                          .benchmarkRule,
                      ],
                      [
                        "Gates",
                        firstListingDraftPreview.architecturePolicy.gatesRule,
                      ],
                      [
                        "Operating principle",
                        firstListingDraftPreview.architecturePolicy
                          .operatingPrinciple,
                      ],
                    ]}
                  />
                </div>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Source Facts
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={[
                      [
                        "Source mode",
                        firstListingDraftPreview.sourceFacts.sourceMode,
                      ],
                      [
                        "Product ID",
                        firstListingDraftPreview.sourceFacts.productId,
                      ],
                    ]}
                  />
                </div>
                <div className="mt-4 grid gap-3">
                  {firstListingDraftPreview.sourceFacts.confirmedFacts.map((fact) => (
                    <article
                      key={fact.factId}
                      className="rounded-xl border border-white/10 bg-white/[0.03] p-3"
                    >
                      <h5 className="text-sm font-bold text-white">
                        {fact.factId}: {fact.value}
                      </h5>
                      <p className="mt-1 text-[11px] font-bold uppercase leading-5 tracking-[0.08em] text-cyan-100/70">
                        usedInPreview: {formatValue(fact.usedInPreview)}
                      </p>
                    </article>
                  ))}
                </div>
              </article>
            </div>

            <div className="rounded-3xl border border-cyan-300/20 bg-cyan-300/[0.04] p-5">
              <h4 className="text-sm font-black text-white">
                {firstListingDraftPreviewCopy.generatedListingPreview}
              </h4>
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <article className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <h5 className="text-sm font-black text-white">
                    Title candidate
                  </h5>
                  <p className="mt-3 break-words rounded-xl border border-white/10 bg-white/[0.04] p-4 text-lg font-black text-cyan-50 [overflow-wrap:anywhere]">
                    {
                      firstListingDraftPreview.generatedListingPreview
                        .titleCandidate.value
                    }
                  </p>
                  <div className="mt-4">
                    <FieldGrid
                      fields={[
                        [
                          "Status",
                          firstListingDraftPreview.generatedListingPreview
                            .titleCandidate.status,
                        ],
                        [
                          "Character count",
                          firstListingDraftPreview.generatedListingPreview
                            .titleCandidate.characterCount,
                        ],
                        [
                          "Publishable",
                          firstListingDraftPreview.generatedListingPreview
                            .publishable,
                        ],
                        [
                          "Final content",
                          firstListingDraftPreview.generatedListingPreview
                            .finalContent,
                        ],
                      ]}
                    />
                  </div>
                </article>

                <article className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <h5 className="text-sm font-black text-white">
                    {firstListingDraftPreviewCopy.keywordPlan}
                  </h5>
                  <div className="mt-3">
                    <FieldGrid
                      fields={[
                        [
                          "Status",
                          firstListingDraftPreview.generatedListingPreview
                            .keywordPlan.status,
                        ],
                        [
                          "Benchmark keywords used",
                          firstListingDraftPreview.generatedListingPreview
                            .keywordPlan.benchmarkKeywordsUsed,
                        ],
                        [
                          "Core keywords",
                          firstListingDraftPreview.generatedListingPreview
                            .keywordPlan.coreKeywords.join(", "),
                        ],
                        [
                          "Secondary keywords",
                          firstListingDraftPreview.generatedListingPreview
                            .keywordPlan.secondaryKeywords.join(", "),
                        ],
                      ]}
                    />
                  </div>
                  <div className="mt-4">
                    <ListBlock
                      items={
                        firstListingDraftPreview.generatedListingPreview
                          .keywordPlan.blockedKeywords
                      }
                    />
                  </div>
                </article>
              </div>

              <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
                <h5 className="text-sm font-black text-white">
                  {firstListingDraftPreviewCopy.descriptionPreview}
                </h5>
                <div className="mt-3 grid gap-3">
                  {firstListingDraftPreview.generatedListingPreview.descriptionPreview.sections.map((section) => (
                    <article
                      key={section.sectionId}
                      className="rounded-xl border border-white/10 bg-white/[0.03] p-3"
                    >
                      <h6 className="text-sm font-bold text-white">
                        {section.heading}
                      </h6>
                      <p className="mt-2 text-sm leading-6 text-white/65">
                        {section.text}
                      </p>
                    </article>
                  ))}
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
                <h5 className="text-sm font-black text-white">
                  {firstListingDraftPreviewCopy.itemSpecificsPreview}
                </h5>
                <div className="mt-3 grid gap-3 lg:grid-cols-3">
                  {firstListingDraftPreview.generatedListingPreview.itemSpecificsPreview.specifics.map((specific) => (
                    <article
                      key={specific.name}
                      className="rounded-xl border border-white/10 bg-white/[0.03] p-3"
                    >
                      <h6 className="text-sm font-bold text-white">
                        {specific.name}
                      </h6>
                      <p className="mt-1 text-sm font-semibold text-cyan-50/80">
                        {specific.value}
                      </p>
                      <p className="mt-1 text-[11px] font-bold uppercase leading-5 tracking-[0.08em] text-amber-100/70">
                        final: {formatValue(specific.final)}
                      </p>
                    </article>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Preview Placeholders
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={[
                      [
                        "Price",
                        firstListingDraftPreview.generatedListingPreview
                          .pricePreview.status,
                      ],
                      [
                        "Shipping and returns",
                        firstListingDraftPreview.generatedListingPreview
                          .shippingReturnsPreview.status,
                      ],
                      [
                        "Image package",
                        firstListingDraftPreview.generatedListingPreview
                          .imagePackagePreview.status,
                      ],
                      [
                        "Draft payload",
                        firstListingDraftPreview.generatedListingPreview
                          .draftPayloadPreview.status,
                      ],
                    ]}
                  />
                </div>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  {firstListingDraftPreviewCopy.gateResult}
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={[
                      [
                        firstListingDraftPreviewCopy.readinessScore,
                        firstListingDraftPreview.gateResult.readinessScore,
                      ],
                      [
                        "Readiness label",
                        firstListingDraftPreview.gateResult.readinessLabel,
                      ],
                      [
                        "Can show draft preview",
                        firstListingDraftPreview.gateResult
                          .canShowDraftPreview,
                      ],
                      [
                        "Can build draft payload",
                        firstListingDraftPreview.gateResult
                          .canBuildDraftPayload,
                      ],
                      [
                        "Can create eBay draft",
                        firstListingDraftPreview.gateResult
                          .canCreateEbayDraft,
                      ],
                      [
                        "Can publish to eBay",
                        firstListingDraftPreview.gateResult.canPublishToEbay,
                      ],
                    ]}
                  />
                </div>
              </article>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  {firstListingDraftPreviewCopy.blockedFields}
                </h4>
                <div className="mt-4 grid gap-3">
                  {firstListingDraftPreview.blockedFields.map((field) => (
                    <article
                      key={field.fieldId}
                      className="rounded-xl border border-white/10 bg-white/[0.03] p-3"
                    >
                      <h5 className="break-words text-sm font-black text-white [overflow-wrap:anywhere]">
                        {field.fieldId}
                      </h5>
                      <p className="mt-1 text-[11px] font-bold uppercase leading-5 tracking-[0.08em] text-amber-100/70">
                        {field.status}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-white/60">
                        {field.reason}
                      </p>
                    </article>
                  ))}
                </div>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  {firstListingDraftPreviewCopy.missingInputs}
                </h4>
                <div className="mt-4">
                  <ListBlock items={firstListingDraftPreview.missingInputs} />
                </div>
              </article>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  {firstListingDraftPreviewCopy.requiredHumanActions}
                </h4>
                <div className="mt-4">
                  <ListBlock
                    items={firstListingDraftPreview.requiredHumanActions}
                  />
                </div>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Next Recommended Loop
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={[
                      [
                        firstListingDraftPreviewCopy.nextRecommendedLoop,
                        firstListingDraftPreview.nextRecommendedLoop.loop,
                      ],
                      [
                        "Reason",
                        firstListingDraftPreview.nextRecommendedLoop.reason,
                      ],
                      [
                        "Expected outcome",
                        firstListingDraftPreview.nextRecommendedLoop
                          .expectedOutcome,
                      ],
                    ]}
                  />
                </div>
                <div className="mt-4">
                  <ListBlock
                    items={
                      firstListingDraftPreview.nextRecommendedLoop.constraints
                    }
                  />
                </div>
              </article>
            </div>
          </div>
        </Section>

        <Section title="Product Source Adapter / Selector">
          <div className="grid gap-5">
            <div className="rounded-3xl border border-white/10 bg-black/20 p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="break-words text-[11px] font-semibold uppercase leading-5 tracking-[0.08em] text-cyan-100/60 [overflow-wrap:anywhere]">
                    {productSourceAdapterSelector.adapterVersion}
                  </p>
                  <h3 className="mt-2 text-xl font-black text-white">
                    {productSourceAdapterSelectorCopy.title}
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-white/65">
                    {productSourceAdapterSelector.adapterSummary}
                  </p>
                </div>

                <div className="grid gap-3 text-sm font-bold text-white lg:min-w-[360px]">
                  <span className="break-words rounded-2xl border border-cyan-300/20 bg-cyan-300/[0.06] px-4 py-3 [overflow-wrap:anywhere]">
                    {productSourceAdapterSelectorCopy.sourceAdapterStatus}
                  </span>
                  <span className="break-words rounded-2xl border border-amber-300/20 bg-amber-300/[0.06] px-4 py-3 [overflow-wrap:anywhere]">
                    {productSourceAdapterSelectorCopy.selectorStatus}
                  </span>
                  <span className="break-words rounded-2xl border border-rose-300/20 bg-rose-300/[0.06] px-4 py-3 [overflow-wrap:anywhere]">
                    {productSourceAdapterSelectorCopy.listingUsageDecision}
                  </span>
                </div>
              </div>

              <div className="mt-5">
                <FieldGrid
                  fields={[
                    [
                      "Source adapter status",
                      productSourceAdapterSelector.sourceAdapterStatus,
                    ],
                    [
                      "Selector status",
                      productSourceAdapterSelector.selectorStatus,
                    ],
                    [
                      "Source of truth status",
                      productSourceAdapterSelector.sourceOfTruthStatus,
                    ],
                    [
                      "Listing usage decision",
                      productSourceAdapterSelector.listingUsageDecision,
                    ],
                    [
                      "Draft impact",
                      productSourceAdapterSelector.draftImpact,
                    ],
                    [
                      "Publication impact",
                      productSourceAdapterSelector.publicationImpact,
                    ],
                  ]}
                />
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Architecture Policy
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={[
                      [
                        "Products",
                        productSourceAdapterSelector.architecturePolicy
                          .productsRule,
                      ],
                      [
                        "Listing",
                        productSourceAdapterSelector.architecturePolicy
                          .listingRule,
                      ],
                      [
                        "Benchmark",
                        productSourceAdapterSelector.architecturePolicy
                          .benchmarkRule,
                      ],
                      [
                        "Gates",
                        productSourceAdapterSelector.architecturePolicy
                          .gatesRule,
                      ],
                      [
                        "Operating principle",
                        productSourceAdapterSelector.architecturePolicy
                          .operatingPrinciple,
                      ],
                    ]}
                  />
                </div>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Product Source Audit
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={[
                      [
                        "Audit status",
                        productSourceAdapterSelector.productSourceAudit
                          .auditStatus,
                      ],
                      [
                        "Live product read enabled",
                        productSourceAdapterSelector.productSourceAudit
                          .liveProductReadEnabledInThisLoop,
                      ],
                      [
                        "Supabase write allowed",
                        productSourceAdapterSelector.productSourceAudit
                          .supabaseWriteAllowed,
                      ],
                      [
                        "Fallback mode",
                        productSourceAdapterSelector.productSourceAudit
                          .fallbackMode,
                      ],
                    ]}
                  />
                </div>
                <div className="mt-4">
                  <ListBlock
                    items={
                      productSourceAdapterSelector.productSourceAudit.auditNotes
                    }
                  />
                </div>
              </article>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  {productSourceAdapterSelectorCopy.productSelectorContract}
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={[
                      [
                        "Selector mode",
                        productSourceAdapterSelector.productSelectorContract
                          .selectorMode,
                      ],
                      [
                        "Selection status",
                        productSourceAdapterSelector.productSelectorContract
                          .selectionStatus,
                      ],
                      [
                        "Selected product ID",
                        productSourceAdapterSelector.productSelectorContract
                          .selectedProductId,
                      ],
                      [
                        "Selected product source",
                        productSourceAdapterSelector.productSelectorContract
                          .selectedProductSource,
                      ],
                      [
                        "Field policy",
                        productSourceAdapterSelector.productSelectorContract
                          .fieldPolicy,
                      ],
                    ]}
                  />
                </div>
                <div className="mt-4">
                  <ListBlock
                    items={
                      productSourceAdapterSelector.productSelectorContract
                        .requiredProductFields
                    }
                  />
                </div>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  {productSourceAdapterSelectorCopy.selectedProductPreview}
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={[
                      [
                        "Preview mode",
                        productSourceAdapterSelector.selectedProductPreview
                          .previewMode,
                      ],
                      [
                        "Product ID",
                        productSourceAdapterSelector.selectedProductPreview
                          .productId,
                      ],
                      [
                        "Product name",
                        productSourceAdapterSelector.selectedProductPreview
                          .productName.value,
                      ],
                      [
                        "Product type",
                        productSourceAdapterSelector.selectedProductPreview
                          .productType.value,
                      ],
                      [
                        "Condition",
                        productSourceAdapterSelector.selectedProductPreview
                          .condition.value,
                      ],
                      [
                        "Package quantity",
                        productSourceAdapterSelector.selectedProductPreview
                          .packageQuantity.value,
                      ],
                      [
                        "Supplier",
                        productSourceAdapterSelector.selectedProductPreview
                          .supplier.value,
                      ],
                    ]}
                  />
                </div>
              </article>
            </div>

            <div className="rounded-3xl border border-cyan-300/20 bg-cyan-300/[0.04] p-5">
              <h4 className="text-sm font-black text-white">
                {productSourceAdapterSelectorCopy.listingBridgeInputContract}
              </h4>
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <article className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <h5 className="text-sm font-black text-white">
                    Allowed confirmed facts
                  </h5>
                  <div className="mt-3">
                    <ListBlock
                      items={
                        productSourceAdapterSelector.listingBridgeInputContract
                          .allowedConfirmedFacts
                      }
                    />
                  </div>
                </article>

                <article className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <h5 className="text-sm font-black text-white">
                    Blocked unconfirmed facts
                  </h5>
                  <div className="mt-3">
                    <ListBlock
                      items={
                        productSourceAdapterSelector.listingBridgeInputContract
                          .blockedUnconfirmedFacts
                      }
                    />
                  </div>
                </article>
              </div>

              <div className="mt-4">
                <FieldGrid
                  fields={[
                    [
                      "Input mode",
                      productSourceAdapterSelector.listingBridgeInputContract
                        .inputMode,
                    ],
                    [
                      "Can use selected product",
                      productSourceAdapterSelector.listingBridgeInputContract
                        .generatorCanUseSelectedProduct,
                    ],
                    [
                      "Can generate preview",
                      productSourceAdapterSelector.listingBridgeInputContract
                        .generatorCanGeneratePreview,
                    ],
                    [
                      "Can generate final content",
                      productSourceAdapterSelector.listingBridgeInputContract
                        .generatorCanGenerateFinalContent,
                    ],
                    [
                      "Can build draft payload",
                      productSourceAdapterSelector.listingBridgeInputContract
                        .generatorCanBuildDraftPayload,
                    ],
                    [
                      "Can create draft",
                      false,
                    ],
                    [
                      "Can publish",
                      productSourceAdapterSelector.listingBridgeInputContract
                        .generatorCanPublish,
                    ],
                  ]}
                />
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  {productSourceAdapterSelectorCopy.blockedBecause}
                </h4>
                <div className="mt-4">
                  <ListBlock items={productSourceAdapterSelector.blockedBecause} />
                </div>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  {productSourceAdapterSelectorCopy.requiredHumanActions}
                </h4>
                <div className="mt-4">
                  <ListBlock
                    items={productSourceAdapterSelector.requiredHumanActions}
                  />
                </div>
              </article>
            </div>

            <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
              <h4 className="text-sm font-black text-white">
                Next Recommended Loop
              </h4>
              <div className="mt-3">
                <FieldGrid
                  fields={[
                    [
                      productSourceAdapterSelectorCopy.nextRecommendedLoop,
                      productSourceAdapterSelector.nextRecommendedLoop.loop,
                    ],
                    [
                      "Reason",
                      productSourceAdapterSelector.nextRecommendedLoop.reason,
                    ],
                    [
                      "Expected outcome",
                      productSourceAdapterSelector.nextRecommendedLoop
                        .expectedOutcome,
                    ],
                  ]}
                />
              </div>
              <div className="mt-4">
                <ListBlock
                  items={productSourceAdapterSelector.nextRecommendedLoop.constraints}
                />
              </div>
            </article>
          </div>
        </Section>

        <Section title="Live Product Selector Read-Only">
          <div className="grid gap-5">
            <div className="rounded-3xl border border-white/10 bg-black/20 p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="break-words text-[11px] font-semibold uppercase leading-5 tracking-[0.08em] text-cyan-100/60 [overflow-wrap:anywhere]">
                    {liveProductSelectorReadOnlyCopy.selectorVersion}
                  </p>
                  <h3 className="mt-2 text-xl font-black text-white">
                    {liveProductSelectorReadOnlyCopy.title}
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-white/65">
                    {liveProductSelectorReadOnly.selectorSummary}
                  </p>
                </div>

                <div className="grid gap-3 text-sm font-bold text-white lg:min-w-[360px]">
                  <span className="break-words rounded-2xl border border-cyan-300/20 bg-cyan-300/[0.06] px-4 py-3 [overflow-wrap:anywhere]">
                    {liveProductSelectorReadOnlyCopy.selectorStatus}
                  </span>
                  <span className="break-words rounded-2xl border border-amber-300/20 bg-amber-300/[0.06] px-4 py-3 [overflow-wrap:anywhere]">
                    {liveProductSelectorReadOnlyCopy.selectorDecision}
                  </span>
                  <span className="break-words rounded-2xl border border-rose-300/20 bg-rose-300/[0.06] px-4 py-3 [overflow-wrap:anywhere]">
                    {liveProductSelectorReadOnlyCopy.sourceOfTruthStatus}
                  </span>
                </div>
              </div>

              <div className="mt-5">
                <FieldGrid
                  fields={[
                    [
                      "Selector version",
                      liveProductSelectorReadOnly.selectorVersion,
                    ],
                    [
                      "Selector status",
                      liveProductSelectorReadOnly.selectorStatus,
                    ],
                    [
                      "Selector decision",
                      liveProductSelectorReadOnly.selectorDecision,
                    ],
                    [
                      "Source of truth status",
                      liveProductSelectorReadOnly.sourceOfTruthStatus,
                    ],
                    [
                      "Live read status",
                      liveProductSelectorReadOnly.liveReadStatus,
                    ],
                    [
                      "Draft impact",
                      liveProductSelectorReadOnly.draftImpact,
                    ],
                    [
                      "Publication impact",
                      liveProductSelectorReadOnly.publicationImpact,
                    ],
                  ]}
                />
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Architecture Policy
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={[
                      [
                        "Products",
                        liveProductSelectorReadOnly.architecturePolicy
                          .productsRule,
                      ],
                      [
                        "Listing",
                        liveProductSelectorReadOnly.architecturePolicy
                          .listingRule,
                      ],
                      [
                        "Benchmark",
                        liveProductSelectorReadOnly.architecturePolicy
                          .benchmarkRule,
                      ],
                      [
                        "Gates",
                        liveProductSelectorReadOnly.architecturePolicy
                          .gatesRule,
                      ],
                      [
                        "Operating principle",
                        liveProductSelectorReadOnly.architecturePolicy
                          .operatingPrinciple,
                      ],
                    ]}
                  />
                </div>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Read-Only Source Audit
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={[
                      [
                        "Audit status",
                        liveProductSelectorReadOnly.readOnlySourceAudit
                          .auditStatus,
                      ],
                      [
                        "Central service",
                        liveProductSelectorReadOnly.readOnlySourceAudit
                          .centralProductsService,
                      ],
                      [
                        "Recommended read function",
                        liveProductSelectorReadOnly.readOnlySourceAudit
                          .recommendedReadFunction,
                      ],
                      [
                        "Live read enabled",
                        liveProductSelectorReadOnly.readOnlySourceAudit
                          .liveReadEnabledInThisLoop,
                      ],
                      [
                        "Admin product page",
                        liveProductSelectorReadOnly.readOnlySourceAudit
                          .adminProductPagePath,
                      ],
                    ]}
                  />
                </div>
                <div className="mt-4">
                  <ListBlock
                    items={
                      liveProductSelectorReadOnly.readOnlySourceAudit
                        .readFunctionsFound
                    }
                  />
                </div>
              </article>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  {liveProductSelectorReadOnlyCopy.productListContract}
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={[
                      [
                        "Mode",
                        liveProductSelectorReadOnly.productListContract.mode,
                      ],
                      [
                        "Selection behavior",
                        liveProductSelectorReadOnly.productListContract
                          .selectionBehavior,
                      ],
                      [
                        "Mutation behavior",
                        liveProductSelectorReadOnly.productListContract
                          .mutationBehavior,
                      ],
                    ]}
                  />
                </div>
                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  <div>
                    <h5 className="text-sm font-bold text-white">
                      Allowed fields
                    </h5>
                    <div className="mt-3">
                      <ListBlock
                        items={
                          liveProductSelectorReadOnly.productListContract
                            .allowedFields
                        }
                      />
                    </div>
                  </div>
                  <div>
                    <h5 className="text-sm font-bold text-white">
                      Forbidden fields
                    </h5>
                    <div className="mt-3">
                      <ListBlock
                        items={
                          liveProductSelectorReadOnly.productListContract
                            .forbiddenFields
                        }
                      />
                    </div>
                  </div>
                </div>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  {liveProductSelectorReadOnlyCopy.selectedProductReadOnlyPreview}
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={[
                      [
                        "Preview mode",
                        liveProductSelectorReadOnly.selectedProductReadOnlyPreview
                          .previewMode,
                      ],
                      [
                        "Product ID",
                        liveProductSelectorReadOnly.selectedProductReadOnlyPreview
                          .productId,
                      ],
                      [
                        "Source",
                        liveProductSelectorReadOnly.selectedProductReadOnlyPreview
                          .source,
                      ],
                      [
                        "Product name",
                        liveProductSelectorReadOnlyCopy.productName,
                      ],
                      [
                        "Supplier",
                        liveProductSelectorReadOnlyCopy.supplier,
                      ],
                      [
                        "Ready for final listing",
                        liveProductSelectorReadOnly.selectedProductReadOnlyPreview
                          .readyForFinalListing,
                      ],
                      [
                        "Ready for draft",
                        liveProductSelectorReadOnly.selectedProductReadOnlyPreview
                          .readyForDraft,
                      ],
                    ]}
                  />
                </div>
              </article>
            </div>

            <div className="rounded-3xl border border-cyan-300/20 bg-cyan-300/[0.04] p-5">
              <h4 className="text-sm font-black text-white">
                {liveProductSelectorReadOnlyCopy.listingGeneratorBridgeContract}
              </h4>
              <div className="mt-4">
                <FieldGrid
                  fields={[
                    [
                      "Input mode",
                      liveProductSelectorReadOnly.listingGeneratorBridgeContract
                        .inputMode,
                    ],
                    [
                      "Can read selected product",
                      liveProductSelectorReadOnly.listingGeneratorBridgeContract
                        .generatorCanReadSelectedProduct,
                    ],
                    [
                      "Can generate preview",
                      liveProductSelectorReadOnly.listingGeneratorBridgeContract
                        .generatorCanGeneratePreview,
                    ],
                    [
                      "Can generate final content",
                      liveProductSelectorReadOnly.listingGeneratorBridgeContract
                        .generatorCanGenerateFinalContent,
                    ],
                    [
                      "Can build draft payload",
                      liveProductSelectorReadOnly.listingGeneratorBridgeContract
                        .generatorCanBuildDraftPayload,
                    ],
                    [
                      "Can publish",
                      liveProductSelectorReadOnly.listingGeneratorBridgeContract
                        .generatorCanPublish,
                    ],
                    [
                      "Facts remain referenced to Products",
                      liveProductSelectorReadOnly.listingGeneratorBridgeContract
                        .factsMustRemainReferencedToProducts,
                    ],
                  ]}
                />
              </div>
              <p className="mt-4 text-sm font-bold text-amber-100/80">
                {liveProductSelectorReadOnlyCopy.mutationRule}
              </p>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Blocked Because
                </h4>
                <div className="mt-4">
                  <ListBlock items={liveProductSelectorReadOnly.blockedBecause} />
                </div>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Required Human Actions
                </h4>
                <div className="mt-4">
                  <ListBlock
                    items={liveProductSelectorReadOnly.requiredHumanActions}
                  />
                </div>
              </article>
            </div>

            <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
              <h4 className="text-sm font-black text-white">
                Next Recommended Loop
              </h4>
              <div className="mt-3">
                <FieldGrid
                  fields={[
                    [
                      liveProductSelectorReadOnlyCopy.nextRecommendedLoop,
                      liveProductSelectorReadOnly.nextRecommendedLoop.loop,
                    ],
                    [
                      "Reason",
                      liveProductSelectorReadOnly.nextRecommendedLoop.reason,
                    ],
                    [
                      "Expected outcome",
                      liveProductSelectorReadOnly.nextRecommendedLoop
                        .expectedOutcome,
                    ],
                  ]}
                />
              </div>
              <div className="mt-4">
                <ListBlock
                  items={liveProductSelectorReadOnly.nextRecommendedLoop.constraints}
                />
              </div>
            </article>
          </div>
        </Section>

        <Section title="Real Product Listing Generator Integration">
          <div className="grid gap-5">
            <div className="rounded-3xl border border-white/10 bg-black/20 p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="break-words text-[11px] font-semibold uppercase leading-5 tracking-[0.08em] text-cyan-100/60 [overflow-wrap:anywhere]">
                    {realProductListingGeneratorIntegrationCopy.integrationVersion}
                  </p>
                  <h3 className="mt-2 text-xl font-black text-white">
                    {realProductListingGeneratorIntegrationCopy.title}
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-white/65">
                    {realProductListingGeneratorIntegration.integrationSummary}
                  </p>
                </div>

                <div className="grid gap-3 text-sm font-bold text-white lg:min-w-[360px]">
                  <span className="break-words rounded-2xl border border-cyan-300/20 bg-cyan-300/[0.06] px-4 py-3 [overflow-wrap:anywhere]">
                    {realProductListingGeneratorIntegrationCopy.integrationStatus}
                  </span>
                  <span className="break-words rounded-2xl border border-amber-300/20 bg-amber-300/[0.06] px-4 py-3 [overflow-wrap:anywhere]">
                    {realProductListingGeneratorIntegrationCopy.productReadDecision}
                  </span>
                  <span className="break-words rounded-2xl border border-rose-300/20 bg-rose-300/[0.06] px-4 py-3 [overflow-wrap:anywhere]">
                    {realProductListingGeneratorIntegrationCopy.gatesStatus}
                  </span>
                </div>
              </div>

              <div className="mt-5">
                <FieldGrid
                  fields={[
                    [
                      "Integration version",
                      realProductListingGeneratorIntegration.integrationVersion,
                    ],
                    [
                      "Integration status",
                      realProductListingGeneratorIntegration.integrationStatus,
                    ],
                    [
                      "Product read decision",
                      realProductListingGeneratorIntegration.productReadDecision,
                    ],
                    [
                      "Facts mapping status",
                      realProductListingGeneratorIntegration.factsMappingStatus,
                    ],
                    [
                      "Generator status",
                      realProductListingGeneratorIntegration.generatorStatus,
                    ],
                    [
                      "Gates status",
                      realProductListingGeneratorIntegration.gatesStatus,
                    ],
                    [
                      "Draft impact",
                      realProductListingGeneratorIntegration.draftImpact,
                    ],
                    [
                      "Publication impact",
                      realProductListingGeneratorIntegration.publicationImpact,
                    ],
                  ]}
                />
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Products Source Of Truth Policy
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={[
                      [
                        "Products",
                        realProductListingGeneratorIntegration.architecturePolicy
                          .productsRule,
                      ],
                      [
                        "Listing",
                        realProductListingGeneratorIntegration.architecturePolicy
                          .listingRule,
                      ],
                      [
                        "Benchmark",
                        realProductListingGeneratorIntegration.architecturePolicy
                          .benchmarkRule,
                      ],
                      [
                        "Gates",
                        realProductListingGeneratorIntegration.architecturePolicy
                          .gatesRule,
                      ],
                      [
                        "Facts reference rule",
                        realProductListingGeneratorIntegration.architecturePolicy
                          .factsReferenceRule,
                      ],
                    ]}
                  />
                </div>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Product List / Read Status
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={[
                      [
                        "Products service",
                        realProductListingGeneratorIntegration.readOnlyProductSource
                          .productsService,
                      ],
                      [
                        "Recommended read function",
                        realProductListingGeneratorIntegration.readOnlyProductSource
                          .recommendedReadFunction,
                      ],
                      [
                        "Read mode",
                        realProductListingGeneratorIntegration.readOnlyProductSource
                          .readMode,
                      ],
                      [
                        "Live read attempt allowed",
                        realProductListingGeneratorIntegration.readOnlyProductSource
                          .liveReadAttemptAllowed,
                      ],
                      [
                        "Safe fallback required",
                        realProductListingGeneratorIntegration.readOnlyProductSource
                          .safeFallbackRequired,
                      ],
                      [
                        "Writes allowed",
                        realProductListingGeneratorIntegration.readOnlyProductSource
                          .writesAllowed,
                      ],
                    ]}
                  />
                </div>
              </article>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Selected Product Reference
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={[
                      [
                        "Selection mode",
                        realProductListingGeneratorIntegration.selectedProductReference
                          .selectionMode,
                      ],
                      [
                        "Source",
                        realProductListingGeneratorIntegration.selectedProductReference
                          .source,
                      ],
                      [
                        "Fallback product ID",
                        realProductListingGeneratorIntegration.selectedProductReference
                          .fallbackProductId,
                      ],
                      [
                        "Fallback product name",
                        realProductListingGeneratorIntegration.selectedProductReference
                          .fallbackProductName,
                      ],
                      [
                        "Fallback supplier",
                        realProductListingGeneratorIntegration.selectedProductReference
                          .fallbackSupplier,
                      ],
                    ]}
                  />
                </div>
                <div className="mt-4">
                  <h5 className="text-sm font-bold text-white">
                    {realProductListingGeneratorIntegrationCopy.missingProductFacts}
                  </h5>
                  <div className="mt-3">
                    <ListBlock
                      items={
                        realProductListingGeneratorIntegration
                          .selectedProductReference.factsMissingOrBlocked
                      }
                    />
                  </div>
                </div>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  {realProductListingGeneratorIntegrationCopy.generatedListingPreview}
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={[
                      [
                        "Preview mode",
                        realProductListingGeneratorIntegration.generatedListingPreview
                          .previewMode,
                      ],
                      [
                        "Preview generated",
                        realProductListingGeneratorIntegration.generatedListingPreview
                          .previewGenerated,
                      ],
                      [
                        "Publishable",
                        realProductListingGeneratorIntegration.generatedListingPreview
                          .publishable,
                      ],
                      [
                        "Final content generated",
                        realProductListingGeneratorIntegration.generatedListingPreview
                          .finalContentGenerated,
                      ],
                      [
                        realProductListingGeneratorIntegrationCopy.titlePreview,
                        realProductListingGeneratorIntegration.generatedListingPreview
                          .titleGeneration.exampleFallbackTitle,
                      ],
                      [
                        "Title status",
                        realProductListingGeneratorIntegration.generatedListingPreview
                          .titleGeneration.status,
                      ],
                    ]}
                  />
                </div>
              </article>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  {realProductListingGeneratorIntegrationCopy.basicKeywordPlan}
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={[
                      [
                        "Status",
                        realProductListingGeneratorIntegration.generatedListingPreview
                          .keywordPlan.status,
                      ],
                      [
                        "Benchmark keywords used",
                        realProductListingGeneratorIntegration.generatedListingPreview
                          .keywordPlan.benchmarkKeywordsUsed,
                      ],
                      [
                        "Competitor content copied",
                        realProductListingGeneratorIntegration.generatedListingPreview
                          .keywordPlan.competitorContentCopied,
                      ],
                    ]}
                  />
                </div>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  {realProductListingGeneratorIntegrationCopy.descriptionPreview}
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={[
                      [
                        "Status",
                        realProductListingGeneratorIntegration.generatedListingPreview
                          .descriptionPreview.status,
                      ],
                      [
                        "Rule",
                        realProductListingGeneratorIntegration.generatedListingPreview
                          .descriptionPreview.rule,
                      ],
                    ]}
                  />
                </div>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  {realProductListingGeneratorIntegrationCopy.itemSpecificsPreview}
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={[
                      [
                        "Status",
                        realProductListingGeneratorIntegration.generatedListingPreview
                          .itemSpecificsPreview.status,
                      ],
                      [
                        "Rule",
                        realProductListingGeneratorIntegration.generatedListingPreview
                          .itemSpecificsPreview.rule,
                      ],
                    ]}
                  />
                </div>
              </article>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  {realProductListingGeneratorIntegrationCopy.blockedListingFields}
                </h4>
                <div className="mt-4">
                  <ListBlock
                    items={realProductListingGeneratorIntegration.blockedFields.map(
                      (field) => `${field.fieldId}: ${field.status}`
                    )}
                  />
                </div>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  {realProductListingGeneratorIntegrationCopy.readinessGates}
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={[
                      [
                        "Can read selected product",
                        realProductListingGeneratorIntegration.readinessGates
                          .canReadSelectedProduct,
                      ],
                      [
                        "Can map product facts",
                        realProductListingGeneratorIntegration.readinessGates
                          .canMapProductFacts,
                      ],
                      [
                        "Can generate listing preview",
                        realProductListingGeneratorIntegration.readinessGates
                          .canGenerateListingPreview,
                      ],
                      [
                        "Can build draft payload",
                        realProductListingGeneratorIntegration.readinessGates
                          .canBuildDraftPayload,
                      ],
                      [
                        "Can publish to eBay",
                        realProductListingGeneratorIntegration.readinessGates
                          .canPublishToEbay,
                      ],
                      [
                        realProductListingGeneratorIntegrationCopy.readinessScore,
                        realProductListingGeneratorIntegration.readinessGates
                          .minimumRequiredForDraftPayload,
                      ],
                      [
                        "Current readiness label",
                        realProductListingGeneratorIntegration.readinessGates
                          .currentReadinessLabel,
                      ],
                    ]}
                  />
                </div>
              </article>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Required Human Actions
                </h4>
                <div className="mt-4">
                  <ListBlock
                    items={
                      realProductListingGeneratorIntegration.requiredHumanActions
                    }
                  />
                </div>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Next Recommended Loop
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={[
                      [
                        realProductListingGeneratorIntegrationCopy.nextRecommendedLoop,
                        realProductListingGeneratorIntegration.nextRecommendedLoop
                          .loop,
                      ],
                      [
                        "Reason",
                        realProductListingGeneratorIntegration.nextRecommendedLoop
                          .reason,
                      ],
                      [
                        "Expected outcome",
                        realProductListingGeneratorIntegration.nextRecommendedLoop
                          .expectedOutcome,
                      ],
                    ]}
                  />
                </div>
              </article>
            </div>
          </div>
        </Section>

        <Section title="Luna Portex Catalog Image Package + eBay Image QA">
          <div className="grid gap-5">
            <div className="rounded-3xl border border-white/10 bg-black/20 p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="break-words text-[11px] font-semibold uppercase leading-5 tracking-[0.08em] text-cyan-100/60 [overflow-wrap:anywhere]">
                    {lunaPortexCatalogImagePackageQaCopy.imagePackageVersion}
                  </p>
                  <h3 className="mt-2 text-xl font-black text-white">
                    {lunaPortexCatalogImagePackageQaCopy.title}
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-white/65">
                    {lunaPortexCatalogImagePackageQa.imagePackageSummary}
                  </p>
                  <p className="mt-4 text-sm font-bold text-cyan-100/80">
                    {lunaPortexCatalogImagePackageQaCopy.visualSourceTruth}
                  </p>
                </div>

                <div className="grid gap-3 text-sm font-bold text-white lg:min-w-[360px]">
                  <span className="break-words rounded-2xl border border-cyan-300/20 bg-cyan-300/[0.06] px-4 py-3 [overflow-wrap:anywhere]">
                    {lunaPortexCatalogImagePackageQaCopy.imagePackageStatus}
                  </span>
                  <span className="break-words rounded-2xl border border-amber-300/20 bg-amber-300/[0.06] px-4 py-3 [overflow-wrap:anywhere]">
                    {lunaPortexCatalogImagePackageQaCopy.mainImagePolicyStatus}
                  </span>
                  <span className="break-words rounded-2xl border border-rose-300/20 bg-rose-300/[0.06] px-4 py-3 [overflow-wrap:anywhere]">
                    {lunaPortexCatalogImagePackageQaCopy.imageQaStatus}
                  </span>
                </div>
              </div>

              <div className="mt-5">
                <FieldGrid
                  fields={[
                    [
                      "Image package version",
                      lunaPortexCatalogImagePackageQa.imagePackageVersion,
                    ],
                    [
                      "Image package status",
                      lunaPortexCatalogImagePackageQa.imagePackageStatus,
                    ],
                    [
                      "Visual source decision",
                      lunaPortexCatalogImagePackageQa.visualSourceDecision,
                    ],
                    [
                      "Main image policy status",
                      lunaPortexCatalogImagePackageQa.mainImagePolicyStatus,
                    ],
                    [
                      "Secondary image policy status",
                      lunaPortexCatalogImagePackageQa.secondaryImagePolicyStatus,
                    ],
                    [
                      "Image QA status",
                      lunaPortexCatalogImagePackageQa.imageQaStatus,
                    ],
                    [
                      "Draft impact",
                      lunaPortexCatalogImagePackageQa.draftImpact,
                    ],
                    [
                      "Publication impact",
                      lunaPortexCatalogImagePackageQa.publicationImpact,
                    ],
                  ]}
                />
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Architecture Policy
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={[
                      [
                        "Products",
                        lunaPortexCatalogImagePackageQa.architecturePolicy
                          .productsRule,
                      ],
                      [
                        "Listing",
                        lunaPortexCatalogImagePackageQa.architecturePolicy
                          .listingRule,
                      ],
                      [
                        "Benchmark",
                        lunaPortexCatalogImagePackageQa.architecturePolicy
                          .benchmarkRule,
                      ],
                      [
                        "Gates",
                        lunaPortexCatalogImagePackageQa.architecturePolicy
                          .gatesRule,
                      ],
                      [
                        "Visual source rule",
                        lunaPortexCatalogImagePackageQa.architecturePolicy
                          .visualSourceOfTruthRule,
                      ],
                    ]}
                  />
                </div>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Luna Portex Catalog Source Policy
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={[
                      [
                        "Source name",
                        lunaPortexCatalogImagePackageQa
                          .lunaPortexCatalogSourcePolicy.sourceName,
                      ],
                      [
                        "Source type",
                        lunaPortexCatalogImagePackageQa
                          .lunaPortexCatalogSourcePolicy.sourceType,
                      ],
                      [
                        "Visual source of truth",
                        lunaPortexCatalogImagePackageQa
                          .lunaPortexCatalogSourcePolicy.visualSourceOfTruth,
                      ],
                      [
                        "Catalog image required",
                        lunaPortexCatalogImagePackageQa
                          .lunaPortexCatalogSourcePolicy.catalogImageRequired,
                      ],
                      [
                        "Catalog image URL stored in fixture",
                        lunaPortexCatalogImagePackageQa
                          .lunaPortexCatalogSourcePolicy.catalogImageUrlStoredInFixture,
                      ],
                      [
                        "External image fetch allowed",
                        lunaPortexCatalogImagePackageQa
                          .lunaPortexCatalogSourcePolicy.externalImageFetchAllowedInThisLoop,
                      ],
                    ]}
                  />
                </div>
              </article>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  {lunaPortexCatalogImagePackageQaCopy.mainImagePolicy}
                </h4>
                <p className="mt-3 text-sm leading-6 text-white/65">
                  Main image comes from Luna Portex catalog source. It may be enhanced or optimized but not generated from scratch. It {lunaPortexCatalogImagePackageQaCopy.photorealismRule} and {lunaPortexCatalogImagePackageQaCopy.aiLookRule}.
                </p>
                <div className="mt-4">
                  <FieldGrid
                    fields={[
                      [
                        "Main image source",
                        lunaPortexCatalogImagePackageQa
                          .mainImageOptimizationPolicy.mainImageSource,
                      ],
                      [
                        "Optimization allowed",
                        lunaPortexCatalogImagePackageQa
                          .mainImageOptimizationPolicy.optimizationAllowed,
                      ],
                      [
                        "Optimization type",
                        lunaPortexCatalogImagePackageQa
                          .mainImageOptimizationPolicy.optimizationType,
                      ],
                      [
                        "Must look photorealistic",
                        lunaPortexCatalogImagePackageQa
                          .mainImageOptimizationPolicy.mustLookPhotorealistic,
                      ],
                      [
                        "Must not look AI-generated",
                        lunaPortexCatalogImagePackageQa
                          .mainImageOptimizationPolicy.mustNotLookAiGenerated,
                      ],
                      [
                        "Must not be generated from scratch",
                        lunaPortexCatalogImagePackageQa
                          .mainImageOptimizationPolicy.mustNotBeGeneratedFromScratch,
                      ],
                    ]}
                  />
                </div>
                <div className="mt-4">
                  <ListBlock
                    items={
                      lunaPortexCatalogImagePackageQa.mainImageOptimizationPolicy
                        .requirements
                    }
                  />
                </div>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  {lunaPortexCatalogImagePackageQaCopy.secondaryImagePackagePlan}
                </h4>
                <p className="mt-3 text-sm leading-6 text-white/65">
                  Secondary images may be AI-assisted only from catalog source. Exact product fidelity is required.
                </p>
                <div className="mt-4">
                  <FieldGrid
                    fields={[
                      [
                        "Package type",
                        lunaPortexCatalogImagePackageQa.secondaryImagePackagePlan
                          .packageType,
                      ],
                      [
                        "Source",
                        lunaPortexCatalogImagePackageQa.secondaryImagePackagePlan
                          .source,
                      ],
                      [
                        "AI-assisted allowed",
                        lunaPortexCatalogImagePackageQa.secondaryImagePackagePlan
                          .aiAssistedAllowed,
                      ],
                      [
                        "Exact product fidelity required",
                        lunaPortexCatalogImagePackageQa.secondaryImagePackagePlan
                          .mustPreserveExactProductFidelity,
                      ],
                      [
                        "Generation impact",
                        lunaPortexCatalogImagePackageQa.secondaryImagePackagePlan
                          .generationImpact,
                      ],
                      [
                        "Upload impact",
                        lunaPortexCatalogImagePackageQa.secondaryImagePackagePlan
                          .uploadImpact,
                      ],
                    ]}
                  />
                </div>
              </article>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
              <h4 className="text-sm font-black text-white">
                Planned Secondary Images
              </h4>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {lunaPortexCatalogImagePackageQa.secondaryImagePackagePlan.images.map((image) => (
                  <article
                    key={image.imageNumber}
                    className="rounded-xl border border-white/10 bg-white/[0.03] p-4"
                  >
                    <p className="text-sm font-black text-white">
                      {image.imageNumber}. {image.name}
                    </p>
                    <p className="mt-2 break-words text-[11px] font-bold uppercase leading-5 tracking-[0.08em] text-amber-100/70 [overflow-wrap:anywhere]">
                      {image.status}
                    </p>
                    <p className="mt-3 text-sm leading-6 text-white/60">
                      {image.purpose}
                    </p>
                  </article>
                ))}
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  {lunaPortexCatalogImagePackageQaCopy.imageQaGates}
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={[
                      [
                        "Catalog source available",
                        lunaPortexCatalogImagePackageQa.imageQaGates
                          .catalogSourceAvailable,
                      ],
                      [
                        "Catalog source authorized",
                        lunaPortexCatalogImagePackageQa.imageQaGates
                          .catalogSourceAuthorized,
                      ],
                      [
                        "Main image optimized",
                        lunaPortexCatalogImagePackageQa.imageQaGates
                          .mainImageOptimized,
                      ],
                      [
                        "Main image photorealistic",
                        lunaPortexCatalogImagePackageQa.imageQaGates
                          .mainImagePhotorealistic,
                      ],
                      [
                        "Product fidelity approved",
                        lunaPortexCatalogImagePackageQa.imageQaGates
                          .productFidelityApproved,
                      ],
                      [
                        "Can generate actual images",
                        lunaPortexCatalogImagePackageQa.imageQaGates
                          .canGenerateActualImages,
                      ],
                      [
                        "Can upload images",
                        lunaPortexCatalogImagePackageQa.imageQaGates
                          .canUploadImages,
                      ],
                      [
                        "Can build draft payload with images",
                        lunaPortexCatalogImagePackageQa.imageQaGates
                          .canBuildDraftPayloadWithImages,
                      ],
                      [
                        "Can create eBay draft",
                        lunaPortexCatalogImagePackageQa.imageQaGates
                          .canCreateEbayDraft,
                      ],
                      [
                        "Can publish to eBay",
                        lunaPortexCatalogImagePackageQa.imageQaGates
                          .canPublishToEbay,
                      ],
                    ]}
                  />
                </div>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  {lunaPortexCatalogImagePackageQaCopy.blockedReasons}
                </h4>
                <div className="mt-4">
                  <ListBlock items={lunaPortexCatalogImagePackageQa.blockedBecause} />
                </div>
              </article>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  {lunaPortexCatalogImagePackageQaCopy.requiredHumanActions}
                </h4>
                <div className="mt-4">
                  <ListBlock
                    items={lunaPortexCatalogImagePackageQa.requiredHumanActions}
                  />
                </div>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Next Recommended Loop
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={[
                      [
                        lunaPortexCatalogImagePackageQaCopy.nextRecommendedLoop,
                        lunaPortexCatalogImagePackageQa.nextRecommendedLoop.loop,
                      ],
                      [
                        "Reason",
                        lunaPortexCatalogImagePackageQa.nextRecommendedLoop.reason,
                      ],
                      [
                        "Expected outcome",
                        lunaPortexCatalogImagePackageQa.nextRecommendedLoop
                          .expectedOutcome,
                      ],
                    ]}
                  />
                </div>
                <div className="mt-4">
                  <ListBlock
                    items={lunaPortexCatalogImagePackageQa.nextRecommendedLoop.constraints}
                  />
                </div>
              </article>
            </div>
          </div>
        </Section>

        <Section title="Complete Listing Package Builder">
          <div className="grid gap-5">
            <div className="rounded-3xl border border-white/10 bg-black/20 p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="break-words text-[11px] font-semibold uppercase leading-5 tracking-[0.08em] text-cyan-100/60 [overflow-wrap:anywhere]">
                    {completeListingPackageBuilderCopy.packageVersion}
                  </p>
                  <h3 className="mt-2 text-xl font-black text-white">
                    {completeListingPackageBuilderCopy.title}
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-white/65">
                    {completeListingPackageBuilder.packageSummary}
                  </p>
                </div>

                <div className="grid gap-3 text-sm font-bold text-white lg:min-w-[360px]">
                  <span className="break-words rounded-2xl border border-cyan-300/20 bg-cyan-300/[0.06] px-4 py-3 [overflow-wrap:anywhere]">
                    {completeListingPackageBuilderCopy.packageStatus}
                  </span>
                  <span className="break-words rounded-2xl border border-amber-300/20 bg-amber-300/[0.06] px-4 py-3 [overflow-wrap:anywhere]">
                    {completeListingPackageBuilderCopy.draftPayloadStatus}
                  </span>
                  <span className="break-words rounded-2xl border border-rose-300/20 bg-rose-300/[0.06] px-4 py-3 [overflow-wrap:anywhere]">
                    {completeListingPackageBuilderCopy.readinessStatus}
                  </span>
                </div>
              </div>

              <div className="mt-5">
                <FieldGrid
                  fields={[
                    [
                      "Package version",
                      completeListingPackageBuilder.packageVersion,
                    ],
                    [
                      "Package status",
                      completeListingPackageBuilder.packageStatus,
                    ],
                    [
                      "Product source status",
                      completeListingPackageBuilder.productSourceStatus,
                    ],
                    [
                      "Listing content status",
                      completeListingPackageBuilder.listingContentStatus,
                    ],
                    [
                      "Catalog image status",
                      completeListingPackageBuilder.catalogImageStatus,
                    ],
                    [
                      "Secondary image prompt status",
                      completeListingPackageBuilder.secondaryImagePromptStatus,
                    ],
                    [
                      "Draft payload status",
                      completeListingPackageBuilder.draftPayloadStatus,
                    ],
                    [
                      "Readiness status",
                      completeListingPackageBuilder.readinessStatus,
                    ],
                    [
                      "Draft impact",
                      completeListingPackageBuilder.draftImpact,
                    ],
                    [
                      "Publication impact",
                      completeListingPackageBuilder.publicationImpact,
                    ],
                  ]}
                />
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Architecture Policy
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={Object.entries(
                      completeListingPackageBuilder.architecturePolicy
                    )}
                  />
                </div>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  {completeListingPackageBuilderCopy.selectedProduct}
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={Object.entries(
                      completeListingPackageBuilder.selectedProduct
                    )}
                  />
                </div>
              </article>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  {completeListingPackageBuilderCopy.generatedListingContent}
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={[
                      [
                        "Title preview",
                        completeListingPackageBuilder.generatedListingContent
                          .titlePreview,
                      ],
                      [
                        "Preview generated",
                        completeListingPackageBuilder.generatedListingContent
                          .previewGenerated,
                      ],
                      [
                        "Final content generated",
                        completeListingPackageBuilder.generatedListingContent
                          .finalContentGenerated,
                      ],
                      [
                        "Keyword plan",
                        completeListingPackageBuilder.generatedListingContent
                          .keywordPlan.status,
                      ],
                      [
                        "Benchmark keywords used",
                        completeListingPackageBuilder.generatedListingContent
                          .keywordPlan.benchmarkKeywordsUsed,
                      ],
                      [
                        "Competitor content copied",
                        completeListingPackageBuilder.generatedListingContent
                          .keywordPlan.competitorContentCopied,
                      ],
                    ]}
                  />
                </div>
                <p className="mt-4 rounded-2xl border border-cyan-300/20 bg-cyan-300/[0.045] p-4 text-sm leading-6 text-cyan-50/80">
                  {
                    completeListingPackageBuilder.generatedListingContent
                      .descriptionPreview.text
                  }
                </p>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  {completeListingPackageBuilderCopy.catalogImagePackage}
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={[
                      [
                        "Visual source",
                        completeListingPackageBuilder.catalogImagePackage
                          .visualSource,
                      ],
                      [
                        "Catalog image reference status",
                        completeListingPackageBuilder.catalogImagePackage
                          .catalogImageReferenceStatus,
                      ],
                      [
                        "Main image source-based optimization allowed",
                        completeListingPackageBuilder.catalogImagePackage
                          .mainImageSourceBasedOptimizationAllowed,
                      ],
                      [
                        "Main image generated from scratch",
                        completeListingPackageBuilder.catalogImagePackage
                          .mainImageGeneratedFromScratch,
                      ],
                      [
                        "Must look photorealistic",
                        completeListingPackageBuilder.catalogImagePackage
                          .mainImageMustLookPhotorealistic,
                      ],
                      [
                        "Must not look AI-generated",
                        completeListingPackageBuilder.catalogImagePackage
                          .mainImageMustNotLookAiGenerated,
                      ],
                      [
                        "Exact product fidelity required",
                        completeListingPackageBuilder.catalogImagePackage
                          .exactProductFidelityRequired,
                      ],
                    ]}
                  />
                </div>
                <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  {completeListingCatalogImageReference ? (
                    <img
                      alt="Selected product catalog source"
                      className="aspect-square w-full rounded-xl border border-white/10 bg-white object-contain"
                      src={completeListingCatalogImageReference}
                    />
                  ) : (
                    <p className="text-sm font-bold text-amber-100/80">
                      {completeListingPackageBuilderCopy.catalogImageMissing}
                    </p>
                  )}
                </div>
              </article>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
              <h4 className="text-sm font-black text-white">
                {completeListingPackageBuilderCopy.secondaryImagePrompts}
              </h4>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {completeListingPackageBuilder.secondaryImagePrompts.map((prompt) => (
                  <article
                    key={prompt.imageNumber}
                    className="rounded-xl border border-white/10 bg-white/[0.03] p-4"
                  >
                    <p className="text-sm font-black text-white">
                      {prompt.imageNumber}. {prompt.name}
                    </p>
                    <p className="mt-2 break-words text-[11px] font-bold uppercase leading-5 tracking-[0.08em] text-amber-100/70 [overflow-wrap:anywhere]">
                      {prompt.status}
                    </p>
                    <p className="mt-3 text-sm leading-6 text-white/60">
                      {prompt.purpose}
                    </p>
                    <p className="mt-3 rounded-xl border border-cyan-300/10 bg-cyan-300/[0.035] p-3 text-xs leading-5 text-cyan-50/70">
                      {prompt.promptTemplate}
                    </p>
                  </article>
                ))}
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  {completeListingPackageBuilderCopy.draftPayloadDryRun}
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={[
                      [
                        "Payload mode",
                        completeListingPackageBuilder.draftPayloadDryRun
                          .payloadMode,
                      ],
                      [
                        "Payload built",
                        completeListingPackageBuilder.draftPayloadDryRun
                          .payloadBuilt,
                      ],
                      [
                        "Submitted to eBay",
                        completeListingPackageBuilder.draftPayloadDryRun
                          .submittedToEbay,
                      ],
                      [
                        "Ready for eBay API",
                        completeListingPackageBuilder.draftPayloadDryRun
                          .readyForEbayApi,
                      ],
                      [
                        "Ready for draft creation",
                        completeListingPackageBuilder.draftPayloadDryRun
                          .readyForDraftCreation,
                      ],
                      [
                        "Ready for publication",
                        completeListingPackageBuilder.draftPayloadDryRun
                          .readyForPublication,
                      ],
                    ]}
                  />
                </div>
                <div className="mt-4">
                  <ListBlock
                    items={
                      completeListingPackageBuilder.draftPayloadDryRun
                        .blockedUntilConfirmed
                    }
                  />
                </div>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  {completeListingPackageBuilderCopy.readinessGates}
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={Object.entries(
                      completeListingPackageBuilder.readinessGates
                    ).filter(([key]) => key !== "blockers")}
                  />
                </div>
                <div className="mt-4">
                  <ListBlock
                    items={completeListingPackageBuilder.readinessGates.blockers}
                  />
                </div>
              </article>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  {completeListingPackageBuilderCopy.blockedFields}
                </h4>
                <div className="mt-4">
                  <ListBlock items={completeListingPackageBuilder.blockedFields} />
                </div>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  {completeListingPackageBuilderCopy.requiredHumanActions}
                </h4>
                <div className="mt-4">
                  <ListBlock
                    items={completeListingPackageBuilder.requiredHumanActions}
                  />
                </div>
              </article>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Next Recommended Loop
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={[
                      [
                        completeListingPackageBuilderCopy.nextRecommendedLoop,
                        completeListingPackageBuilder.nextRecommendedLoop.loop,
                      ],
                      [
                        "Reason",
                        completeListingPackageBuilder.nextRecommendedLoop.reason,
                      ],
                      [
                        "Expected outcome",
                        completeListingPackageBuilder.nextRecommendedLoop
                          .expectedOutcome,
                      ],
                    ]}
                  />
                </div>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Compact Safety Flags
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={Object.entries(
                      completeListingPackageBuilder.safetyFlags
                    )}
                  />
                </div>
              </article>
            </div>
          </div>
        </Section>

        <Section title="Image Generation Service Design">
          <div className="grid gap-5">
            <div className="rounded-3xl border border-white/10 bg-black/20 p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="break-words text-[11px] font-semibold uppercase leading-5 tracking-[0.08em] text-cyan-100/60 [overflow-wrap:anywhere]">
                    {ebayImageGenerationServiceDesign.designVersion}
                  </p>
                  <h3 className="mt-2 text-xl font-black text-white">
                    {ebayImageGenerationServiceDesignCopy.title}
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-white/65">
                    {ebayImageGenerationServiceDesign.serviceSummary}
                  </p>
                </div>

                <div className="grid gap-3 text-sm font-bold text-white lg:min-w-[360px]">
                  <span className="break-words rounded-2xl border border-rose-300/20 bg-rose-300/[0.06] px-4 py-3 [overflow-wrap:anywhere]">
                    {ebayImageGenerationServiceDesignCopy.serviceStatus}
                  </span>
                  <span className="break-words rounded-2xl border border-rose-300/20 bg-rose-300/[0.06] px-4 py-3 [overflow-wrap:anywhere]">
                    {ebayImageGenerationServiceDesignCopy.serviceDecision}
                  </span>
                  <span className="break-words rounded-2xl border border-amber-300/20 bg-amber-300/[0.06] px-4 py-3 [overflow-wrap:anywhere]">
                    {ebayImageGenerationServiceDesignCopy.generationMode}
                  </span>
                </div>
              </div>

              <div className="mt-5">
                <FieldGrid
                  fields={[
                    [
                      "Service status",
                      ebayImageGenerationServiceDesign.serviceStatus,
                    ],
                    [
                      "Service decision",
                      ebayImageGenerationServiceDesign.serviceDecision,
                    ],
                    [
                      "Generation mode",
                      ebayImageGenerationServiceDesign.generationMode,
                    ],
                    [
                      "OpenAI status",
                      ebayImageGenerationServiceDesign.openAiStatus,
                    ],
                    [
                      "Source status",
                      ebayImageGenerationServiceDesign.sourceStatus,
                    ],
                    [
                      "Image generation impact",
                      ebayImageGenerationServiceDesign.imageGenerationImpact,
                    ],
                    [
                      "Image upload impact",
                      ebayImageGenerationServiceDesign.imageUploadImpact,
                    ],
                    [
                      "Draft impact",
                      ebayImageGenerationServiceDesign.draftImpact,
                    ],
                    [
                      "Publication impact",
                      ebayImageGenerationServiceDesign.publicationImpact,
                    ],
                    [
                      ebayImageGenerationServiceDesignCopy.noOpenAi,
                      ebayImageGenerationServiceDesign.generationReadiness
                        .openAiApiCallAllowed,
                    ],
                    [
                      ebayImageGenerationServiceDesignCopy.noGeneration,
                      ebayImageGenerationServiceDesign.safetyFlags
                        .imageGenerated,
                    ],
                    [
                      ebayImageGenerationServiceDesignCopy.noUploadStorage,
                      ebayImageGenerationServiceDesign.safetyFlags
                        .imageUploaded,
                    ],
                  ]}
                />
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Generation Readiness
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={Object.entries(
                      ebayImageGenerationServiceDesign.generationReadiness
                    )}
                  />
                </div>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Service Boundaries
                </h4>
                <div className="mt-4 grid gap-4">
                  <div>
                    <h5 className="text-sm font-black text-white">
                      Allowed in this loop
                    </h5>
                    <div className="mt-3">
                      <ListBlock
                        items={
                          ebayImageGenerationServiceDesign.serviceBoundaries
                            .allowedInThisLoop
                        }
                      />
                    </div>
                  </div>

                  <div>
                    <h5 className="text-sm font-black text-white">
                      Forbidden in this loop
                    </h5>
                    <div className="mt-3">
                      <ListBlock
                        items={
                          ebayImageGenerationServiceDesign.serviceBoundaries
                            .forbiddenInThisLoop
                        }
                      />
                    </div>
                  </div>

                  <p className="rounded-2xl border border-amber-300/20 bg-amber-300/[0.045] p-4 text-sm leading-6 text-amber-50/80">
                    {
                      ebayImageGenerationServiceDesign.serviceBoundaries
                        .imagePolicy
                    }
                  </p>
                  <p className="rounded-2xl border border-cyan-300/20 bg-cyan-300/[0.045] p-4 text-sm leading-6 text-cyan-50/80">
                    {
                      ebayImageGenerationServiceDesign.serviceBoundaries
                        .dryRunPolicy
                    }
                  </p>
                </div>
              </article>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
              <h4 className="text-sm font-black text-white">
                Generation Phases
              </h4>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {ebayImageGenerationServiceDesign.generationPhases.map((phase) => (
                  <article
                    key={phase.phaseId}
                    className="rounded-xl border border-white/10 bg-white/[0.03] p-4"
                  >
                    <p className="break-words text-sm font-black leading-6 text-white [overflow-wrap:anywhere]">
                      {phase.label}
                    </p>
                    <p className="mt-2 break-words text-[11px] font-bold uppercase leading-5 tracking-[0.08em] text-amber-100/70 [overflow-wrap:anywhere]">
                      {phase.status}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-white/60">
                      {phase.reason}
                    </p>
                  </article>
                ))}
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Image Types
                </h4>
                <div className="mt-4 grid gap-3">
                  {ebayImageGenerationServiceDesign.imageTypes.map((imageType) => (
                    <div
                      key={imageType.imageType}
                      className="rounded-xl border border-white/10 bg-white/[0.03] p-3"
                    >
                      <p className="break-words text-sm font-bold text-white [overflow-wrap:anywhere]">
                        {imageType.label}
                      </p>
                      <p className="mt-1 break-words text-[11px] font-bold uppercase leading-5 tracking-[0.08em] text-amber-100/70 [overflow-wrap:anywhere]">
                        {imageType.status}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-white/60">
                        {imageType.reason}
                      </p>
                    </div>
                  ))}
                </div>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Input Requirements
                </h4>
                <div className="mt-4 grid gap-3">
                  {ebayImageGenerationServiceDesign.inputRequirements.map((requirement) => (
                    <div
                      key={requirement.requirementId}
                      className="rounded-xl border border-white/10 bg-white/[0.03] p-3"
                    >
                      <p className="break-words text-sm font-bold text-white [overflow-wrap:anywhere]">
                        {requirement.label}
                      </p>
                      <p className="mt-1 break-words text-[11px] font-bold uppercase leading-5 tracking-[0.08em] text-amber-100/70 [overflow-wrap:anywhere]">
                        {requirement.status}
                      </p>
                    </div>
                  ))}
                </div>
              </article>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Blocked Workflows
                </h4>
                <div className="mt-4 grid gap-3">
                  {ebayImageGenerationServiceDesign.blockedWorkflows.map((workflow) => (
                    <div
                      key={workflow.workflow}
                      className="rounded-xl border border-white/10 bg-white/[0.03] p-3"
                    >
                      <p className="break-words text-sm font-bold text-white [overflow-wrap:anywhere]">
                        {workflow.workflow}
                      </p>
                      <p className="mt-1 break-words text-[11px] font-bold uppercase leading-5 tracking-[0.08em] text-amber-100/70 [overflow-wrap:anywhere]">
                        {workflow.status}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-white/60">
                        {workflow.reason}
                      </p>
                    </div>
                  ))}
                </div>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Required Human Actions
                </h4>
                <div className="mt-4">
                  <ListBlock
                    items={
                      ebayImageGenerationServiceDesign.requiredHumanActions
                    }
                  />
                </div>
              </article>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Next Recommended Loop
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={[
                      [
                        ebayImageGenerationServiceDesignCopy.nextRecommendedLoop,
                        ebayImageGenerationServiceDesign.nextRecommendedLoop.loop,
                      ],
                      [
                        "Reason",
                        ebayImageGenerationServiceDesign.nextRecommendedLoop.reason,
                      ],
                    ]}
                  />
                </div>
                <div className="mt-4">
                  <ListBlock
                    items={
                      ebayImageGenerationServiceDesign.nextRecommendedLoop
                        .constraints
                    }
                  />
                </div>
              </article>

              <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Compact Safety Flags
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={Object.entries(
                      ebayImageGenerationServiceDesign.safetyFlags
                    )}
                  />
                </div>
              </article>
            </div>
          </div>
        </Section>

        <Section title="Product / Pricing / Shipping">
          <div className="grid gap-5">
            <div>
              <h3 className="text-sm font-black text-white">
                Listing Overview
              </h3>
              <div className="mt-3">
                <FieldGrid
                  fields={[
                    [
                      "caseId",
                      listingPackage.caseId,
                    ],
                    [
                      "marketplace",
                      listingPackage.marketplace,
                    ],
                    [
                      "language",
                      listingPackage.language,
                    ],
                    [
                      "candidateName",
                      listingPackage.candidateName,
                    ],
                    [
                      "listingTitle",
                      listingPackage.listingTitle,
                    ],
                    [
                      "subtitleSuggestion",
                      listingPackage.subtitleSuggestion,
                    ],
                  ]}
                />
              </div>
            </div>

            <div>
              <h3 className="text-sm font-black text-white">
                Buyer-Facing Copy
              </h3>
              <div className="mt-3 grid gap-5 lg:grid-cols-2">
                <ListBlock items={listingPackage.titleAlternatives} />
                <ListBlock items={listingPackage.buyerFacingCopy.bullets} />
              </div>
              <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4">
                <p className="text-sm font-black text-white">
                  descriptionHtml read-only text
                </p>
                <pre className="mt-3 whitespace-pre-wrap break-words text-xs leading-6 text-white/60">
                  {listingPackage.buyerFacingCopy.descriptionHtml}
                </pre>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-black text-white">
                Item Specifics
              </h3>
              <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {listingPackage.itemSpecifics.map((item) => (
                  <div
                    key={item.name}
                    className="rounded-2xl border border-white/10 bg-black/20 p-4"
                  >
                    <p className="text-sm font-black text-white">
                      {item.name}
                    </p>
                    <p className="mt-2 text-sm text-cyan-100">
                      {item.value}
                    </p>
                    <p className="mt-2 break-words text-[11px] uppercase leading-5 tracking-[0.08em] text-amber-100/70 [overflow-wrap:anywhere]">
                      {item.verificationStatus.includes("missing")
                        ? "needs data"
                        : item.verificationStatus}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-black text-white">
                Price Strategy
              </h3>
              <div className="mt-3">
                <FieldGrid
                  fields={[
                    [
                      "suggestedPriceUsd",
                      listingPackage.priceStrategy.suggestedPriceUsd,
                    ],
                    [
                      "minimumPriceUsd",
                      listingPackage.priceStrategy.minimumPriceUsd,
                    ],
                    [
                      "targetProfitUsd",
                      listingPackage.priceStrategy.targetProfitUsd,
                    ],
                    [
                      "needsCostVerification",
                      listingPackage.priceStrategy.needsCostVerification,
                    ],
                  ]}
                />
              </div>
            </div>

            <div>
              <h3 className="text-sm font-black text-white">
                Shipping & Returns
              </h3>
              <div className="mt-3">
                <FieldGrid
                  fields={[
                    [
                      "shippingCopy",
                      listingPackage.shipping.shippingCopy,
                    ],
                    [
                      "freeShippingAllowed",
                      listingPackage.shipping.freeShippingAllowed,
                    ],
                    [
                      "freeShippingVerified",
                      listingPackage.shipping.freeShippingVerified,
                    ],
                    [
                      "shipsFromUsaAllowed",
                      listingPackage.shipping.shipsFromUsaAllowed,
                    ],
                    [
                      "shipsFromUsaVerified",
                      listingPackage.shipping.shipsFromUsaVerified,
                    ],
                    [
                      "inStockInUsaAllowed",
                      listingPackage.shipping.inStockInUsaAllowed,
                    ],
                    [
                      "inStockInUsaVerified",
                      listingPackage.shipping.inStockInUsaVerified,
                    ],
                    [
                      "returnPolicyCopy",
                      listingPackage.returns.returnPolicyCopy,
                    ],
                    [
                      "needsHumanConfirmation",
                      listingPackage.returns.needsHumanConfirmation,
                    ],
                  ]}
                />
              </div>
            </div>
          </div>
        </Section>

        <Section id="image-plan" title="Image Plan">
          <div className="grid gap-5">
            <div className="rounded-3xl border border-cyan-300/15 bg-cyan-300/[0.04] p-5">
              <h3 className="text-sm font-black text-white">
                Orden de trabajo de imagenes
              </h3>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                {imageWorkflowOrder.map((item) => (
                  <article
                    key={item.step}
                    className="rounded-2xl border border-white/10 bg-black/20 p-4"
                  >
                    <p className="break-words text-[11px] font-black uppercase leading-5 tracking-[0.08em] text-cyan-100/60 [overflow-wrap:anywhere]">
                      Paso {item.step}
                    </p>
                    <h4 className="mt-3 text-sm font-black text-white">
                      {item.title}
                    </h4>
                    <p className="mt-3 text-sm leading-6 text-white/60">
                      {item.detail}
                    </p>
                  </article>
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-black text-white">
                Main Image Enhancement Brief
              </h3>
              <div className="mt-3 grid gap-4 lg:grid-cols-2">
                <FieldGrid
                  fields={[
                    [
                      "briefVersion",
                      mainImageEnhancementBrief.briefVersion,
                    ],
                    [
                      "briefStatus",
                      mainImageEnhancementBriefCopy.briefStatus,
                    ],
                    [
                      "executionStatus",
                      mainImageEnhancementBriefCopy.executionStatus,
                    ],
                    [
                      "draftImpact",
                      mainImageEnhancementBriefCopy.draftImpact,
                    ],
                    [
                      mainImageEnhancementBriefCopy.sourceReviewRequired,
                      mainImageEnhancementBrief.sourceRequirements
                        .sourceReviewStatusRequired,
                    ],
                    [
                      mainImageEnhancementBriefCopy.authorizedSource,
                      mainImageEnhancementBrief.sourceRequirements
                        .requiredSource,
                    ],
                    [
                      mainImageEnhancementBriefCopy.blocked,
                      mainImageEnhancementBrief.approvalGate
                        .currentGateStatus,
                    ],
                  ]}
                />

                <FieldGrid
                  fields={[
                    [
                      mainImageEnhancementBriefCopy.pureWhiteBackground,
                      mainImageEnhancementBrief.targetOutputSpec.background,
                    ],
                    [
                      mainImageEnhancementBriefCopy.squareImage,
                      mainImageEnhancementBrief.targetOutputSpec.aspectRatio,
                    ],
                    [
                      mainImageEnhancementBriefCopy.minimumResolution,
                      mainImageEnhancementBrief.targetOutputSpec
                        .minimumResolutionPx,
                    ],
                    [
                      mainImageEnhancementBriefCopy.productCentered,
                      mainImageEnhancementBrief.targetOutputSpec
                        .productCentered,
                    ],
                    [
                      mainImageEnhancementBriefCopy.noProductAlteration,
                      mainImageEnhancementBrief.approvalGate
                        .enhancementAllowedNow,
                    ],
                    [
                      mainImageEnhancementBriefCopy.notOpenAiPayload,
                      mainImageEnhancementBrief.enhancementInstruction
                        .notAnOpenAiPayload,
                    ],
                  ]}
                />
              </div>

              <div className="mt-5 grid gap-4 lg:grid-cols-2">
                <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                  <h4 className="text-sm font-black text-white">
                    Allowed Enhancements
                  </h4>
                  <div className="mt-3">
                    <ListBlock
                      items={mainImageEnhancementBrief.allowedEnhancements}
                    />
                  </div>
                </article>

                <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                  <h4 className="text-sm font-black text-white">
                    Prohibited Enhancements
                  </h4>
                  <div className="mt-3">
                    <ListBlock
                      items={mainImageEnhancementBrief.prohibitedEnhancements}
                    />
                  </div>
                </article>
              </div>

              <div className="mt-5 grid gap-4 lg:grid-cols-2">
                <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                  <h4 className="text-sm font-black text-white">
                    Quality Checklist
                  </h4>
                  <div className="mt-4 grid gap-3">
                    {mainImageEnhancementBrief.qualityChecklist.map((check) => (
                      <div
                        key={check.checkId}
                        className="rounded-xl border border-white/10 bg-white/[0.03] p-3"
                      >
                        <p className="text-sm font-bold text-white">
                          {check.label}
                        </p>
                        <p className="mt-2 break-words text-[11px] uppercase leading-5 tracking-[0.08em] text-amber-100/70 [overflow-wrap:anywhere]">
                          {check.status}
                        </p>
                      </div>
                    ))}
                  </div>
                </article>

                <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                  <h4 className="text-sm font-black text-white">
                    Compliance Checklist
                  </h4>
                  <div className="mt-4 grid gap-3">
                    {mainImageEnhancementBrief.complianceChecklist.map((check) => (
                      <div
                        key={check.checkId}
                        className="rounded-xl border border-white/10 bg-white/[0.03] p-3"
                      >
                        <p className="text-sm font-bold text-white">
                          {check.label}
                        </p>
                        <p className="mt-2 break-words text-[11px] uppercase leading-5 tracking-[0.08em] text-amber-100/70 [overflow-wrap:anywhere]">
                          {check.status}
                        </p>
                      </div>
                    ))}
                  </div>
                </article>
              </div>

              <div className="mt-5 grid gap-4 lg:grid-cols-2">
                <FieldGrid
                  fields={[
                    [
                      "approvalGate",
                      mainImageEnhancementBrief.approvalGate
                        .currentGateStatus,
                    ],
                    [
                      "sourceReviewApproved",
                      mainImageEnhancementBrief.approvalGate
                        .sourceReviewApproved,
                    ],
                    [
                      "enhancementAllowedNow",
                      mainImageEnhancementBrief.approvalGate
                        .enhancementAllowedNow,
                    ],
                    [
                      "imageQaApproved",
                      mainImageEnhancementBrief.approvalGate
                        .imageQaApproved,
                    ],
                    [
                      "draftCreationAllowed",
                      mainImageEnhancementBrief.approvalGate
                        .draftCreationAllowed,
                    ],
                  ]}
                />

                <FieldGrid
                  fields={[
                    [
                      "advisoryOnly",
                      mainImageEnhancementBrief.safetyFlags.advisoryOnly,
                    ],
                    [
                      "sourceApproved",
                      mainImageEnhancementBrief.safetyFlags.sourceApproved,
                    ],
                    [
                      "enhancementExecuted",
                      mainImageEnhancementBrief.safetyFlags
                        .enhancementExecuted,
                    ],
                    [
                      "imageGenerated",
                      mainImageEnhancementBrief.safetyFlags.imageGenerated,
                    ],
                    [
                      "ebayApiUsed",
                      mainImageEnhancementBrief.safetyFlags.ebayApiUsed,
                    ],
                  ]}
                />
              </div>

              <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-5">
                <h4 className="text-sm font-black text-white">
                  Enhancement Instruction
                </h4>
                <p className="mt-3 text-sm leading-6 text-white/65">
                  {mainImageEnhancementBrief.enhancementInstruction.summary}
                </p>
                <div className="mt-3">
                  <ListBlock
                    items={mainImageEnhancementBrief.enhancementInstruction.steps}
                  />
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-black text-white">
                Image QA Review Gate
              </h3>
              <div className="mt-3 grid gap-4 lg:grid-cols-2">
                <FieldGrid
                  fields={[
                    [
                      "gateVersion",
                      imageQaReviewGate.gateVersion,
                    ],
                    [
                      "gateStatus",
                      imageQaReviewGateCopy.gateStatus,
                    ],
                    [
                      "gateDecision",
                      imageQaReviewGateCopy.gateDecision,
                    ],
                    [
                      "listingImpact",
                      imageQaReviewGateCopy.listingImpact,
                    ],
                    [
                      "draftImpact",
                      imageQaReviewGateCopy.draftImpact,
                    ],
                    [
                      "publicationImpact",
                      imageQaReviewGateCopy.publicationImpact,
                    ],
                    [
                      imageQaReviewGateCopy.summary,
                      imageQaReviewGate.imageQaSummary,
                    ],
                    [
                      imageQaReviewGateCopy.currentDecision,
                      imageQaReviewGate.humanDecision.currentDecision,
                    ],
                  ]}
                />

                <FieldGrid
                  fields={Object.entries(imageQaReviewGate.reviewInputs)}
                />
              </div>

              <div className="mt-5 grid gap-4 lg:grid-cols-2">
                <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                  <h4 className="text-sm font-black text-white">
                    Image QA Checks
                  </h4>
                  <div className="mt-4 grid gap-3">
                    {imageQaReviewGate.imageQaChecks.map((check) => (
                      <div
                        key={check.checkId}
                        className="rounded-xl border border-rose-300/15 bg-rose-300/[0.045] p-3"
                      >
                        <p className="text-sm font-bold text-white">
                          {check.label}
                        </p>
                        <p className="mt-2 break-words text-[11px] font-bold uppercase leading-5 tracking-[0.08em] text-rose-100/70 [overflow-wrap:anywhere]">
                          {check.status}
                        </p>
                        <p className="mt-2 text-sm leading-6 text-white/60">
                          {check.reason}
                        </p>
                      </div>
                    ))}
                  </div>
                </article>

                <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                  <h4 className="text-sm font-black text-white">
                    Blocked Workflows
                  </h4>
                  <div className="mt-4 grid gap-3">
                    {imageQaReviewGate.blockedWorkflows.map((workflow) => (
                      <div
                        key={workflow.workflow}
                        className="rounded-xl border border-white/10 bg-white/[0.03] p-3"
                      >
                        <p className="text-sm font-bold text-white">
                          {workflow.workflow}
                        </p>
                        <p className="mt-1 break-words text-[11px] font-bold uppercase leading-5 tracking-[0.08em] text-amber-100/70 [overflow-wrap:anywhere]">
                          {workflow.status}
                        </p>
                        <p className="mt-2 text-sm leading-6 text-white/60">
                          {workflow.reason}
                        </p>
                      </div>
                    ))}
                  </div>
                </article>
              </div>

              <div className="mt-5 grid gap-4 lg:grid-cols-3">
                <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                  <h4 className="text-sm font-black text-white">
                    Unlock Requirements
                  </h4>
                  <div className="mt-4">
                    <ListBlock items={imageQaReviewGate.unlockRequirements} />
                  </div>
                </article>

                <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                  <h4 className="text-sm font-black text-white">
                    Human Decision
                  </h4>
                  <div className="mt-3">
                    <FieldGrid fields={Object.entries(imageQaReviewGate.humanDecision)} />
                  </div>
                </article>

                <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                  <h4 className="text-sm font-black text-white">
                    Compact Safety Flags
                  </h4>
                  <div className="mt-3">
                    <FieldGrid fields={Object.entries(imageQaReviewGate.safetyFlags)} />
                  </div>
                </article>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-black text-white">
                Image Source Review Gate
              </h3>
              <div className="mt-3 grid gap-4 lg:grid-cols-2">
                <FieldGrid
                  fields={[
                    [
                      "gateVersion",
                      imageSourceReviewGate.gateVersion,
                    ],
                    [
                      "gateStatus",
                      imageSourceReviewGateCopy.gateStatus,
                    ],
                    [
                      "gateDecision",
                      imageSourceReviewGateCopy.gateDecision,
                    ],
                    [
                      "draftImpact",
                      imageSourceReviewGateCopy.draftImpact,
                    ],
                    [
                      imageSourceReviewGateCopy.summary,
                      imageSourceReviewGate.sourceReviewSummary,
                    ],
                    [
                      imageSourceReviewGateCopy.humanReviewRequired,
                      imageSourceReviewGate.humanDecision.required,
                    ],
                    [
                      imageSourceReviewGateCopy.requestMoreEvidence,
                      imageSourceReviewGate.humanDecision.currentDecision,
                    ],
                  ]}
                />

                <FieldGrid
                  fields={[
                    [
                      imageSourceReviewGateCopy.imageEnhancementBlocked,
                      imageSourceReviewGate.safetyFlags.imageEnhancementUnlocked,
                    ],
                    [
                      imageSourceReviewGateCopy.imageQaBlocked,
                      imageSourceReviewGate.safetyFlags.imageQaUnlocked,
                    ],
                    [
                      imageSourceReviewGateCopy.draftMappingBlocked,
                      imageSourceReviewGate.safetyFlags.draftMappingUnlocked,
                    ],
                    [
                      imageSourceReviewGateCopy.draftCreationBlocked,
                      imageSourceReviewGate.safetyFlags.draftCreationUnlocked,
                    ],
                  ]}
                />
              </div>

              <div className="mt-5 grid gap-4 lg:grid-cols-2">
                <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                  <h4 className="text-sm font-black text-white">
                    Blocked Workflows
                  </h4>
                  <div className="mt-4 grid gap-3">
                    {imageSourceReviewGate.blockedWorkflows.map((workflow) => (
                      <div
                        key={workflow.workflow}
                        className="rounded-xl border border-white/10 bg-white/[0.03] p-3"
                      >
                        <p className="text-sm font-bold text-white">
                          {workflow.workflow}
                        </p>
                        <p className="mt-2 break-words text-[11px] uppercase leading-5 tracking-[0.08em] text-amber-100/70 [overflow-wrap:anywhere]">
                          {workflow.status}
                        </p>
                        <p className="mt-2 text-sm leading-6 text-white/60">
                          {workflow.reason}
                        </p>
                      </div>
                    ))}
                  </div>
                </article>

                <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                  <h4 className="text-sm font-black text-white">
                    Unlock Requirements
                  </h4>
                  <div className="mt-3">
                    <ListBlock items={imageSourceReviewGate.unlockRequirements} />
                  </div>
                </article>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-black text-white">
                Image Source Intake
              </h3>
              <div className="mt-3 grid gap-4 lg:grid-cols-2">
                <FieldGrid
                  fields={[
                    [
                      "intakeVersion",
                      imageSourceIntake.intakeVersion,
                    ],
                    [
                      "intakeStatus",
                      imageSourceIntakeCopy.intakeStatus,
                    ],
                    [
                      "draftImpact",
                      imageSourceIntakeCopy.draftImpact,
                    ],
                    [
                      "sourceType",
                      imageSourceIntake.primaryImageSourceEvidence.sourceType,
                    ],
                    [
                      imageSourceIntakeCopy.humanReviewRequired,
                      imageSourceIntake.humanReview.required,
                    ],
                    [
                      imageSourceIntakeCopy.reviewStatus,
                      imageSourceIntake.humanReview.reviewStatus,
                    ],
                    [
                      imageSourceIntakeCopy.approvalGate,
                      imageSourceIntake.humanReview.approvalStatus,
                    ],
                    [
                      "authorizationChecklist",
                      imageSourceIntakeCopy.checklistLabels.join(", "),
                    ],
                  ]}
                />

                <FieldGrid
                  fields={Object.entries(
                    imageSourceIntake.primaryImageSourceEvidence
                  ).filter(([
                    _label,
                    value,
                  ]) => !Array.isArray(value))}
                />
              </div>

              <div className="mt-5 grid gap-4 lg:grid-cols-2">
                <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                  <h4 className="text-sm font-black text-white">
                    Authorization Checklist
                  </h4>
                  <div className="mt-4 grid gap-3">
                    {imageSourceIntake.authorizationChecklist.map((check) => (
                      <div
                        key={check.checkId}
                        className="rounded-xl border border-white/10 bg-white/[0.03] p-3"
                      >
                        <p className="text-sm font-bold text-white">
                          {check.label}
                        </p>
                        <p className="mt-2 break-words text-[11px] uppercase leading-5 tracking-[0.08em] text-amber-100/70 [overflow-wrap:anywhere]">
                          {check.status}
                        </p>
                      </div>
                    ))}
                  </div>
                </article>

                <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                  <h4 className="text-sm font-black text-white">
                    Source Validation Rules
                  </h4>
                  <div className="mt-4">
                    <FieldGrid
                      fields={Object.entries(
                        imageSourceIntake.sourceValidationRules
                      )}
                    />
                  </div>
                </article>
              </div>

              <div className="mt-5 grid gap-4 lg:grid-cols-2">
                <div>
                  <h4 className="text-sm font-black text-white">
                    Blocked Until
                  </h4>
                  <div className="mt-3">
                    <ListBlock items={imageSourceIntake.blockedUntil} />
                  </div>
                </div>

                <div>
                  <h4 className="text-sm font-black text-white">
                    Source Intake Safety Flags
                  </h4>
                  <div className="mt-3">
                    <FieldGrid
                      fields={Object.entries(
                        imageSourceIntake.safetyFlags
                      )}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-black text-white">
                Image Asset Manifest
              </h3>
              <div className="mt-3 grid gap-4 lg:grid-cols-2">
                <FieldGrid
                  fields={[
                    [
                      "manifestVersion",
                      imageAssetManifest.manifestVersion,
                    ],
                    [
                      "manifestStatus",
                      imageAssetManifestCopy.manifestStatus,
                    ],
                    [
                      "publicationImpact",
                      imageAssetManifestCopy.publicationImpact,
                    ],
                    [
                      "primarySource",
                      imageAssetManifest.imageSourceModel.primarySource,
                    ],
                    [
                      "source label",
                      imageAssetManifestCopy.sourceLabel,
                    ],
                    [
                      "workflow current step",
                      imageAssetManifestCopy.currentStep,
                    ],
                    [
                      "nextStep",
                      imageAssetManifest.workflow.nextStep,
                    ],
                    [
                      imageAssetManifestCopy.draftGate,
                      imageAssetManifest.workflow.draftGate,
                    ],
                    [
                      "secondarySlotRoles",
                      imageAssetManifestCopy.secondarySlotRoles.join(", "),
                    ],
                  ]}
                />

                <FieldGrid
                  fields={Object.entries(
                    imageAssetManifest.imageSourceModel
                  )}
                />
              </div>

              <div className="mt-5 grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
                <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                  <p className="break-words text-[11px] font-semibold uppercase leading-5 tracking-[0.08em] text-white/40 [overflow-wrap:anywhere]">
                    Main Image Slot
                  </p>
                  <h4 className="mt-3 text-base font-black text-white">
                    {imageAssetManifest.mainImageSlot.role}
                  </h4>
                  <div className="mt-4 grid gap-3 text-sm text-white/65">
                    {[
                      [
                        "sourceRequired",
                        imageAssetManifest.mainImageSlot.sourceRequired,
                      ],
                      [
                        "sourceStatus",
                        imageAssetManifest.mainImageSlot.sourceStatus,
                      ],
                      [
                        "authorizationStatus",
                        imageAssetManifest.mainImageSlot.authorizationStatus,
                      ],
                      [
                        "enhancementStatus",
                        imageAssetManifestCopy.enhancementStatus,
                      ],
                      [
                        "qaStatus",
                        imageAssetManifestCopy.qaStatus,
                      ],
                    ].map(([label, value]) => (
                      <p
                        key={label}
                        className="break-words rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2"
                      >
                        <span className="font-bold text-white">
                          {label}:
                        </span>{" "}
                        {value}
                      </p>
                    ))}
                  </div>
                </article>

                <article className="rounded-2xl border border-white/10 bg-black/20 p-5">
                  <p className="break-words text-[11px] font-semibold uppercase leading-5 tracking-[0.08em] text-white/40 [overflow-wrap:anywhere]">
                    Workflow
                  </p>
                  <div className="mt-4 grid gap-3 text-sm text-white/65">
                    {imageAssetManifest.workflow.steps.map((step) => (
                      <p
                        key={step}
                        className="break-words rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2"
                      >
                        {step}
                      </p>
                    ))}
                  </div>
                </article>
              </div>

              <div className="mt-5">
                <h4 className="text-sm font-black text-white">
                  Secondary Image Slots
                </h4>
                <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {imageAssetManifest.secondaryImageSlots.map((slot) => (
                    <article
                      key={slot.slotId}
                      className="rounded-2xl border border-white/10 bg-black/20 p-4"
                    >
                      <p className="break-words text-[11px] font-semibold uppercase leading-5 tracking-[0.08em] text-white/40 [overflow-wrap:anywhere]">
                        {slot.slotId}
                      </p>
                      <h5 className="mt-2 text-sm font-black text-white">
                        {slot.role}
                      </h5>
                      <div className="mt-3 space-y-2 text-sm text-white/65">
                        <p>
                          status: {slot.status}
                        </p>
                        <p>
                          factVerificationRequired: {formatValue(slot.factVerificationRequired)}
                        </p>
                        <p>
                          imageQaRequired: {formatValue(slot.imageQaRequired)}
                        </p>
                        <p>
                          textAllowed: {formatValue(slot.textAllowed)}
                        </p>
                      </div>
                    </article>
                  ))}
                </div>
              </div>

              <div className="mt-5">
                <h4 className="text-sm font-black text-white">
                  Image Asset Safety Flags
                </h4>
                <div className="mt-3">
                  <FieldGrid
                    fields={Object.entries(
                      imageAssetManifest.safetyFlags
                    )}
                  />
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-black text-white">
                Main Image Policy
              </h3>
              <div className="mt-3">
                <FieldGrid
                  fields={[
                    [
                      "authorized catalog source",
                      listingPackage.mainImagePolicy.imageSourceRequired,
                    ],
                    [
                      "sourceAuthorizationRequired",
                      listingPackage.mainImagePolicy.sourceAuthorizationRequired,
                    ],
                    [
                      "catalogSource",
                      listingPackage.mainImagePolicy.catalogSource,
                    ],
                    [
                      "physicalProductInSellerPossessionRequired",
                      listingPackage.mainImagePolicy.physicalProductInSellerPossessionRequired,
                    ],
                    [
                      "enhancementRequired",
                      listingPackage.mainImagePolicy.enhancementRequired,
                    ],
                    [
                      "White-background main image required",
                      listingPackage.mainImagePolicy.finalBackgroundRequired,
                    ],
                    [
                      "1600 px minimum",
                      listingPackage.mainImagePolicy.minimumResolutionPx,
                    ],
                    [
                      "no text",
                      listingPackage.mainImagePolicy.textAllowed,
                    ],
                    [
                      "no trust badges",
                      listingPackage.mainImagePolicy.trustBadgesAllowed,
                    ],
                    [
                      "no trust badges",
                      optionalTrustVisual.mainImageExclusions.includes("no trust badges"),
                    ],
                    [
                      "no USA flag",
                      optionalTrustVisual.mainImageExclusions.includes("no USA flag"),
                    ],
                    [
                      "No AI-generated product",
                      listingPackage.mainImagePolicy.aiGeneratedProductAllowed,
                    ],
                    [
                      "controlled background cleanup after review",
                      listingPackage.mainImagePolicy.aiAssistedBackgroundCleanupAllowedAfterHumanReview,
                    ],
                    [
                      "status",
                      listingPackage.mainImagePolicy.status,
                    ],
                    [
                      "enhancementStatus",
                      listingPackage.mainImageEnhancementPolicy.status,
                    ],
                    [
                      "no watermarks",
                      listingPackage.mainImagePolicy.watermarksAllowed,
                    ],
                  ]}
                />
              </div>
            </div>

            <div>
              <h3 className="text-sm font-black text-white">
                Main Image Enhancement Policy
              </h3>
              <div className="mt-3 grid gap-4 lg:grid-cols-2">
                <div>
                  <p className="mb-3 break-words text-[11px] font-semibold uppercase leading-5 tracking-[0.08em] text-white/40 [overflow-wrap:anywhere]">
                    Allowed enhancements
                  </p>
                  <ListBlock items={listingPackage.mainImageEnhancementPolicy.allowedEnhancements} />
                </div>
                <div>
                  <p className="mb-3 break-words text-[11px] font-semibold uppercase leading-5 tracking-[0.08em] text-white/40 [overflow-wrap:anywhere]">
                    Prohibited enhancements
                  </p>
                  <ListBlock items={listingPackage.mainImageEnhancementPolicy.prohibitedEnhancements} />
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-black text-white">
                Secondary Image Strategy
              </h3>
              <div className="mt-3 grid gap-4 lg:grid-cols-2">
                {listingPackage.imagePlan.secondaryImages.map((image) => (
                  <article
                    key={image.role}
                    className="rounded-2xl border border-white/10 bg-black/20 p-5"
                  >
                    <p className="break-words text-[11px] font-semibold uppercase leading-5 tracking-[0.08em] text-white/40 [overflow-wrap:anywhere]">
                      Image {image.imageNumber}
                    </p>
                    <h4 className="mt-2 text-base font-black text-white">
                      {image.role}
                    </h4>
                    <p className="mt-2 text-sm text-cyan-100">
                      {image.title}
                    </p>
                    <p className="mt-3 text-sm leading-6 text-white/65">
                      {image.purpose}
                    </p>
                    <div className="mt-4 grid gap-2 text-sm text-white/65 sm:grid-cols-2">
                      <p>
                        status: {image.status}
                      </p>
                      <p>
                        textAllowed: {formatValue(image.textAllowed)}
                      </p>
                    </div>
                  </article>
                ))}
              </div>
              <p className="mt-5 rounded-2xl border border-cyan-300/15 bg-cyan-300/[0.04] p-4 text-sm font-semibold text-cyan-50/80">
                Only dimensions allows text.
              </p>
            </div>
          </div>
        </Section>

        <Section title="Market Validation">
          <div className="grid gap-5 lg:grid-cols-2">
            <div>
              <h3 className="text-sm font-black text-white">
                Terapeak Validation
              </h3>
              <div className="mt-3">
                <FieldGrid
                  fields={[
                    [
                      "requiredBeforePublish",
                      listingPackage.terapeakValidation.requiredBeforePublish,
                    ],
                    [
                      "status",
                      listingPackage.terapeakValidation.status,
                    ],
                    [
                      "sales volume",
                      listingPackage.terapeakValidation.salesVolumeRequired,
                    ],
                    [
                      "average sold price",
                      listingPackage.terapeakValidation.averageSoldPriceRequired,
                    ],
                    [
                      "sell-through rate",
                      listingPackage.terapeakValidation.sellThroughRateRequired,
                    ],
                    [
                      "active listings",
                      listingPackage.terapeakValidation.activeListingsRequired,
                    ],
                    [
                      "competition review",
                      listingPackage.terapeakValidation.competitionReviewRequired,
                    ],
                    [
                      "margin validation",
                      listingPackage.terapeakValidation.marginValidationRequired,
                    ],
                  ]}
                />
              </div>
            </div>

            <div>
              <h3 className="text-sm font-black text-white">
                Sold Listings Benchmark
              </h3>
              <div className="mt-3">
                <FieldGrid
                  fields={[
                    [
                      "strategyStatus",
                      soldListingsBenchmark.strategyStatus,
                    ],
                    [
                      "manualCopyNotScalable",
                      soldListingsBenchmark.manualCopyNotScalable,
                    ],
                    [
                      "preferredFutureAcquisitionMode",
                      soldListingsBenchmark.preferredFutureAcquisitionMode,
                    ],
                    [
                      "currentLoopAcquisitionMode",
                      soldListingsBenchmark.currentLoopAcquisitionMode,
                    ],
                    [
                      "Sell One Like This",
                      sellOneLikeThis.status,
                    ],
                    [
                      "mustRewriteTitle",
                      sellOneLikeThis.mustRewriteTitle,
                    ],
                    [
                      "mustRewriteDescription",
                      sellOneLikeThis.mustRewriteDescription,
                    ],
                    [
                      "mustReplacePhotos",
                      sellOneLikeThis.mustReplacePhotos,
                    ],
                    [
                      "mustNotCopyCompetitorContent",
                      sellOneLikeThis.mustNotCopyCompetitorContent,
                    ],
                  ]}
                />
              </div>
            </div>
          </div>
        </Section>

        <Section title="Trust Signals">
          <p className="mb-5 text-sm leading-7 text-white/60">
            US Buyer Trust Signals must stay inactive until verified. Do not use on main image. USA flag must not imply Made in USA.
          </p>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {Object.entries(trustSignals).map(([key, signal]) => (
              <div
                key={key}
                className="min-w-0 break-words rounded-2xl border border-amber-300/20 bg-amber-300/[0.045] p-5 [overflow-wrap:anywhere]"
              >
                <h3 className="text-sm font-black text-white">
                  {
                    trustSignalLabels[
                      key as keyof typeof trustSignalLabels
                    ]
                  }
                </h3>
                <div className="mt-4 space-y-2 text-sm text-white/70">
                  <p>
                    allowed: {formatValue(signal.allowed)}
                  </p>
                  <p>
                    verified: {formatValue(signal.verified)}
                  </p>
                  <p>
                    instruction: {signal.instruction}
                  </p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-5">
            <h3 className="text-sm font-black text-white">
              Optional US Buyer Trust Visual
            </h3>
            <div className="mt-3">
              <FieldGrid
                fields={[
                  [
                    "allowedOnlyIfVerified",
                    optionalTrustVisual.allowedOnlyAfterVerification,
                  ],
                  [
                    "notMainImage",
                    optionalTrustVisual.neverOnMainImage,
                  ],
                  [
                    "USA flag allowed only if verified",
                    optionalTrustVisual.signals.usaFlag.verified,
                  ],
                  [
                    "mustNotImplyMadeInUsa",
                    optionalTrustVisual.signals.usaFlag.mustNotImplyMadeInUsa,
                  ],
                ]}
              />
            </div>
          </div>
        </Section>

        <Section title="Pack Strategy">
          <p className="mb-5 text-sm leading-7 text-white/60">
            {listingPackage.postConversionPackStrategy.strategyStatus}. Pack listings only after conversion data, Terapeak validation, and demand evidence.
          </p>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {listingPackage.postConversionPackStrategy.recommendedPackOptions.map((pack) => (
              <div
                key={pack.packSize}
                className="rounded-2xl border border-white/10 bg-black/20 p-4"
              >
                <h3 className="text-sm font-black text-white">
                  pack x{pack.packSize}
                </h3>
                <p className="mt-2 text-sm text-cyan-100">
                  {pack.status}
                </p>
                <p className="mt-3 text-sm leading-6 text-white/65">
                  {pack.purpose}
                </p>
                <p className="mt-3 text-sm font-bold text-amber-100">
                  requiresMarginValidation {formatValue(pack.requiresMarginValidation)}
                </p>
              </div>
            ))}
          </div>
          <div className="mt-6">
            <h3 className="text-sm font-black text-white">
              Luna Portex Pack Fulfillment Review
            </h3>
            <div className="mt-3">
              <FieldGrid
                fields={[
                  [
                    "status",
                    listingPackage.lunaPortexPackFulfillmentReview.status,
                  ],
                  [
                    "requiredBeforePackListing",
                    listingPackage.lunaPortexPackFulfillmentReview.requiredBeforePackListing,
                  ],
                  [
                    "marginRule",
                    listingPackage.lunaPortexPackFulfillmentReview.marginRule,
                  ],
                ]}
              />
            </div>
          </div>
        </Section>

        <Section id="qa-details" title="QA Details">
          <div className="grid gap-5">
            <div>
              <h3 className="text-sm font-black text-white">
                QA Review
              </h3>
              <div className="mt-3">
                <FieldGrid
                  fields={[
                    [
                      "qaStatus",
                      qaReview.qaStatus,
                    ],
                    [
                      "publicationRecommendation",
                      qaReview.publicationRecommendation,
                    ],
                    [
                      "draftRecommendation",
                      qaReview.draftRecommendation,
                    ],
                    [
                      "overallDecision",
                      qaReview.overallDecision,
                    ],
                    [
                      "decisionSummary",
                      qaReview.decisionSummary,
                    ],
                  ]}
                />
              </div>
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              <div>
                <h3 className="text-sm font-black text-white">
                  Blocking Reasons
                </h3>
                <div className="mt-3">
                  <ListBlock items={qaReview.blockingReasons} />
                </div>
              </div>
              <div>
                <h3 className="text-sm font-black text-white">
                  Missing Data
                </h3>
                <div className="mt-3">
                  <ListBlock items={qaReview.missingData} />
                </div>
              </div>
              <div>
                <h3 className="text-sm font-black text-white">
                  Pre-Draft Checklist
                </h3>
                <div className="mt-3">
                  <ListBlock items={qaReview.preDraftChecklist} />
                </div>
              </div>
              <div>
                <h3 className="text-sm font-black text-white">
                  Pre-Publish Checklist
                </h3>
                <div className="mt-3">
                  <ListBlock items={qaReview.prePublishChecklist} />
                </div>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              {Object.entries(qaReview.sectionReviews).map(([key, review]) => (
                <article
                  key={key}
                  className="rounded-2xl border border-white/10 bg-black/20 p-4"
                >
                  <h3 className="text-sm font-black text-white">
                    {key}
                  </h3>
                  <p className="mt-2 text-sm font-bold text-amber-100">
                    {review.status}
                  </p>
                  <ul className="mt-3 space-y-2 text-sm leading-6 text-white/65">
                    {review.checks.map((check) => (
                      <li key={check}>
                        {check}
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </div>
        </Section>

        <Section title="System Safety / Audit">
          <div className="grid gap-5">
            <div>
              <h3 className="text-sm font-black text-white">
                Technical status markers
              </h3>
              <div className="mt-4 flex flex-wrap gap-2">
                {statusMarkers.map((marker) => (
                  <span
                    key={marker}
                    className="rounded-full border border-white/10 bg-black/25 px-3 py-2 text-xs font-semibold text-white/70"
                  >
                    {marker}
                  </span>
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-black text-white">
                Safety Flags
              </h3>
              <div className="mt-3">
                <FieldGrid
                  fields={Object.entries(qaReview.safetyFlags)}
                />
              </div>
            </div>

            <div>
              <h3 className="text-sm font-black text-white">
                Disabled Actions
              </h3>
              <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {disabledActions.map((action) => (
                  <button
                    key={action.label}
                    type="button"
                    disabled
                    className="min-w-0 cursor-not-allowed break-words rounded-2xl border border-red-200/10 bg-black/20 px-4 py-3 text-left text-sm leading-6 text-red-50/70 [overflow-wrap:anywhere]"
                  >
                    <span className="block font-black">
                      {action.label}
                    </span>
                    <span className="mt-2 block leading-6 text-red-50/55">
                      {action.reason}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </Section>
      </div>
    </main>
  )
}

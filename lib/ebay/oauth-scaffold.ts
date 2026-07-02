export const EBAY_OAUTH_SCAFFOLD_DISABLED =
  "EBAY_OAUTH_SCAFFOLD_DISABLED"

export const EBAY_OAUTH_START_BLOCKED =
  "EBAY_OAUTH_START_BLOCKED"

export const EBAY_OAUTH_CALLBACK_BLOCKED =
  "EBAY_OAUTH_CALLBACK_BLOCKED"

export function getEbaySandboxOauthScaffoldStatus() {
  return {
    ok: false,
    blocked: true,
    code:
      EBAY_OAUTH_SCAFFOLD_DISABLED,
    message:
      "Sandbox OAuth scaffold exists but is disabled.",
    scaffoldStatus:
      "OAUTH_SCAFFOLD_READY_BUT_DISABLED",
    scaffoldDecision:
      "SCAFFOLD_ONLY_DO_NOT_START_OAUTH",
    implementationMode:
      "DISABLED_STUBS_ONLY",
    routeStatus:
      "STUB_ROUTES_BLOCKED",
    authUrlGenerated:
      false,
    callbackProcessingEnabled:
      false,
    environmentVariablesRead:
      false,
    credentialsIncluded:
      false,
    tokenExchangeImplemented:
      false,
    tokenStorageImplemented:
      false,
    ebayApiUsed:
      false,
  }
}

export function getBlockedOauthStartResponse() {
  return {
    ok: false,
    blocked: true,
    code:
      EBAY_OAUTH_START_BLOCKED,
    message:
      "OAuth start is blocked because sandbox credentials, redirect validation and secret strategy are not approved.",
    authUrlGenerated:
      false,
    authRedirectPerformed:
      false,
    environmentVariablesRead:
      false,
    credentialsIncluded:
      false,
    ebayApiUsed:
      false,
  }
}

export function getBlockedOauthCallbackResponse() {
  return {
    ok: false,
    blocked: true,
    code:
      EBAY_OAUTH_CALLBACK_BLOCKED,
    message:
      "OAuth callback handling is blocked. Authorization codes are not processed in this scaffold.",
    callbackProcessingEnabled:
      false,
    authorizationCodeProcessed:
      false,
    tokenExchangeImplemented:
      false,
    tokenStorageImplemented:
      false,
    ebayApiUsed:
      false,
  }
}

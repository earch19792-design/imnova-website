import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import {
  EBAY_READONLY_CLI_CONFIRMATION_PHRASE,
  EBAY_READONLY_OAUTH_APPROVAL_PHRASE,
  EBAY_READONLY_SCOPES,
  buildEbaySellerReadOnlyOauthDataAuditReport,
  getEbayReadOnlyEndpointAllowlist,
} from "../lib/ebay/ebay-seller-readonly-oauth-data-audit.ts";

const environments =
  {
    PRODUCTION:
      {
        authUrl:
          "https://auth.ebay.com/oauth2/authorize",
        tokenUrl:
          "https://api.ebay.com/identity/v1/oauth2/token",
        apiBaseUrl:
          "https://api.ebay.com",
      },
    SANDBOX:
      {
        authUrl:
          "https://auth.sandbox.ebay.com/oauth2/authorize",
        tokenUrl:
          "https://api.sandbox.ebay.com/identity/v1/oauth2/token",
        apiBaseUrl:
          "https://api.sandbox.ebay.com",
      },
  };

function hasArg(name) {
  return process.argv.includes(name);
}

function redact(value) {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }

  return value.length <= 4
    ? "***"
    : `${value.slice(0, 4)}...REDACTED`;
}

function printSafeReport(report) {
  console.log(
    JSON.stringify(
      {
        ...report,
        accessToken:
          undefined,
        refreshToken:
          undefined,
        clientSecret:
          undefined,
        authorizationCode:
          undefined,
      },
      null,
      2,
    ),
  );
}

function buildAuthorizationUrl(config, state) {
  const url =
    new URL(config.environment.authUrl);

  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", EBAY_READONLY_SCOPES.join(" "));
  url.searchParams.set("state", state);

  return url.toString();
}

function validateRuntimeGate() {
  const envName =
    process.env.EBAY_OAUTH_ENV?.trim().toUpperCase() ?? "";
  const environment =
    envName === "PRODUCTION" || envName === "SANDBOX"
      ? environments[envName]
      : null;
  const clientId =
    process.env.EBAY_CLIENT_ID?.trim() ?? "";
  const clientSecret =
    process.env.EBAY_CLIENT_SECRET?.trim() ?? "";
  const redirectUri =
    process.env.EBAY_REDIRECT_URI?.trim() ?? "";
  const approval =
    process.env.EBAY_READONLY_AUDIT_APPROVED?.trim() ?? "";
  const errors =
    [
      approval !== EBAY_READONLY_OAUTH_APPROVAL_PHRASE ? "missing exact EBAY_READONLY_AUDIT_APPROVED approval" : "",
      environment === null ? "EBAY_OAUTH_ENV must be PRODUCTION or SANDBOX" : "",
      clientId.length === 0 ? "missing EBAY_CLIENT_ID" : "",
      clientSecret.length === 0 ? "missing EBAY_CLIENT_SECRET" : "",
      redirectUri.length === 0 ? "missing EBAY_REDIRECT_URI" : "",
    ].filter(Boolean);

  return {
    ready:
      errors.length === 0,
    errors,
    config:
      environment === null
        ? null
        : {
          envName,
          environment,
          clientId,
          clientSecret,
          redirectUri,
        },
  };
}

async function askForExactConfirmation() {
  const rl =
    createInterface({ input, output });

  try {
    const answer =
      await rl.question("Type READ_ONLY_AUDIT_APPROVED to continue: ");

    return answer.trim() === EBAY_READONLY_CLI_CONFIRMATION_PHRASE;
  } finally {
    rl.close();
  }
}

async function askForAuthorizationCode() {
  const rl =
    createInterface({ input, output });

  try {
    const answer =
      await rl.question("Paste the authorization code from eBay: ");

    return answer.trim();
  } finally {
    rl.close();
  }
}

async function exchangeAuthorizationCode(config, authorizationCode) {
  const body =
    new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("code", authorizationCode);
  body.set("redirect_uri", config.redirectUri);

  const credentials =
    Buffer["from"](`${config.clientId}:${config.clientSecret}`).toString("base64");
  const response =
    await fetch(
      config.environment.tokenUrl,
      {
        method:
          "POST",
        headers:
          {
            "Content-Type":
              "application/x-www-form-urlencoded",
            Authorization:
              `Basic ${credentials}`,
          },
        body,
      },
    );
  const payload =
    await response.json();

  return {
    ok:
      response.ok,
    accessToken:
      typeof payload.access_token === "string"
        ? payload.access_token
        : null,
    refreshTokenReceived:
      typeof payload.refresh_token === "string" && payload.refresh_token.length > 0,
    expiresInPresent:
      typeof payload.expires_in === "number",
    error:
      response.ok
        ? null
        : payload.error_description ?? payload.error ?? "token exchange failed",
  };
}

async function readOnlyGetJson(config, accessToken, endpoint) {
  if (endpoint.method !== "GET") {
    return {
      available:
        false,
      count:
        0,
      error:
        "non-GET endpoint blocked",
    };
  }

  const url =
    new URL(endpoint.path, config.environment.apiBaseUrl);

  if (endpoint.key !== "inventoryLocations") {
    url.searchParams.set("marketplace_id", "EBAY_US");
  }

  const response =
    await fetch(
      url.toString(),
      {
        method:
          "GET",
        headers:
          {
            Authorization:
              `Bearer ${accessToken}`,
            "Content-Type":
              "application/json",
          },
      },
    );

  if (!response.ok) {
    return {
      available:
        false,
      count:
        0,
      error:
        `read-only endpoint unavailable_or_scope_missing: ${response.status}`,
    };
  }

  const data =
    await response.json();
  const count =
    Array.isArray(data[endpoint.key])
      ? data[endpoint.key].length
      : Array.isArray(data.locations)
        ? data.locations.length
        : Array.isArray(data)
          ? data.length
          : 0;

  return {
    available:
      true,
    count,
    error:
      null,
  };
}

async function runRealAudit() {
  const runtimeGate =
    validateRuntimeGate();

  if (!runtimeGate.ready || runtimeGate.config === null) {
    printSafeReport({
      mode:
        "safe-blocked",
      oauthAuthorizationSucceeded:
        false,
      realTokenExchangeExecuted:
        false,
      ebayReadOnlyApiUsed:
        false,
      ebayWriteApiUsed:
        false,
      accessTokenStored:
        false,
      refreshTokenStored:
        false,
      clientSecretStored:
        false,
      tokensPrinted:
        false,
      errors:
        runtimeGate.errors,
    });
    return;
  }

  const confirmed =
    await askForExactConfirmation();

  if (!confirmed) {
    printSafeReport({
      mode:
        "safe-blocked",
      oauthAuthorizationSucceeded:
        false,
      realTokenExchangeExecuted:
        false,
      ebayReadOnlyApiUsed:
        false,
      ebayWriteApiUsed:
        false,
      accessTokenStored:
        false,
      refreshTokenStored:
        false,
      clientSecretStored:
        false,
      tokensPrinted:
        false,
      errors:
        ["missing exact CLI confirmation"],
    });
    return;
  }

  const state =
    `imnova-readonly-audit-${Date.now()}`;
  const authorizationUrl =
    buildAuthorizationUrl(runtimeGate.config, state);

  printSafeReport({
    mode:
      "authorization-url",
    authorizationUrl,
    scopes:
      EBAY_READONLY_SCOPES,
    secretsPrinted:
      false,
    clientIdPreview:
      redact(runtimeGate.config.clientId),
  });

  const authorizationCode =
    await askForAuthorizationCode();

  if (authorizationCode.length === 0) {
    printSafeReport({
      mode:
        "safe-blocked",
      oauthAuthorizationSucceeded:
        false,
      realTokenExchangeExecuted:
        false,
      ebayReadOnlyApiUsed:
        false,
      ebayWriteApiUsed:
        false,
      accessTokenStored:
        false,
      refreshTokenStored:
        false,
      clientSecretStored:
        false,
      tokensPrinted:
        false,
      errors:
        ["missing authorization code"],
    });
    return;
  }

  const tokenResult =
    await exchangeAuthorizationCode(runtimeGate.config, authorizationCode);

  if (!tokenResult.ok || tokenResult.accessToken === null) {
    printSafeReport({
      mode:
        "readonly-audit",
      oauthAuthorizationSucceeded:
        false,
      realTokenExchangeExecuted:
        tokenResult.ok,
      ebayReadOnlyApiUsed:
        false,
      ebayWriteApiUsed:
        false,
      accessTokenStored:
        false,
      refreshTokenStored:
        false,
      clientSecretStored:
        false,
      tokensPrinted:
        false,
      errors:
        [tokenResult.error ?? "token exchange failed"],
    });
    return;
  }

  const endpointResults =
    {};

  for (const endpoint of getEbayReadOnlyEndpointAllowlist()) {
    endpointResults[endpoint.key] =
      await readOnlyGetJson(runtimeGate.config, tokenResult.accessToken, endpoint);
  }

  const report =
    buildEbaySellerReadOnlyOauthDataAuditReport({
      developerAccountCreated:
        "confirmed",
      developerApplicationCreated:
        "confirmed",
      productionKeysAvailable:
        runtimeGate.config.envName === "PRODUCTION" ? "available" : "unknown",
      sandboxKeysAvailable:
        runtimeGate.config.envName === "SANDBOX" ? "available" : "unknown",
      redirectUriConfigured:
        "configured",
      sellerPersonalAccountCreated:
        "confirmed",
      sellerHubAccessible:
        "confirmed",
      humanApprovalForReadOnlyOauthAudit:
        true,
      sellerAuthorizationStatus:
        "confirmed",
      oauthEnvironment:
        runtimeGate.config.envName,
      requestedScopes:
        EBAY_READONLY_SCOPES,
      oauthAuthorizationSucceeded:
        true,
      fulfillmentPoliciesCount:
        endpointResults.fulfillmentPolicies?.count ?? 0,
      returnPoliciesCount:
        endpointResults.returnPolicies?.count ?? 0,
      paymentPoliciesCount:
        endpointResults.paymentPolicies?.count ?? 0,
      inventoryLocationsCount:
        endpointResults.inventoryLocations?.count ?? 0,
      accountRiskStatus:
        "unknown",
      manualSellerHubDataStatus:
        "unknown",
    });

  printSafeReport({
    mode:
      "readonly-audit",
    oauthAuthorizationSucceeded:
      true,
    businessPoliciesReadable:
      report.businessPoliciesReadable,
    fulfillmentPoliciesCount:
      report.fulfillmentPoliciesCount,
    returnPoliciesCount:
      report.returnPoliciesCount,
    paymentPoliciesCount:
      report.paymentPoliciesCount,
    inventoryLocationsCount:
      report.inventoryLocationsCount,
    missingPolicyTypes:
      report.missingPolicyTypes,
    missingManualSellerHubData:
      report.missingManualSellerHubData,
    nextRecommendedRoute:
      report.nextRecommendedRoute,
    realTokenExchangeExecuted:
      true,
    ebayReadOnlyApiUsed:
      true,
    ebayWriteApiUsed:
      false,
    accessTokenStored:
      false,
    refreshTokenStored:
      false,
    clientSecretStored:
      false,
    tokensPrinted:
      false,
    draftCreated:
      false,
    listingCreated:
      false,
    publicationExecuted:
      false,
    refreshTokenReceivedDiscarded:
      tokenResult.refreshTokenReceived,
    endpointAvailability:
      Object.fromEntries(
        Object.entries(endpointResults).map(([key, value]) => [
          key,
          {
            available:
              value.available,
            count:
              value.count,
            error:
              value.error,
          },
        ]),
      ),
  });
}

async function run() {
  if (!hasArg("--execute-readonly-audit")) {
    printSafeReport({
      mode:
        "safe-default",
      instructions:
        [
          "No OAuth real token exchange was executed.",
          "No eBay API call was executed.",
          "To run the gated audit, pass --execute-readonly-audit and set the required local environment variables.",
          "Required variables: EBAY_READONLY_AUDIT_APPROVED, EBAY_OAUTH_ENV, EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, EBAY_REDIRECT_URI.",
          "The runner will still require exact CLI confirmation before token exchange.",
        ],
      realTokenExchangeExecuted:
        false,
      ebayReadOnlyApiUsed:
        false,
      ebayWriteApiUsed:
        false,
      accessTokenStored:
        false,
      refreshTokenStored:
        false,
      clientSecretStored:
        false,
      tokensPrinted:
        false,
      draftCreated:
        false,
      listingCreated:
        false,
      publicationExecuted:
        false,
    });
    return;
  }

  await runRealAudit();
}

run().catch(error => {
  printSafeReport({
    mode:
      "error",
    realTokenExchangeExecuted:
      false,
    ebayReadOnlyApiUsed:
      false,
    ebayWriteApiUsed:
      false,
    accessTokenStored:
      false,
    refreshTokenStored:
      false,
    clientSecretStored:
      false,
    tokensPrinted:
      false,
    errors:
      [error instanceof Error ? error.message : "unknown read-only audit runner error"],
  });
});

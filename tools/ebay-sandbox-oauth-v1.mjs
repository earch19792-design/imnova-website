import { chmodSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  EBAY_SANDBOX_TOKEN_URL,
  buildEbaySandboxAuthorizationUrl,
  buildEbaySandboxOAuthConfig,
  buildEbaySandboxTokenExchangeRequest,
  parseEbaySandboxCallback,
  sanitizeEbayOAuthReport,
  summarizeEbaySandboxOAuthReadiness,
} from "../lib/ebay/ebay-sandbox-oauth.ts";

const approvalPhrase =
  "APPROVE_LOOP_148_EBAY_SANDBOX_OAUTH";

function hasArg(name) {
  return process.argv.includes(name);
}

function getArgValue(name) {
  const index =
    process.argv.indexOf(name);

  return index >= 0
    ? process.argv[index + 1] ?? null
    : null;
}

function readEnvConfig() {
  return buildEbaySandboxOAuthConfig({
    targetEnv:
      process.env.EBAY_OAUTH_TARGET_ENV,
    clientId:
      process.env.EBAY_SANDBOX_CLIENT_ID,
    clientSecret:
      process.env.EBAY_SANDBOX_CLIENT_SECRET,
    runame:
      process.env.EBAY_SANDBOX_RUNAME,
    scopes:
      process.env.EBAY_SANDBOX_SCOPES,
    approval:
      process.env.EBAY_SANDBOX_OAUTH_APPROVED,
    authCode:
      process.env.EBAY_SANDBOX_AUTH_CODE,
    callbackUrl:
      process.env.EBAY_SANDBOX_CALLBACK_URL,
  });
}

function buildDryRunConfig() {
  return buildEbaySandboxOAuthConfig({
    targetEnv:
      "sandbox",
    clientId:
      "SANDBOX_CLIENT_ID_SAMPLE",
    runame:
      "SANDBOX_RUNAME_SAMPLE",
    approval:
      approvalPhrase,
  });
}

function isSafeTmpPath(path) {
  if (typeof path !== "string" || path.trim().length === 0) {
    return false;
  }

  return resolve(path).startsWith("/tmp/");
}

function writeTokenFileIfAllowed(path, tokenPayload) {
  if (!isSafeTmpPath(path)) {
    return {
      tokenStored:
        false,
      tokenOutputPathSafe:
        false,
      error:
        "token output file must be under /tmp",
    };
  }

  writeFileSync(
    path,
    JSON.stringify(tokenPayload, null, 2),
    {
      mode:
        0o600,
    },
  );

  try {
    chmodSync(path, 0o600);
  } catch {
    // Best-effort only; file mode is already requested at write time.
  }

  return {
    tokenStored:
      true,
    tokenOutputPathSafe:
      true,
  };
}

function printReport(report) {
  console.log(
    JSON.stringify(
      sanitizeEbayOAuthReport(report),
      null,
      2,
    ),
  );
}

async function run() {
  const buildAuthUrlMode =
    hasArg("--build-auth-url");
  const parseCallbackMode =
    hasArg("--parse-callback");
  const exchangeTokenMode =
    hasArg("--exchange-token");
  const tokenOutputFile =
    getArgValue("--token-output-file");

  if (!buildAuthUrlMode && !parseCallbackMode && !exchangeTokenMode) {
    const config =
      buildDryRunConfig();
    const authUrl =
      buildEbaySandboxAuthorizationUrl(config);
    const summary =
      summarizeEbaySandboxOAuthReadiness({
        sandboxAuthUrlReady:
          authUrl.authUrlBuilt,
        tokenExchangeExecuted:
          false,
        tokenStored:
          false,
        productionBlocked:
          true,
        draftCreated:
          false,
        publicationCreated:
          false,
        stagingWriteExecuted:
          false,
        ebayProductionUsed:
          false,
        ebaySandboxReady:
          true,
        errors:
          authUrl.errors,
        warnings:
          authUrl.warnings,
      });

    printReport({
      mode:
        "dry-run",
      ...summary,
    });
    return;
  }

  const config =
    readEnvConfig();

  if (buildAuthUrlMode) {
    const authUrl =
      buildEbaySandboxAuthorizationUrl(config, {
        requireApproval:
          true,
      });

    printReport({
      mode:
        "build-auth-url",
      authUrlBuilt:
        authUrl.authUrlBuilt,
      sandboxEndpoint:
        authUrl.sandboxEndpoint,
      authorizationUrl:
        authUrl.authorizationUrl,
      scopesCount:
        authUrl.scopes?.length ?? 0,
      secretsPrinted:
        false,
      productionBlocked:
        true,
      errors:
        authUrl.errors,
      warnings:
        authUrl.warnings,
    });
    return;
  }

  const callback =
    parseEbaySandboxCallback({
      callbackUrl:
        config.callbackUrl,
      authCode:
        config.authCode,
      state:
        config.state,
    });

  if (parseCallbackMode) {
    printReport({
      mode:
        "parse-callback",
      callbackParsed:
        callback.callbackParsed,
      authCodePresent:
        callback.authCodePresent,
      authCode:
        callback.authCodeRedacted,
      state:
        callback.stateRedacted,
      tokenExchangeExecuted:
        false,
      productionBlocked:
        true,
      errors:
        callback.errors,
    });
    return;
  }

  if (exchangeTokenMode) {
    const exchangeRequest =
      buildEbaySandboxTokenExchangeRequest(config, callback, {
        requireApproval:
          true,
        requireClientSecret:
          true,
        requireAuthCode:
          true,
      });

    if (!exchangeRequest.tokenExchangeReady) {
      printReport({
        mode:
          "exchange-token",
        tokenExchangeExecuted:
          false,
        accessTokenReceived:
          false,
        refreshTokenReceived:
          false,
        tokenStored:
          false,
        tokenOutputPathSafe:
          tokenOutputFile === null ? null : isSafeTmpPath(tokenOutputFile),
        productionBlocked:
          true,
        sandboxEndpoint:
          exchangeRequest.sandboxEndpoint,
        semaphore:
          "YELLOW",
        errors:
          exchangeRequest.errors,
        warnings:
          exchangeRequest.warnings,
      });
      return;
    }

    if (config.tokenUrl !== EBAY_SANDBOX_TOKEN_URL) {
      printReport({
        mode:
          "exchange-token",
        tokenExchangeExecuted:
          false,
        productionBlocked:
          true,
        sandboxEndpoint:
          false,
        semaphore:
          "RED",
        errors:
          ["token endpoint is not Sandbox"],
      });
      return;
    }

    const credentials =
      Buffer["from"](`${config.clientId}:${config.clientSecret}`).toString("base64");
    const response =
      await fetch(config.tokenUrl, {
        method:
          "POST",
        headers:
          {
            "Content-Type":
              "application/x-www-form-urlencoded",
            Authorization:
              `Basic ${credentials}`,
          },
        body:
          exchangeRequest.requestBody,
      });
    const tokenPayload =
      await response.json();
    const accessTokenReceived =
      typeof tokenPayload.access_token === "string" && tokenPayload.access_token.length > 0;
    const refreshTokenReceived =
      typeof tokenPayload.refresh_token === "string" && tokenPayload.refresh_token.length > 0;
    let storageResult =
      {
        tokenStored:
          false,
        tokenOutputPathSafe:
          tokenOutputFile === null ? null : isSafeTmpPath(tokenOutputFile),
      };

    if (tokenOutputFile !== null && response.ok) {
      storageResult =
        writeTokenFileIfAllowed(tokenOutputFile, tokenPayload);
    }

    printReport({
      mode:
        "exchange-token",
      tokenExchangeExecuted:
        response.ok,
      accessTokenReceived,
      refreshTokenReceived,
      expiresInPresent:
        typeof tokenPayload.expires_in === "number",
      refreshTokenExpiresInPresent:
        typeof tokenPayload.refresh_token_expires_in === "number",
      scopesReceived:
        typeof tokenPayload.scope === "string"
          ? tokenPayload.scope.split(" ").filter(Boolean).length
          : 0,
      tokenStored:
        storageResult.tokenStored,
      tokenOutputPathSafe:
        storageResult.tokenOutputPathSafe,
      secretsPrinted:
        false,
      productionBlocked:
        true,
      draftCreated:
        false,
      publicationCreated:
        false,
      stagingWriteExecuted:
        false,
      semaphore:
        response.ok ? "GREEN" : "RED",
      errors:
        response.ok ? [] : [tokenPayload.error_description ?? tokenPayload.error ?? "sandbox token exchange failed"],
    });
  }
}

run().catch(error => {
  printReport({
    mode:
      "error",
    tokenExchangeExecuted:
      false,
    productionBlocked:
      true,
    semaphore:
      "RED",
    errors:
      [error instanceof Error ? error.message : "unknown OAuth CLI error"],
  });
});

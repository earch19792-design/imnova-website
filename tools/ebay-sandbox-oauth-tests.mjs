import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";

const fixturePath =
  "tools/fixtures/ebay-sandbox-oauth-v1.json";
const modulePath =
  "lib/ebay/ebay-sandbox-oauth.ts";
const cliPath =
  "tools/ebay-sandbox-oauth-v1.mjs";
const routeModulePath =
  "lib/ebay/ebay-pro-official-route.ts";
const docPath =
  "docs/ebay-pro-isolation/EBAY_SANDBOX_OAUTH_V1.md";

function readText(path) {
  return readFileSync(path, "utf8");
}

function readJson(path) {
  return JSON.parse(readText(path));
}

function fileExists(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

const fixture =
  readJson(fixturePath);

function buildSampleConfig(module, overrides = {}) {
  return module.buildEbaySandboxOAuthConfig({
    targetEnv:
      "sandbox",
    clientId:
      "SANDBOX_CLIENT_ID_SAMPLE",
    clientSecret:
      "SANDBOX_CLIENT_SECRET_SAMPLE",
    runame:
      "SANDBOX_RUNAME_SAMPLE",
    approval:
      "APPROVE_LOOP_148_EBAY_SANDBOX_OAUTH",
    authCode:
      "SAMPLE_AUTH_CODE_SHOULD_BE_REDACTED",
    ...overrides,
  });
}

test("OAuth fixture locks LOOP 148 boundaries", () => {
  assert.equal(fixture.oauthVersion, "EBAY_SANDBOX_OAUTH_V1");
  assert.equal(fixture.status, "EBAY_SANDBOX_OAUTH_READY");
  assert.equal(fixture.production.offLimits, true);
  assert.equal(fixture.ebayProduction.usedInThisLoop, false);
  assert.equal(fixture.ebaySandbox.usedInThisLoop, true);
  assert.equal(fixture.staging.writeExecutedInThisLoop, false);
  assert.equal(fixture.oauth.sandboxIncluded, true);
  assert.equal(fixture.oauth.productionBlocked, true);
  assert.equal(fixture.oauth.tokenExchangeDefault, false);
  assert.equal(fixture.oauth.tokenStorageDefault, false);
  assert.equal(fixture.listingDraft.createdInThisLoop, false);
  assert.equal(fixture.publication.createdInThisLoop, false);
});

test("Sandbox endpoints are fixed and Production endpoints are exported only for blocking", async () => {
  const module =
    await import(`../${modulePath}`);

  assert.equal(module.EBAY_SANDBOX_AUTH_URL, "https://auth.sandbox.ebay.com/oauth2/authorize");
  assert.equal(module.EBAY_SANDBOX_TOKEN_URL, "https://api.sandbox.ebay.com/identity/v1/oauth2/token");
  assert.equal(module.EBAY_PRODUCTION_AUTH_URL, "https://auth.ebay.com/oauth2/authorize");
  assert.equal(module.EBAY_PRODUCTION_TOKEN_URL, "https://api.ebay.com/identity/v1/oauth2/token");

  const config =
    buildSampleConfig(module, {
      authCode:
        null,
    });
  const validation =
    module.validateEbaySandboxOAuthConfig(config);

  assert.equal(validation.valid, true);
  assert.equal(validation.sandboxEndpoint, true);
});

test("authorization URL uses Sandbox and includes OAuth parameters", async () => {
  const module =
    await import(`../${modulePath}`);
  const config =
    buildSampleConfig(module, {
      clientSecret:
        null,
      authCode:
        null,
      scopes:
        ["scope-one", "scope-two"],
    });
  const auth =
    module.buildEbaySandboxAuthorizationUrl(config);

  assert.equal(auth.authUrlBuilt, true);
  assert.equal(auth.authorizationUrl.startsWith("https://auth.sandbox.ebay.com/oauth2/authorize"), true);

  const url =
    new URL(auth.authorizationUrl);

  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("client_id"), "SANDBOX_CLIENT_ID_SAMPLE");
  assert.equal(url.searchParams.get("redirect_uri"), "SANDBOX_RUNAME_SAMPLE");
  assert.equal(url.searchParams.get("scope"), "scope-one scope-two");
});

test("auth URL does not require client secret", async () => {
  const module =
    await import(`../${modulePath}`);
  const config =
    buildSampleConfig(module, {
      clientSecret:
        null,
      authCode:
        null,
    });
  const auth =
    module.buildEbaySandboxAuthorizationUrl(config);

  assert.equal(auth.authUrlBuilt, true);
});

test("token exchange requires client secret approval target env and auth code", async () => {
  const module =
    await import(`../${modulePath}`);
  const missingSecret =
    buildSampleConfig(module, {
      clientSecret:
        null,
    });
  const callback =
    module.parseEbaySandboxCallback({
      authCode:
        "SAMPLE_AUTH_CODE_SHOULD_BE_REDACTED",
    });

  assert.equal(module.buildEbaySandboxTokenExchangeRequest(missingSecret, callback).tokenExchangeReady, false);
  assert.equal(module.buildEbaySandboxTokenExchangeRequest(buildSampleConfig(module, { approval: "WRONG" }), callback).tokenExchangeReady, false);
  assert.equal(module.buildEbaySandboxTokenExchangeRequest(buildSampleConfig(module, { targetEnv: "production" }), callback).tokenExchangeReady, false);
  assert.equal(module.buildEbaySandboxTokenExchangeRequest(buildSampleConfig(module), module.parseEbaySandboxCallback({})).tokenExchangeReady, false);
});

test("Production endpoints are blocked", async () => {
  const module =
    await import(`../${modulePath}`);
  const config =
    module.buildEbaySandboxOAuthConfig(
      {
        targetEnv:
          "sandbox",
        clientId:
          "SANDBOX_CLIENT_ID_SAMPLE",
        clientSecret:
          "SANDBOX_CLIENT_SECRET_SAMPLE",
        runame:
          "SANDBOX_RUNAME_SAMPLE",
        approval:
          "APPROVE_LOOP_148_EBAY_SANDBOX_OAUTH",
      },
      {
        authUrl:
          module.EBAY_PRODUCTION_AUTH_URL,
        tokenUrl:
          module.EBAY_PRODUCTION_TOKEN_URL,
      },
    );
  const validation =
    module.validateEbaySandboxOAuthConfig(config, {
      requireClientSecret:
        true,
    });

  assert.equal(validation.valid, false);
  assert.equal(validation.errors.includes("production OAuth endpoint is blocked"), true);
});

test("callback parser redacts auth code and state", async () => {
  const module =
    await import(`../${modulePath}`);
  const callback =
    module.parseEbaySandboxCallback({
      callbackUrl:
        "https://example.test/callback?code=VERY_LONG_AUTH_CODE_VALUE&state=STATE_VALUE",
    });

  assert.equal(callback.callbackParsed, true);
  assert.equal(callback.authCodePresent, true);
  assert.equal(callback.authCode, "VERY_LONG_AUTH_CODE_VALUE");
  assert.notEqual(callback.authCodeRedacted, callback.authCode);
  assert.notEqual(callback.stateRedacted, callback.state);
});

test("sanitizer does not expose secret code or tokens", async () => {
  const module =
    await import(`../${modulePath}`);
  const sanitized =
    module.sanitizeEbayOAuthReport({
      clientSecret:
        "SECRET_SHOULD_NOT_PRINT",
      authCode:
        "AUTH_CODE_SHOULD_NOT_PRINT",
      accessToken:
        "ACCESS_TOKEN_SHOULD_NOT_PRINT",
      refreshToken:
        "REFRESH_TOKEN_SHOULD_NOT_PRINT",
      safe:
        "visible",
    });
  const output =
    JSON.stringify(sanitized);

  assert.equal(output.includes("SECRET_SHOULD_NOT_PRINT"), false);
  assert.equal(output.includes("AUTH_CODE_SHOULD_NOT_PRINT"), false);
  assert.equal(output.includes("ACCESS_TOKEN_SHOULD_NOT_PRINT"), false);
  assert.equal(output.includes("REFRESH_TOKEN_SHOULD_NOT_PRINT"), false);
  assert.equal(sanitized.safe, "visible");
});

test("optional token output path allows only /tmp", () => {
  const cliSource =
    readText(cliPath);

  assert.equal(cliSource.includes("startsWith(\"/tmp/\")"), true);
  assert.equal(cliSource.includes("token output file must be under /tmp"), true);
});

test("CLI dry-run executes and reports safe defaults", () => {
  const originalLog =
    console.log;
  let output =
    "";

  console.log =
    value => {
      output += String(value);
    };

  return import(`../${cliPath}?dryRunTest=${Date.now()}`)
    .then(() => {
      console.log =
        originalLog;
      const parsed =
        JSON.parse(output);

      assert.equal(parsed.mode, "dry-run");
      assert.equal(parsed.sandboxAuthUrlReady, true);
      assert.equal(parsed.tokenExchangeExecuted, false);
      assert.equal(parsed.tokenStored, false);
      assert.equal(parsed.productionBlocked, true);
      assert.equal(parsed.draftCreated, false);
      assert.equal(parsed.publicationCreated, false);
      assert.equal(parsed.nextLoop, "149");
    })
    .finally(() => {
      console.log =
        originalLog;
    });
});

test("CLI auth URL mode can run with safe sample env", () => {
  const originalLog =
    console.log;
  const originalEnv =
    { ...process.env };
  let output =
    "";

  process.argv =
    ["node", cliPath, "--build-auth-url"];
  process.env.EBAY_OAUTH_TARGET_ENV =
    "sandbox";
  process.env.EBAY_SANDBOX_CLIENT_ID =
    "SANDBOX_CLIENT_ID_SAMPLE";
  process.env.EBAY_SANDBOX_RUNAME =
    "SANDBOX_RUNAME_SAMPLE";
  process.env.EBAY_SANDBOX_OAUTH_APPROVED =
    "APPROVE_LOOP_148_EBAY_SANDBOX_OAUTH";
  console.log =
    value => {
      output += String(value);
    };

  return import(`../${cliPath}?authUrlTest=${Date.now()}`)
    .then(() => {
      console.log =
        originalLog;
      process.env =
        originalEnv;
      const parsed =
        JSON.parse(output);

      assert.equal(parsed.mode, "build-auth-url");
      assert.equal(parsed.authUrlBuilt, true);
      assert.equal(parsed.sandboxEndpoint, true);
      assert.equal(parsed.scopesCount >= 1, true);
      assert.equal(parsed.secretsPrinted, false);
      assert.equal(parsed.authorizationUrl.includes("auth.sandbox.ebay.com"), true);
    })
    .finally(() => {
      console.log =
        originalLog;
      process.env =
        originalEnv;
    });
});

test("module stays pure while CLI owns env and fetch", () => {
  const moduleSource =
    readText(modulePath);
  const cliSource =
    readText(cliPath);

  assert.equal(moduleSource.includes("process.env"), false);
  assert.equal(moduleSource.includes("fetch("), false);
  assert.equal(moduleSource.includes("createClient"), false);
  assert.equal(moduleSource.includes(".from("), false);
  assert.equal(cliSource.includes("process.env"), true);
  assert.equal(cliSource.includes("fetch("), true);
  assert.equal(cliSource.includes("api.sandbox.ebay.com/identity/v1/oauth2/token"), false);
  assert.equal(cliSource.includes("EBAY_SANDBOX_TOKEN_URL"), true);
});

test("no forbidden integrations draft publication env dumps or images", () => {
  const combined =
    `${readText(modulePath)}\n${readText(cliPath)}`;
  const forbidden =
    [
      "createClient",
      ".from(",
      ".insert(",
      ".update(",
      ".upsert(",
      "sendWhatsApp",
      "sendWhatsapp",
      "new OpenAI",
      "createDraftListing",
      "publishListing",
    ];

  for (const pattern of forbidden) {
    assert.equal(combined.includes(pattern), false, pattern);
  }

  for (const path of [fixturePath, modulePath, cliPath, docPath, "tools/ebay-sandbox-oauth-tests.mjs"]) {
    assert.equal(path.includes(".env"), false);
    assert.equal(/\.(dump|backup|png|jpg|jpeg|webp)$/i.test(path), false);
  }
});

test("docs exist and route helper points LOOP 148 to LOOP 149", async () => {
  assert.equal(fileExists(docPath), true);

  const routeModule =
    await import(`../${routeModulePath}`);
  const nextLoop =
    routeModule.getNextEbayProLoop("148");

  assert.ok(nextLoop);
  assert.equal(nextLoop.loopId, "149");
  assert.equal(nextLoop.label.includes("eBay Sandbox Draft Listing"), true);
});

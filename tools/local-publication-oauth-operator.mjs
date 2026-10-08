import {
  constants,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  privateDecrypt,
} from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ENV_FILE = path.resolve(
  process.env.LOCAL_SECRET_ENV_FILE || ".env.selfhost.production",
);
const PUBLIC_KEY_NAME = "EBAY_PUBLICATION_OAUTH_OPERATOR_PUBLIC_KEY";
const PRIVATE_KEY_FILE_NAME =
  "EBAY_PUBLICATION_OAUTH_OPERATOR_PRIVATE_KEY_FILE";
const BUNDLE_VERSION = "EBAY_PUBLICATION_OAUTH_CREDENTIAL_BUNDLE_V1";
const ENVELOPE_VERSION = "RSA_OAEP_SHA256_AES_256_GCM_V1";

function decodeEnvValue(raw) {
  const value = raw.trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      throw new Error("LOCAL_ENV_VALUE_INVALID");
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  return value;
}

function readEnv() {
  const source = fs.readFileSync(ENV_FILE, "utf8");
  const values = {};
  for (const line of source.split(/\r?\n/)) {
    if (!line || line.trimStart().startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    values[line.slice(0, separator).trim()] = decodeEnvValue(
      line.slice(separator + 1),
    );
  }
  return { source, values };
}

function encodeEnvValue(value) {
  return `"${value
    .replaceAll("\\", "\\\\")
    .replaceAll("\r", "\\r")
    .replaceAll("\n", "\\n")
    .replaceAll('"', '\\"')}"`;
}

function updateEnv(updates) {
  let { source } = readEnv();
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  for (const [key, value] of Object.entries(updates)) {
    if (typeof value !== "string" || value.length === 0 || value.length > 8192) {
      throw new Error("LOCAL_ENV_UPDATE_INVALID");
    }
    const line = `${key}=${encodeEnvValue(value)}`;
    const pattern = new RegExp(`^${key}=.*$`, "m");
    if (pattern.test(source)) source = source.replace(pattern, line);
    else {
      if (source && !source.endsWith("\n")) source += eol;
      source += `${line}${eol}`;
    }
  }
  fs.writeFileSync(ENV_FILE, source, { encoding: "utf8", mode: 0o600 });
}

function prepare() {
  const privateKeyPath = path.join(
    os.tmpdir(),
    `imnova-publication-oauth-${Date.now()}-${process.pid}.pem`,
  );
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 4096,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const publicObject = createPublicKey(publicKey);
  const privateObject = createPrivateKey(privateKey);
  if (
    publicObject.asymmetricKeyType !== "rsa" ||
    privateObject.asymmetricKeyType !== "rsa" ||
    (publicObject.asymmetricKeyDetails?.modulusLength ?? 0) < 4096
  ) {
    throw new Error("PUBLICATION_OPERATOR_KEY_INVALID");
  }
  fs.writeFileSync(privateKeyPath, privateKey, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  try {
    updateEnv({
      [PUBLIC_KEY_NAME]: publicKey,
      [PRIVATE_KEY_FILE_NAME]: privateKeyPath,
    });
  } catch (error) {
    fs.rmSync(privateKeyPath, { force: true });
    throw error;
  }
  console.log("PUBLICATION_OPERATOR_KEY_READY");
}

function required(values, name, maxLength = 20_000) {
  const value = values[name]?.trim() ?? "";
  if (!value || value.length > maxLength) {
    throw new Error(`PUBLICATION_OPERATOR_${name}_INVALID`);
  }
  return value;
}

async function supabaseRequest(values, pathname, init = {}) {
  const baseUrl = required(values, "NEXT_PUBLIC_SUPABASE_URL", 2_048);
  const serviceKey = required(values, "SUPABASE_SERVICE_ROLE_KEY", 16_384);
  const response = await fetch(new URL(pathname, baseUrl), {
    ...init,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) throw new Error("PUBLICATION_OPERATOR_SUPABASE_FAILED");
  return response;
}

function credentialFingerprint(bundle) {
  return createHash("sha256")
    .update(
      [bundle.clientId, bundle.clientSecret, bundle.refreshToken].join("\u0000"),
      "utf8",
    )
    .digest("hex");
}

function decryptBundle(encryptedBundle, privateKeyPem) {
  const envelope = JSON.parse(encryptedBundle);
  if (
    envelope?.version !== ENVELOPE_VERSION ||
    typeof envelope.encryptedKey !== "string" ||
    typeof envelope.iv !== "string" ||
    typeof envelope.tag !== "string" ||
    typeof envelope.ciphertext !== "string"
  ) {
    throw new Error("PUBLICATION_OPERATOR_ENVELOPE_INVALID");
  }
  const key = privateDecrypt(
    {
      key: privateKeyPem,
      oaepHash: "sha256",
      padding: constants.RSA_PKCS1_OAEP_PADDING,
    },
    Buffer.from(envelope.encryptedKey, "base64"),
  );
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(envelope.iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final(),
    ]);
    try {
      return JSON.parse(plaintext.toString("utf8"));
    } finally {
      plaintext.fill(0);
    }
  } finally {
    key.fill(0);
  }
}

async function install() {
  const { values } = readEnv();
  const privateKeyPath = required(values, PRIVATE_KEY_FILE_NAME, 4_096);
  const privateKeyPem = fs.readFileSync(privateKeyPath, "utf8");
  const query =
    "/rest/v1/ebay_publication_oauth_handoffs" +
    "?select=id,status,encrypted_credential_bundle,credential_bundle_version,credential_fingerprint" +
    "&status=eq.ready&order=created_at.desc&limit=1";
  const response = await supabaseRequest(values, query);
  const rows = await response.json();
  const row = Array.isArray(rows) ? rows[0] : null;
  if (
    !row?.id ||
    row.status !== "ready" ||
    row.credential_bundle_version !== BUNDLE_VERSION ||
    typeof row.encrypted_credential_bundle !== "string"
  ) {
    throw new Error("PUBLICATION_OPERATOR_HANDOFF_NOT_READY");
  }
  const bundle = decryptBundle(row.encrypted_credential_bundle, privateKeyPem);
  if (
    bundle?.version !== BUNDLE_VERSION ||
    typeof bundle.clientId !== "string" ||
    typeof bundle.clientSecret !== "string" ||
    typeof bundle.refreshToken !== "string" ||
    bundle.clientId.length < 10 ||
    bundle.clientSecret.length < 10 ||
    bundle.refreshToken.length < 50 ||
    credentialFingerprint(bundle) !== row.credential_fingerprint
  ) {
    throw new Error("PUBLICATION_OPERATOR_BUNDLE_INVALID");
  }
  updateEnv({
    EBAY_DRAFT_ONLY_PRODUCTION_CLIENT_ID: bundle.clientId,
    EBAY_DRAFT_ONLY_PRODUCTION_CLIENT_SECRET: bundle.clientSecret,
    EBAY_DRAFT_ONLY_PRODUCTION_REFRESH_TOKEN: bundle.refreshToken,
  });
  const now = new Date().toISOString();
  await supabaseRequest(
    values,
    `/rest/v1/ebay_publication_oauth_handoffs?id=eq.${encodeURIComponent(row.id)}&status=eq.ready`,
    {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        status: "installed",
        encrypted_credential_bundle: null,
        installed_at: now,
        ciphertext_cleared_at: now,
        updated_at: now,
      }),
    },
  );
  fs.rmSync(privateKeyPath, { force: true });
  updateEnv({
    [PUBLIC_KEY_NAME]: "__NOT_SET__",
    [PRIVATE_KEY_FILE_NAME]: "__NOT_SET__",
  });
  console.log("PUBLICATION_OAUTH_CREDENTIAL_INSTALLED_AND_CIPHERTEXT_CLEARED");
}

const mode = process.argv[2];
try {
  if (mode === "prepare") prepare();
  else if (mode === "install") await install();
  else throw new Error("PUBLICATION_OPERATOR_MODE_INVALID");
} catch (error) {
  const code = error instanceof Error && /^[A-Z0-9_]{3,180}$/.test(error.message)
    ? error.message
    : "PUBLICATION_OPERATOR_FAILED";
  console.error(code);
  process.exitCode = 1;
}

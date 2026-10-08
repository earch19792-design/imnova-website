import { chmod, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

const sourcePath = path.resolve(
  process.env.SELFHOST_ENV_FILE || ".env.selfhost.production",
)
const wslHome = process.env.SELLER_OS_WSL_HOME ||
  "\\\\wsl.localhost\\Ubuntu\\home\\earch"

function decode(raw) {
  const value = raw.trim()
  if (value.startsWith('"') && value.endsWith('"')) {
    return JSON.parse(value)
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1)
  }
  return value
}

function parseEnv(source) {
  const values = new Map()
  for (const line of source.split(/\r?\n/u)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u)
    if (match) values.set(match[1], decode(match[2]))
  }
  return values
}

function requiredSecret(values, name) {
  const value = values.get(name) ?? ""
  if (!/^[A-Za-z0-9._~-]{32,512}$/u.test(value)) {
    throw new Error(`SELFHOST_WSL_${name}_INVALID`)
  }
  return value
}

function shellValue(value) {
  if (!/^[A-Za-z0-9._~:/-]+$/u.test(value)) {
    throw new Error("SELFHOST_WSL_ENV_VALUE_INVALID")
  }
  return value
}

function updateEnv(source, updates) {
  let result = source
  const eol = source.includes("\r\n") ? "\r\n" : "\n"
  for (const [name, value] of Object.entries(updates)) {
    const line = `${name}=${shellValue(value)}`
    const pattern = new RegExp(`^${name}=.*$`, "mu")
    result = pattern.test(result)
      ? result.replace(pattern, line)
      : `${result.replace(/\s*$/u, "")}${eol}${line}${eol}`
  }
  return result
}

const values = parseEnv(await readFile(sourcePath, "utf8"))
const publicOrigin = values.get("SELLER_OS_PUBLIC_ORIGIN") ?? ""
let origin
try {
  origin = new URL(publicOrigin)
} catch {
  throw new Error("SELFHOST_WSL_PUBLIC_ORIGIN_INVALID")
}
if (origin.protocol !== "https:" || origin.username || origin.password ||
    origin.port || origin.pathname !== "/" || origin.search || origin.hash) {
  throw new Error("SELFHOST_WSL_PUBLIC_ORIGIN_INVALID")
}

const updates = {
  SELLER_OS_CLOUD_READ_RELAY_SECRET: requiredSecret(
    values,
    "SELLER_OS_CLOUD_READ_RELAY_SECRET",
  ),
  SELLER_OS_RUNTIME_RECOVERY_SECRET: requiredSecret(
    values,
    "SELLER_OS_RUNTIME_RECOVERY_SECRET",
  ),
  SELLER_OS_PUBLIC_ORIGIN: origin.origin,
  SELLER_OS_RUNTIME_RECOVERY_ORIGIN: "http://127.0.0.1:3100",
  SELLER_OS_CLOUD_READ_RELAY_URL:
    `${origin.origin}/api/seller-os/assistant/cloud-read-relay`,
}

for (const relative of [
  ".config/imnova/seller-os-cloud-read-relay.env",
  ".config/imnova/seller-os-cloud-read-relay-url.env",
]) {
  const target = path.join(wslHome, ...relative.split("/"))
  const current = await readFile(target, "utf8")
  await writeFile(target, updateEnv(current, updates), {
    encoding: "utf8",
    mode: 0o600,
  })
  await chmod(target, 0o600)
}

for (const [source, target, mode] of [
  [
    "ops/seller-os-runtime-recovery/seller-os-runtime-recovery",
    ".local/bin/imnova-seller-os-runtime-recovery",
    0o700,
  ],
  [
    "ops/seller-os-runtime-health/seller-os-runtime-health-reporter.mjs",
    ".local/bin/imnova-seller-os-runtime-health-reporter.mjs",
    0o700,
  ],
]) {
  const destination = path.join(wslHome, ...target.split("/"))
  const executable = (await readFile(path.resolve(source), "utf8"))
    .replace(/\r\n/gu, "\n")
  await writeFile(destination, executable, { encoding: "utf8", mode })
  await chmod(destination, mode)
}

console.log("WSL_SELFHOST_RUNTIME_BINDING_SYNCED")

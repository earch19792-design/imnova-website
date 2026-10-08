import { randomBytes } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"

const target = path.resolve(process.argv[2] || ".env.selfhost.production")
const workspace = `${path.resolve(process.cwd())}${path.sep}`
if (!target.startsWith(workspace)) {
  throw new Error("Target must stay inside the repository")
}

let contents = await readFile(target, "utf8")

function rawValue(name) {
  const match = contents.match(new RegExp(`^${name}=(.*)$`, "mu"))
  return match?.[1]?.trim().replace(/^"|"$/gu, "") ?? ""
}

function setValue(name, value, { replace = true } = {}) {
  const expression = new RegExp(`^${name}=.*$`, "mu")
  if (expression.test(contents)) {
    if (!replace) return false
    contents = contents.replace(expression, `${name}=${JSON.stringify(value)}`)
  } else {
    contents = `${contents.trimEnd()}\n${name}=${JSON.stringify(value)}\n`
  }
  return true
}

function ensureSecret(name) {
  const current = rawValue(name)
  if (current && current !== "[SENSITIVE]") return false
  return setValue(name, randomBytes(32).toString("base64url"))
}

for (const name of [
  "CRON_SECRET",
  "EBAY_COMMERCIAL_PILOT_CRON_SECRET",
  "EBAY_DRAFT_ONLY_PRODUCTION_PREFLIGHT_HMAC_SECRET",
  "SELLER_OS_CLOUD_READ_RELAY_SECRET",
  "SELLER_OS_RUNTIME_RECOVERY_SECRET",
]) {
  console.log(`${ensureSecret(name) ? "CREATED" : "PRESERVED"} ${name}`)
}

const publicOrigin = "https://selleros.sunshineecommerce-llc.com"
const settings = {
  SELFHOST_ENV_FILE: ".env.selfhost.production",
  SELFHOST_HTTP_PORT: "3100",
  SELLER_OS_DEPLOYMENT_MODE: "selfhost",
  SELLER_OS_PUBLIC_ORIGIN: publicOrigin,
  NEXT_PUBLIC_APP_URL: publicOrigin,
  LOCAL_VM_LAB_ENABLED: "false",
  LOCAL_VM_LAB_DRY_RUN: "false",
  LOCAL_SCHEDULER_DRY_RUN: "true",
  PRE_RESEARCH_HARDENING_CANARY_ENABLED: "false",
  PRE_RESEARCH_HARDENING_CANARY_BATCH_IDS: "",
  SELLER_OS_REMOTE_TITLE_CANARY_ENABLED: "false",
}

for (const [name, value] of Object.entries(settings)) {
  setValue(name, value)
  console.log(`SET ${name}`)
}

await writeFile(target, contents, { encoding: "utf8", mode: 0o600 })

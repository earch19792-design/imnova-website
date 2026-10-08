import { access } from "node:fs/promises"

const checks = []

function add(name, ok, detail) {
  checks.push({ name, ok, detail })
}

function present(name, minimumLength = 1) {
  const value = process.env[name]?.trim() ?? ""
  return value !== "[SENSITIVE]" && value.length >= minimumLength
}

let supabaseUrl = null
try {
  supabaseUrl = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "")
  add(
    "supabase_url",
    supabaseUrl.protocol === "https:" && !supabaseUrl.username &&
      !supabaseUrl.password,
    "HTTPS URL present",
  )
} catch {
  add("supabase_url", false, "missing or invalid")
}

add("supabase_public_key", present("NEXT_PUBLIC_SUPABASE_ANON_KEY", 20),
  "public browser credential present")
add("supabase_server_key", present("SUPABASE_SERVICE_ROLE_KEY", 20),
  "server-only credential present")
add("cron_secret", present("CRON_SECRET", 16),
  present("CRON_SECRET", 16) ? "ready" : "required before enabling automation")

try {
  const environmentFile = process.env.SELFHOST_ENV_FILE?.trim()
    || ".env.selfhost.production"
  await access(environmentFile)
  add("selfhost_environment_file", true, environmentFile)
} catch {
  add("selfhost_environment_file", false, "missing")
}

if (supabaseUrl && present("NEXT_PUBLIC_SUPABASE_ANON_KEY", 20)) {
  try {
    const response = await fetch(new URL("/auth/v1/health", supabaseUrl), {
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY },
      signal: AbortSignal.timeout(10_000),
    })
    add("supabase_auth_reachable", response.ok, `HTTP ${response.status}`)
  } catch {
    add("supabase_auth_reachable", false, "network or timeout")
  }
}

for (const check of checks) {
  console.log(`${check.ok ? "PASS" : "BLOCKED"} ${check.name}: ${check.detail}`)
}

const required = checks.filter((check) => check.name !== "cron_secret")
if (required.some((check) => !check.ok)) process.exitCode = 1

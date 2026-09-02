import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import test from "node:test"
import { SignJWT, jwtVerify } from "jose"
import ts from "typescript"

import {
  REMOTE_LIVE_OPERATOR_INTERNAL_EMAIL,
  normalizeRemoteLiveOperatorUsername,
  sellerOsPasswordLoginIdentity,
} from "../remote-live-operator-identity.ts"

let source = readFileSync("lib/remote-live-operator-enrollment.ts", "utf8")
globalThis.__remoteEnrollmentCrypto = { createHash, randomUUID }
globalThis.__remoteEnrollmentJose = { SignJWT, jwtVerify }
source = source
  .replace('import "server-only"\n\n', "")
  .replace('import { createHash, randomUUID } from "node:crypto"\n',
    "const { createHash, randomUUID } = globalThis.__remoteEnrollmentCrypto\n")
  .replace('import { SignJWT, jwtVerify } from "jose"\n',
    "const { SignJWT, jwtVerify } = globalThis.__remoteEnrollmentJose\n")
  .replace(/import \{\n  REMOTE_LIVE_OPERATOR_INTERNAL_EMAIL,[\s\S]*?\} from "\.\/remote-live-operator-identity"\n/,
    `const REMOTE_LIVE_OPERATOR_INTERNAL_EMAIL =
      "remote-live-optimization-operator@auth.imnova.invalid"
    const normalizeRemoteLiveOperatorUsername = (value) => {
      if (typeof value !== "string") return null
      const normalized = value.trim().toLowerCase()
      return /^[a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9])?$/.test(normalized)
        ? normalized : null
    }
`)
  .replace(/import \{ SELLER_OS_ACCESS_ROLES \} from "\.\/seller-os-access-control"\n/,
    `const SELLER_OS_ACCESS_ROLES = {
      remoteLiveOptimizationOperator: "REMOTE_LIVE_OPTIMIZATION_OPERATOR",
    }
`)
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.ES2022,
  target: ts.ScriptTarget.ES2022,
} }).outputText
const enrollment = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`)

function fakeAdminClient() {
  const users = []
  return {
    users,
    auth: { admin: {
      listUsers: async ({ page, perPage }) => ({
        data: { users: users.slice((page - 1) * perPage, page * perPage) },
        error: null,
      }),
      createUser: async (input) => {
        if (users.some((user) => user.email === input.email)) {
          return { data: { user: null }, error: { message: "duplicate" } }
        }
        const user = { id: `user-${users.length + 1}`, email: input.email,
          app_metadata: input.app_metadata }
        users.push(user)
        return { data: { user }, error: null }
      },
    } },
  }
}

test("username login maps to one internal account and retains username semantics", () => {
  assert.equal(normalizeRemoteLiveOperatorUsername("  Operadora.Uno "),
    "operadora.uno")
  assert.equal(normalizeRemoteLiveOperatorUsername("bad name"), null)
  assert.deepEqual(sellerOsPasswordLoginIdentity("Operadora.Uno"), {
    email: REMOTE_LIVE_OPERATOR_INTERNAL_EMAIL,
    remoteUsername: "operadora.uno",
  })
  assert.equal(sellerOsPasswordLoginIdentity("owner@example.com")?.email,
    "owner@example.com")
})

test("the owner invitation is expiring, purpose-bound, and tamper protected", async () => {
  const prior = process.env.SUPABASE_SERVICE_ROLE_KEY
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-authority-12345678901234567890"
  try {
    const token = await enrollment.createRemoteLiveOperatorInvitation()
    const verified = await enrollment.verifyRemoteLiveOperatorInvitation(token)
    assert.equal(verified.valid, true)
    const parts = token.split(".")
    const signature = parts[2]
    const altered = `${signature.slice(0, 5)}${signature[5] === "a" ? "b" : "a"}${signature.slice(6)}`
    await assert.rejects(
      enrollment.verifyRemoteLiveOperatorInvitation(
        `${parts[0]}.${parts[1]}.${altered}`),
      /REMOTE_OPERATOR_INVITATION_INVALID_OR_EXPIRED/,
    )
  } finally {
    if (prior === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY
    else process.env.SUPABASE_SERVICE_ROLE_KEY = prior
  }
})

test("one successful setup closes the singleton slot and stores authority in app_metadata", async () => {
  const prior = process.env.SUPABASE_SERVICE_ROLE_KEY
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-authority-12345678901234567890"
  try {
    const client = fakeAdminClient()
    const invitation = await enrollment.createRemoteLiveOperatorInvitation()
    const created = await enrollment.enrollRemoteLiveOperator({
      supabase: client,
      invitation,
      username: "Asistente.Uno",
      password: "correct-horse-battery-staple",
    })
    assert.equal(created.created, true)
    assert.equal(client.users.length, 1)
    assert.equal(client.users[0].email, REMOTE_LIVE_OPERATOR_INTERNAL_EMAIL)
    assert.equal(client.users[0].app_metadata.role,
      "REMOTE_LIVE_OPTIMIZATION_OPERATOR")
    assert.equal(client.users[0].app_metadata.operator_username,
      "asistente.uno")
    await assert.rejects(enrollment.enrollRemoteLiveOperator({
      supabase: client,
      invitation,
      username: "otra-asistente",
      password: "another-correct-password",
    }), /REMOTE_OPERATOR_ALREADY_CONFIGURED/)
    assert.equal(client.users.length, 1)
  } finally {
    if (prior === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY
    else process.env.SUPABASE_SERVICE_ROLE_KEY = prior
  }
})

test("the first-use surface has no public signup or browser-side service key", () => {
  const route = readFileSync(
    "app/api/admin/remote-live-operator-enrollment/route.ts", "utf8")
  const login = readFileSync("app/admin/login/page.tsx", "utf8")
  const ownerControl = readFileSync(
    "app/admin/remote-operator-enrollment-control.tsx", "utf8")
  const auth = readFileSync("lib/admin-auth.ts", "utf8")
  assert.match(route, /validateAdminApiRequest/)
  assert.match(route, /authenticationMode !== "admin_user"/)
  assert.match(route, /getSupabaseAdminClient/)
  assert.match(route, /dedicatedPreprod/)
  assert.match(login, /window\.location\.hash/)
  assert.match(login, /history\.replaceState/)
  assert.match(login, /data-remote-first-enrollment/)
  assert.doesNotMatch(login, /SUPABASE_SERVICE_ROLE_KEY|auth\.admin\.createUser/)
  assert.match(ownerControl, /CREAR INVITACIÓN PRIVADA/)
  assert.match(auth, /remoteLiveOperatorUsernameFromUser/)
  assert.doesNotMatch(ownerControl, /console\.(?:log|error)/)
})

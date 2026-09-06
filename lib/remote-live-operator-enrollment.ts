import "server-only"

import { createHash, randomUUID } from "node:crypto"
import { SignJWT, jwtVerify } from "jose"
import type { SupabaseClient, User } from "@supabase/supabase-js"

import {
  REMOTE_LIVE_OPERATOR_INTERNAL_EMAIL,
  normalizeRemoteLiveOperatorDisplayName,
  normalizeRemoteLiveOperatorUsername,
} from "./remote-live-operator-identity"
import { SELLER_OS_ACCESS_ROLES } from "./seller-os-access-control"

export const REMOTE_LIVE_OPERATOR_ENROLLMENT_CONTRACT =
  "REMOTE_LIVE_OPERATOR_OWNER_INVITATION_V1" as const
export const REMOTE_LIVE_OPERATOR_INVITATION_TTL_SECONDS = 15 * 60
export const REMOTE_LIVE_OPERATOR_PASSWORD_MIN_LENGTH = 12

const INVITATION_ISSUER = "imnova-seller-os"
const INVITATION_AUDIENCE = "remote-live-operator-first-enrollment"
const USER_SCAN_PAGE_SIZE = 1_000
const USER_SCAN_MAX_PAGES = 10

function invitationKey() {
  const authority = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? ""
  if (authority.length < 32) {
    throw new Error("REMOTE_OPERATOR_ENROLLMENT_SECRET_AUTHORITY_MISSING")
  }
  return createHash("sha256")
    .update("seller-os:remote-live-operator:first-enrollment:v1\0")
    .update(authority)
    .digest()
}

function isRemoteOperator(user: User) {
  return user.app_metadata?.role ===
    SELLER_OS_ACCESS_ROLES.remoteLiveOptimizationOperator
}

async function boundedAuthUsers(supabase: SupabaseClient) {
  const users: User[] = []
  for (let page = 1; page <= USER_SCAN_MAX_PAGES; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: USER_SCAN_PAGE_SIZE,
    })
    if (error) throw new Error("REMOTE_OPERATOR_ACCOUNT_AUTHORITY_READ_FAILED")
    users.push(...data.users)
    if (data.users.length < USER_SCAN_PAGE_SIZE) return users
  }
  throw new Error("REMOTE_OPERATOR_ACCOUNT_AUTHORITY_SCAN_BOUND_REACHED")
}

export async function readRemoteLiveOperatorEnrollmentStatus(
  supabase: SupabaseClient,
) {
  const users = await boundedAuthUsers(supabase)
  const remoteUsers = users.filter(isRemoteOperator)
  const fixedSlotUsers = users.filter((user) =>
    user.email?.trim().toLowerCase() === REMOTE_LIVE_OPERATOR_INTERNAL_EMAIL)
  return Object.freeze({
    configured: remoteUsers.length > 0,
    remoteAccountCount: remoteUsers.length,
    remoteUserId: remoteUsers.length === 1 ? remoteUsers[0]?.id ?? null : null,
    exactSingleton: remoteUsers.length === 1 && fixedSlotUsers.length === 1 &&
      remoteUsers[0]?.id === fixedSlotUsers[0]?.id,
    fixedSlotOccupiedByAnotherAuthority:
      fixedSlotUsers.length > 0 && !fixedSlotUsers.every(isRemoteOperator),
  })
}

export async function createRemoteLiveOperatorInvitation() {
  return new SignJWT({
    purpose: REMOTE_LIVE_OPERATOR_ENROLLMENT_CONTRACT,
    slot: "REMOTE_LIVE_OPTIMIZATION_OPERATOR_SINGLETON",
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(INVITATION_ISSUER)
    .setAudience(INVITATION_AUDIENCE)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${REMOTE_LIVE_OPERATOR_INVITATION_TTL_SECONDS}s`)
    .sign(invitationKey())
}

export async function verifyRemoteLiveOperatorInvitation(token: unknown) {
  if (typeof token !== "string" || token.length < 80 || token.length > 4_096) {
    throw new Error("REMOTE_OPERATOR_INVITATION_INVALID")
  }
  try {
    const { payload } = await jwtVerify(token, invitationKey(), {
      issuer: INVITATION_ISSUER,
      audience: INVITATION_AUDIENCE,
      algorithms: ["HS256"],
      clockTolerance: 5,
    })
    if (payload.purpose !== REMOTE_LIVE_OPERATOR_ENROLLMENT_CONTRACT ||
        payload.slot !== "REMOTE_LIVE_OPTIMIZATION_OPERATOR_SINGLETON" ||
        typeof payload.jti !== "string") {
      throw new Error("REMOTE_OPERATOR_INVITATION_PURPOSE_MISMATCH")
    }
    return Object.freeze({ valid: true as const, invitationId: payload.jti })
  } catch (error) {
    if (error instanceof Error &&
        error.message === "REMOTE_OPERATOR_INVITATION_PURPOSE_MISMATCH") {
      throw error
    }
    throw new Error("REMOTE_OPERATOR_INVITATION_INVALID_OR_EXPIRED")
  }
}

export async function enrollRemoteLiveOperator(input: Readonly<{
  supabase: SupabaseClient
  invitation: unknown
  displayName: unknown
  username: unknown
  password: unknown
}>) {
  await verifyRemoteLiveOperatorInvitation(input.invitation)
  const displayName = normalizeRemoteLiveOperatorDisplayName(
    input.displayName,
  )
  if (!displayName) throw new Error("REMOTE_OPERATOR_DISPLAY_NAME_INVALID")
  const username = normalizeRemoteLiveOperatorUsername(input.username)
  if (!username) throw new Error("REMOTE_OPERATOR_USERNAME_INVALID")
  if (typeof input.password !== "string" ||
      input.password.length < REMOTE_LIVE_OPERATOR_PASSWORD_MIN_LENGTH ||
      input.password.length > 128) {
    throw new Error("REMOTE_OPERATOR_PASSWORD_POLICY_NOT_MET")
  }
  const before = await readRemoteLiveOperatorEnrollmentStatus(input.supabase)
  if (before.configured) throw new Error("REMOTE_OPERATOR_ALREADY_CONFIGURED")
  if (before.fixedSlotOccupiedByAnotherAuthority) {
    throw new Error("REMOTE_OPERATOR_SINGLETON_SLOT_CONFLICT")
  }

  const { data, error } = await input.supabase.auth.admin.createUser({
    email: REMOTE_LIVE_OPERATOR_INTERNAL_EMAIL,
    password: input.password,
    email_confirm: true,
    app_metadata: {
      role: SELLER_OS_ACCESS_ROLES.remoteLiveOptimizationOperator,
      operator_display_name: displayName,
      operator_username: username,
      enrollment_contract: REMOTE_LIVE_OPERATOR_ENROLLMENT_CONTRACT,
    },
  })
  if (error || !data.user) {
    const afterCollision = await readRemoteLiveOperatorEnrollmentStatus(
      input.supabase,
    )
    if (afterCollision.configured) {
      throw new Error("REMOTE_OPERATOR_ALREADY_CONFIGURED")
    }
    throw new Error("REMOTE_OPERATOR_ACCOUNT_CREATION_FAILED")
  }
  if (!isRemoteOperator(data.user) ||
      data.user.app_metadata?.operator_username !== username ||
      data.user.app_metadata?.operator_display_name !== displayName) {
    throw new Error("REMOTE_OPERATOR_ACCOUNT_ROLE_READBACK_FAILED")
  }
  const after = await readRemoteLiveOperatorEnrollmentStatus(input.supabase)
  if (!after.exactSingleton) {
    throw new Error("REMOTE_OPERATOR_SINGLETON_READBACK_FAILED")
  }
  return Object.freeze({
    created: true as const,
    role: SELLER_OS_ACCESS_ROLES.remoteLiveOptimizationOperator,
    displayName,
    username,
  })
}

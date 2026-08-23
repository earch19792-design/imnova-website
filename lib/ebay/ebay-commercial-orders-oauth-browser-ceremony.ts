import "server-only"

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto"

import {
  EBAY_COMMERCIAL_ORDERS_BROWSER_START_PAGE_PATH,
  isValidEbayCommercialOAuthState,
} from "./ebay-commercial-orders-oauth-domain"

export const EBAY_COMMERCIAL_ORDERS_BROWSER_CEREMONY_VERSION =
  "EBAY_COMMERCIAL_ORDERS_BROWSER_CEREMONY_V2" as const
export const EBAY_COMMERCIAL_ORDERS_BROWSER_START_TTL_MS = 15 * 60 * 1_000

const TICKET_VERSION = 2
const TICKET_SALT = "IMNOVA_EBAY_COMMERCIAL_ORDERS_BROWSER_START_SALT_V2"
const TICKET_INFO = "IMNOVA_EBAY_COMMERCIAL_ORDERS_BROWSER_START_AES_GCM_V2"
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const HOST = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/

type TicketPayload = {
  v: 2
  state: string
  handoffId: string
  expiresAt: number
  host: string
  deploymentHash: string
  actorHash: string
  purpose: "COMMERCIAL_ORDERS_AND_BUYER_MESSAGE"
}

export class EbayCommercialOrdersBrowserCeremonyError extends Error {
  readonly code: string

  constructor(code: string) {
    const safe = /^[A-Z0-9_]{3,160}$/.test(code)
      ? code
      : "EBAY_COMMERCIAL_ORDERS_BROWSER_CEREMONY_FAILED"
    super(safe)
    this.name = "EbayCommercialOrdersBrowserCeremonyError"
    this.code = safe
  }
}

function key(input: {
  clientSecret: string
  expectedAccountFingerprint: string
}) {
  return Buffer.from(hkdfSync(
    "sha256",
    Buffer.from(input.clientSecret, "utf8"),
    Buffer.from(`${TICKET_SALT}:${input.expectedAccountFingerprint}`, "utf8"),
    Buffer.from(TICKET_INFO, "utf8"),
    32,
  ))
}

function validSecretInput(input: {
  clientSecret: string
  expectedAccountFingerprint: string
}) {
  return Boolean(input.clientSecret && input.clientSecret.length <= 2_048) &&
    /^[0-9a-f]{64}$/.test(input.expectedAccountFingerprint)
}

function identityHash(namespace: "ACTOR" | "DEPLOYMENT", value: string) {
  return createHash("sha256")
    .update(`${namespace}:${value}`, "utf8")
    .digest("hex")
}

function equalHex(left: string, right: string) {
  if (!/^[0-9a-f]{64}$/.test(left) || !/^[0-9a-f]{64}$/.test(right)) {
    return false
  }
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"))
}

function validIdentity(value: string) {
  return Boolean(value) && value.length <= 512 &&
    !/[\u0000-\u001f\u007f]/.test(value)
}

export function createEbayCommercialOrdersBrowserStartTicket(input: {
  state: string
  handoffId: string
  expiresAt: number
  host: string
  deploymentIdentity: string
  actorUserId: string
  clientSecret: string
  expectedAccountFingerprint: string
}) {
  if (!isValidEbayCommercialOAuthState(input.state) ||
      !UUID.test(input.handoffId) ||
      !Number.isSafeInteger(input.expiresAt) ||
      !HOST.test(input.host) ||
      !validIdentity(input.deploymentIdentity) ||
      !UUID.test(input.actorUserId) ||
      !validSecretInput(input)) {
    throw new EbayCommercialOrdersBrowserCeremonyError(
      "EBAY_COMMERCIAL_ORDERS_BROWSER_START_TICKET_MALFORMED",
    )
  }
  const payload: TicketPayload = {
    v: TICKET_VERSION,
    state: input.state,
    handoffId: input.handoffId,
    expiresAt: input.expiresAt,
    host: input.host,
    deploymentHash: identityHash("DEPLOYMENT", input.deploymentIdentity),
    actorHash: identityHash("ACTOR", input.actorUserId),
    purpose: "COMMERCIAL_ORDERS_AND_BUYER_MESSAGE",
  }
  const nonce = randomBytes(12)
  const encryptionKey = key(input)
  try {
    const cipher = createCipheriv("aes-256-gcm", encryptionKey, nonce)
    cipher.setAAD(Buffer.from(
      EBAY_COMMERCIAL_ORDERS_BROWSER_CEREMONY_VERSION,
      "utf8",
    ))
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(payload), "utf8"),
      cipher.final(),
    ])
    const tag = cipher.getAuthTag()
    return [
      String(TICKET_VERSION),
      nonce.toString("base64url"),
      ciphertext.toString("base64url"),
      tag.toString("base64url"),
    ].join(".")
  } finally {
    encryptionKey.fill(0)
    nonce.fill(0)
  }
}

export function verifyEbayCommercialOrdersBrowserStartTicket(input: {
  ticket: string
  now: number
  host: string
  deploymentIdentity: string
  actorUserId: string
  clientSecret: string
  expectedAccountFingerprint: string
}) {
  if (!input.ticket || input.ticket.length > 2_048 ||
      !Number.isSafeInteger(input.now) ||
      !HOST.test(input.host) ||
      !validIdentity(input.deploymentIdentity) ||
      !UUID.test(input.actorUserId) ||
      !validSecretInput(input)) {
    throw new EbayCommercialOrdersBrowserCeremonyError(
      "EBAY_COMMERCIAL_ORDERS_BROWSER_START_TICKET_MALFORMED",
    )
  }
  const parts = input.ticket.split(".")
  if (parts.length !== 4 || parts[0] !== String(TICKET_VERSION) ||
      parts[1]?.length !== 16 || parts[3]?.length !== 22 ||
      parts.slice(1).some((part) => !/^[A-Za-z0-9_-]+$/.test(part ?? ""))) {
    throw new EbayCommercialOrdersBrowserCeremonyError(
      "EBAY_COMMERCIAL_ORDERS_BROWSER_START_TICKET_MALFORMED",
    )
  }
  const encryptionKey = key(input)
  let plaintext = Buffer.alloc(0)
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey,
      Buffer.from(parts[1] ?? "", "base64url"),
    )
    decipher.setAAD(Buffer.from(
      EBAY_COMMERCIAL_ORDERS_BROWSER_CEREMONY_VERSION,
      "utf8",
    ))
    decipher.setAuthTag(Buffer.from(parts[3] ?? "", "base64url"))
    plaintext = Buffer.concat([
      decipher.update(Buffer.from(parts[2] ?? "", "base64url")),
      decipher.final(),
    ])
    let parsed: TicketPayload
    try {
      parsed = JSON.parse(plaintext.toString("utf8")) as TicketPayload
    } catch {
      throw new EbayCommercialOrdersBrowserCeremonyError(
        "EBAY_COMMERCIAL_ORDERS_BROWSER_START_TICKET_MALFORMED",
      )
    }
    const exactKeys = Object.keys(parsed).sort().join(",") ===
      "actorHash,deploymentHash,expiresAt,handoffId,host,purpose,state,v"
    if (!exactKeys || parsed.v !== TICKET_VERSION ||
        parsed.purpose !== "COMMERCIAL_ORDERS_AND_BUYER_MESSAGE" ||
        !isValidEbayCommercialOAuthState(parsed.state) ||
        !UUID.test(parsed.handoffId) ||
        !Number.isSafeInteger(parsed.expiresAt) ||
        !/^[0-9a-f]{64}$/.test(parsed.deploymentHash) ||
        !/^[0-9a-f]{64}$/.test(parsed.actorHash)) {
      throw new EbayCommercialOrdersBrowserCeremonyError(
        "EBAY_COMMERCIAL_ORDERS_BROWSER_START_TICKET_MALFORMED",
      )
    }
    if (parsed.expiresAt <= input.now) {
      throw new EbayCommercialOrdersBrowserCeremonyError(
        "EBAY_COMMERCIAL_ORDERS_BROWSER_START_TICKET_EXPIRED",
      )
    }
    if (parsed.expiresAt > input.now +
        EBAY_COMMERCIAL_ORDERS_BROWSER_START_TTL_MS) {
      throw new EbayCommercialOrdersBrowserCeremonyError(
        "EBAY_COMMERCIAL_ORDERS_BROWSER_START_TICKET_MALFORMED",
      )
    }
    if (parsed.host !== input.host) {
      throw new EbayCommercialOrdersBrowserCeremonyError(
        "EBAY_COMMERCIAL_ORDERS_BROWSER_START_TICKET_HOST_MISMATCH",
      )
    }
    if (!equalHex(
      parsed.deploymentHash,
      identityHash("DEPLOYMENT", input.deploymentIdentity),
    )) {
      throw new EbayCommercialOrdersBrowserCeremonyError(
        "EBAY_COMMERCIAL_ORDERS_BROWSER_START_TICKET_DEPLOYMENT_MISMATCH",
      )
    }
    if (!equalHex(
      parsed.actorHash,
      identityHash("ACTOR", input.actorUserId),
    )) {
      throw new EbayCommercialOrdersBrowserCeremonyError(
        "EBAY_COMMERCIAL_ORDERS_BROWSER_START_TICKET_ACTOR_MISMATCH",
      )
    }
    return {
      state: parsed.state,
      handoffId: parsed.handoffId,
      expiresAt: parsed.expiresAt,
      host: parsed.host,
      purpose: parsed.purpose,
    }
  } catch (cause) {
    if (cause instanceof EbayCommercialOrdersBrowserCeremonyError) throw cause
    throw new EbayCommercialOrdersBrowserCeremonyError(
      "EBAY_COMMERCIAL_ORDERS_BROWSER_START_TICKET_SIGNATURE_INVALID",
    )
  } finally {
    encryptionKey.fill(0)
    plaintext.fill(0)
  }
}

export function buildEbayCommercialOrdersBrowserStartUrl(input: {
  host: string
  ticket: string
}) {
  if (!HOST.test(input.host) || !input.ticket || input.ticket.length > 2_048 ||
      /[^A-Za-z0-9._-]/.test(input.ticket)) {
    throw new EbayCommercialOrdersBrowserCeremonyError(
      "EBAY_COMMERCIAL_ORDERS_BROWSER_START_URL_INVALID",
    )
  }
  const url = new URL(
    `https://${input.host}${EBAY_COMMERCIAL_ORDERS_BROWSER_START_PAGE_PATH}`,
  )
  // Query transport is required here: Vercel Deployment Protection receives
  // the initial HTTP request and therefore cannot preserve a URL fragment.
  // The ticket is sealed, short-lived, actor/deployment/host-bound and is
  // removed from browser history before the same-origin POST exchange.
  url.search = new URLSearchParams({ ticket: input.ticket }).toString()
  return url.toString()
}

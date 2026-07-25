import { createHash } from "node:crypto"

export const EBAY_SELLER_MESSAGE_ALERT_SCHEMA_VERSION =
  "EBAY_SELLER_MESSAGE_ALERT_V1"
export const EBAY_SELLER_HUB_INBOX_URL = "https://www.ebay.com/sh/messaging"

export const EBAY_SELLER_MESSAGE_TYPES = [
  "ASK_SELLER_QUESTION",
  "CONTACT_TRANSACTION_PARTNER",
  "CONTACT_EBAY_MEMBER",
  "RESPONSE_TO_QUESTION",
  "OTHER",
] as const

export type EbaySellerMessageType = typeof EBAY_SELLER_MESSAGE_TYPES[number]

export type EbaySellerMessageHeader = {
  messageKeyHash: string
  listingId: string | null
  messageType: EbaySellerMessageType
  messageStatus: "UNANSWERED" | "UNKNOWN"
  createdAt: string | null
  lastModifiedAt: string | null
  priority: "HIGH" | "MEDIUM"
}

function decodeXmlText(value: string) {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
}

function xmlValue(xml: string, tag: string) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const match = xml.match(new RegExp(
    `<(?:[A-Za-z0-9_-]+:)?${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_-]+:)?${escaped}>`,
    "i",
  ))
  return match ? decodeXmlText(match[1]) : null
}

function xmlBlocks(xml: string, tag: string) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return [...xml.matchAll(new RegExp(
    `<(?:[A-Za-z0-9_-]+:)?${escaped}(?:\\s[^>]*)?>[\\s\\S]*?<\\/(?:[A-Za-z0-9_-]+:)?${escaped}>`,
    "gi",
  ))].map((match) => match[0])
}

function safeDate(value: string | null) {
  const parsed = Date.parse(value ?? "")
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
}

function messageType(value: string | null): EbaySellerMessageType {
  const normalized = (value ?? "").replace(/[^a-z]/gi, "").toLowerCase()
  if (normalized === "asksellerquestion") return "ASK_SELLER_QUESTION"
  if (normalized === "contacttransactionpartner") return "CONTACT_TRANSACTION_PARTNER"
  if (normalized === "contactebaymember" || normalized === "contactebaymemberviaanonymousemail") {
    return "CONTACT_EBAY_MEMBER"
  }
  if (normalized === "responsetoasqquestion" || normalized === "response") {
    return "RESPONSE_TO_QUESTION"
  }
  return "OTHER"
}

function messageStatus(value: string | null): EbaySellerMessageHeader["messageStatus"] {
  return (value ?? "").replace(/[^a-z]/gi, "").toLowerCase() === "unanswered"
    ? "UNANSWERED"
    : "UNKNOWN"
}

function stableMessageHash(accountKey: string, rawMessageId: string) {
  return createHash("sha256")
    .update(`${accountKey}\u0000${rawMessageId}`, "utf8")
    .digest("hex")
}

/**
 * Extracts only allowlisted operational headers from the transient Trading XML.
 * Message text, subject, sender identity, recipient identity and HTML are never
 * read into the returned object and the caller discards the XML immediately.
 */
export function sanitizeEbaySellerMessageHeadersXml(
  xml: string,
  accountKey: string,
): {
  headers: EbaySellerMessageHeader[]
  rawRowsSeen: number
  rejectedRows: number
  rawXmlPersisted: false
  messageContentReturned: false
  buyerPiiReturned: false
} {
  const blocks = xmlBlocks(xml, "MemberMessageExchange")
  const headers: EbaySellerMessageHeader[] = []
  for (const block of blocks) {
    const rawMessageId = xmlValue(block, "MessageID")
    if (!rawMessageId || rawMessageId.length > 240) continue
    const rawListingId = xmlValue(block, "ItemID")
    const listingId = rawListingId && /^\d{9,20}$/.test(rawListingId)
      ? rawListingId
      : null
    const type = messageType(xmlValue(block, "QuestionType"))
    headers.push({
      messageKeyHash: stableMessageHash(accountKey, rawMessageId),
      listingId,
      messageType: type,
      messageStatus: messageStatus(xmlValue(block, "MessageStatus")),
      createdAt: safeDate(xmlValue(block, "CreationDate")),
      lastModifiedAt: safeDate(xmlValue(block, "LastModifiedDate")),
      priority: type === "ASK_SELLER_QUESTION" ||
        type === "CONTACT_TRANSACTION_PARTNER" ? "HIGH" : "MEDIUM",
    })
  }
  return {
    headers: [...new Map(headers.map((row) => [row.messageKeyHash, row])).values()],
    rawRowsSeen: blocks.length,
    rejectedRows: Math.max(0, blocks.length - headers.length),
    rawXmlPersisted: false,
    messageContentReturned: false,
    buyerPiiReturned: false,
  }
}

export function sellerMessageAlertPayload(header: EbaySellerMessageHeader) {
  const listing = header.listingId ? `Artículo eBay ${header.listingId}` : "Buzón de Seller Hub"
  return {
    title: "📨 NUEVO MENSAJE EN SELLER HUB",
    summary: `${listing} · ${header.messageType} · contenido protegido`,
    action: `Abrir el buzón oficial, leer y responder manualmente: ${EBAY_SELLER_HUB_INBOX_URL}`,
    sellerHubInboxUrl: EBAY_SELLER_HUB_INBOX_URL,
    listingId: header.listingId,
    messageType: header.messageType,
    priority: header.priority,
    contentForwarded: false,
    buyerPiiForwarded: false,
    schemaVersion: EBAY_SELLER_MESSAGE_ALERT_SCHEMA_VERSION,
  }
}

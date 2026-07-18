import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  EBAY_SELLER_HUB_INBOX_URL,
  sanitizeEbaySellerMessageHeadersXml,
  sellerMessageAlertPayload,
} from "./ebay-seller-message-alert-domain.ts"

const PRIVATE_MARKERS = [
  "private-buyer-77",
  "private@example.com",
  "Please ship to my private address",
  "Private subject",
]

function messageXml(messageId = "message-123") {
  return `<?xml version="1.0" encoding="utf-8"?>
    <GetMemberMessagesResponse xmlns="urn:ebay:apis:eBLBaseComponents">
      <Ack>Success</Ack>
      <MemberMessageExchange>
        <Item><ItemID>366543596425</ItemID></Item>
        <Question>
          <MessageID>${messageId}</MessageID>
          <QuestionType>AskSellerQuestion</QuestionType>
          <MessageStatus>Unanswered</MessageStatus>
          <CreationDate>2026-07-18T12:00:00.000Z</CreationDate>
          <LastModifiedDate>2026-07-18T12:01:00.000Z</LastModifiedDate>
          <SenderID>private-buyer-77</SenderID>
          <SenderEmail>private@example.com</SenderEmail>
          <Subject>Private subject</Subject>
          <Body><![CDATA[Please ship to my private address]]></Body>
        </Question>
      </MemberMessageExchange>
      <PaginationResult><TotalNumberOfPages>1</TotalNumberOfPages></PaginationResult>
    </GetMemberMessagesResponse>`
}

test("Seller Hub message extraction returns headers only and discards private content", () => {
  const sanitized = sanitizeEbaySellerMessageHeadersXml(messageXml(), "seller-a:hash")
  assert.equal(sanitized.headers.length, 1)
  assert.equal(sanitized.headers[0].listingId, "366543596425")
  assert.equal(sanitized.headers[0].messageType, "ASK_SELLER_QUESTION")
  assert.equal(sanitized.headers[0].messageStatus, "UNANSWERED")
  assert.match(sanitized.headers[0].messageKeyHash, /^[a-f0-9]{64}$/)
  assert.equal(sanitized.rawXmlPersisted, false)
  assert.equal(sanitized.messageContentReturned, false)
  assert.equal(sanitized.buyerPiiReturned, false)
  const serialized = JSON.stringify(sanitized)
  for (const marker of PRIVATE_MARKERS) assert.doesNotMatch(serialized, new RegExp(marker, "i"))
})

test("Seller Hub message dedupe is stable per account and never stores raw MessageID", () => {
  const repeated = `${messageXml("raw-message-id-secret")}${messageXml("raw-message-id-secret")}`
  const first = sanitizeEbaySellerMessageHeadersXml(repeated, "seller-a:hash")
  const second = sanitizeEbaySellerMessageHeadersXml(messageXml("raw-message-id-secret"), "seller-b:hash")
  assert.equal(first.headers.length, 1)
  assert.notEqual(first.headers[0].messageKeyHash, second.headers[0].messageKeyHash)
  assert.doesNotMatch(JSON.stringify(first), /raw-message-id-secret/)
})

test("WhatsApp receives a safe action alert, never the conversation", () => {
  const header = sanitizeEbaySellerMessageHeadersXml(messageXml(), "seller-a:hash").headers[0]
  const payload = sellerMessageAlertPayload(header)
  assert.equal(payload.sellerHubInboxUrl, EBAY_SELLER_HUB_INBOX_URL)
  assert.equal(payload.contentForwarded, false)
  assert.equal(payload.buyerPiiForwarded, false)
  assert.match(payload.title, /SELLER HUB/)
  const serialized = JSON.stringify(payload)
  for (const marker of PRIVATE_MARKERS) assert.doesNotMatch(serialized, new RegExp(marker, "i"))
})

test("message lane uses official read-only Trading operation and no reply/write call", () => {
  const readers = readFileSync("lib/ebay/ebay-commercial-readers.ts", "utf8")
  const service = readFileSync("lib/ebay/ebay-commercial-monitor-service.ts", "utf8")
  assert.match(readers, /X-EBAY-API-CALL-NAME": "GetMemberMessages"/)
  assert.match(readers, /<MessageStatus>Unanswered<\/MessageStatus>/)
  assert.match(readers, /GET_MEMBER_MESSAGES/)
  assert.match(readers, /createEbayReadonlyRateLimitError\("EBAY_READONLY_GET_429"/)
  assert.match(service, /SELLER_HUB_MESSAGE_RECEIVED/)
  assert.match(service, /contentStored: false/)
  assert.match(service, /rawXmlStored: false/)
  assert.match(service, /buyerPiiStored: false/)
  const messageSlice = readers.slice(
    readers.indexOf("export async function getEbaySellerInboxMessageHeaders"),
    readers.indexOf("export async function getComparableEbayTrafficAnalytics"),
  )
  assert.doesNotMatch(messageSlice, /AddMemberMessageRTQ|ReviseItem|AddItem|CompleteSale/)
  assert.doesNotMatch(messageSlice, /Question\.Body|Question\.Subject|SenderID|SenderEmail/)
})

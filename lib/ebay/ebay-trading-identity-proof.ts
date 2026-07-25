const EBAY_TRADING_ENDPOINT = "https://api.ebay.com/ws/api.dll"
const EBAY_TRADING_COMPATIBILITY_LEVEL = "1423"
const EBAY_TRADING_REQUEST_TIMEOUT_MS = 10_000

type FetchLike = typeof fetch

function xmlValue(xml: string, tag: string) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const match = xml.match(new RegExp(
    `<(?:[A-Za-z0-9_-]+:)?${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_-]+:)?${escaped}>`,
    "i",
  ))
  return match?.[1]
    ?.replace(/<[^>]*>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim() ?? ""
}

export async function readEbayTradingUserIdWithAccessToken(
  accessToken: string,
  fetchImpl: FetchLike = fetch,
) {
  if (!accessToken?.trim()) {
    throw new Error("EBAY_TRADING_ACCESS_TOKEN_REQUIRED")
  }
  const response = await fetchImpl(EBAY_TRADING_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml",
      "X-EBAY-API-CALL-NAME": "GetUser",
      "X-EBAY-API-COMPATIBILITY-LEVEL":
        EBAY_TRADING_COMPATIBILITY_LEVEL,
      "X-EBAY-API-SITEID": "0",
      "X-EBAY-API-IAF-TOKEN": accessToken,
    },
    body: "<?xml version=\"1.0\" encoding=\"utf-8\"?>" +
      "<GetUserRequest xmlns=\"urn:ebay:apis:eBLBaseComponents\">" +
      "<OutputSelector>User.UserID</OutputSelector>" +
      "</GetUserRequest>",
    cache: "no-store",
    signal: AbortSignal.timeout(EBAY_TRADING_REQUEST_TIMEOUT_MS),
  })
  const xml = await response.text()
  const ack = xmlValue(xml, "Ack").toLowerCase()
  const userId = xmlValue(xml, "UserID")
  if (
    !response.ok ||
    !["success", "warning"].includes(ack) ||
    !userId
  ) {
    throw new Error("EBAY_TRADING_IDENTITY_PROOF_UNAVAILABLE")
  }
  return userId
}

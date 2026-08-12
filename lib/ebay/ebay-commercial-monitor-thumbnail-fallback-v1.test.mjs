import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  parseEbayTradingGetItemPrimaryImage,
  parseEbayTradingGetMyeBaySellingPage,
} from "./ebay-commercial-monitor-live-readonly-domain.ts"

test("seller-wide parser preserves nested authoritative GalleryURL", () => {
  const result = parseEbayTradingGetMyeBaySellingPage(`<?xml version="1.0"?><GetMyeBaySellingResponse xmlns="urn:ebay:apis:eBLBaseComponents"><Ack>Success</Ack><ActiveList><PaginationResult><TotalNumberOfPages>1</TotalNumberOfPages><TotalNumberOfEntries>1</TotalNumberOfEntries></PaginationResult><HasMoreItems>false</HasMoreItems><ItemArray><Item><ItemID>123456789012</ItemID><Site>US</Site><Title>Verified item</Title><SellingStatus><QuantitySold>0</QuantitySold></SellingStatus><Quantity>2</Quantity><PictureDetails><GalleryURL>https://i.ebayimg.com/images/g/verified/s-l500.jpg</GalleryURL></PictureDetails></Item></ItemArray></ActiveList></GetMyeBaySellingResponse>`, "2026-08-11T12:00:00.000Z")
  assert.equal(result.accepted, true)
  assert.equal(result.listings[0]?.primaryImageUrl, "https://i.ebayimg.com/images/g/verified/s-l500.jpg")
  assert.equal(result.listings[0]?.primaryImageSource, "EBAY_TRADING_GET_MY_EBAY_SELLING")
})

test("GetItem fallback is exact Item-ID bound and HTTPS-only", () => {
  const xml = `<?xml version="1.0"?><GetItemResponse xmlns="urn:ebay:apis:eBLBaseComponents"><Ack>Success</Ack><Item><ItemID>123456789012</ItemID><Site>US</Site><PictureDetails><PictureURL>https://i.ebayimg.com/images/g/fallback/s-l1600.jpg</PictureURL></PictureDetails></Item></GetItemResponse>`
  assert.deepEqual(parseEbayTradingGetItemPrimaryImage(xml, "123456789012"), {
    status: "AVAILABLE",
    primaryImageUrl: "https://i.ebayimg.com/images/g/fallback/s-l1600.jpg",
  })
  assert.equal(parseEbayTradingGetItemPrimaryImage(xml, "999999999999").status, "ITEM_ID_MISMATCH")
  assert.equal(parseEbayTradingGetItemPrimaryImage(xml.replace("https://", "http://"), "123456789012").status, "MISSING")
})

test("runtime wiring requests image selectors and only fills the same certified listing", () => {
  const service = readFileSync(new URL("./ebay-commercial-monitor-live-readonly.ts", import.meta.url), "utf8")
  assert.match(service, /Item\.GalleryURL/)
  assert.match(service, /Item\.PictureDetails\.PictureURL/)
  assert.match(service, /parseEbayTradingGetItemPrimaryImage\(responseXml, input\.itemId\)/)
  assert.match(service, /certifications\.get\(listing\.itemId\)/)
  assert.doesNotMatch(service, /title.*primaryImageUrl/i)
})

export const COMMERCIAL_IMPROVEMENT_CONFIRMATION =
  "AUTORIZO APLICAR UNA MEJORA COMERCIAL EN EBAY"

function xmlEscape(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&apos;")
}

export function reviseActiveListingPriceRequestXml(input: {
  listingId: string
  price: number
  currency: string
}) {
  return "<?xml version=\"1.0\" encoding=\"utf-8\"?>" +
    "<ReviseFixedPriceItemRequest xmlns=\"urn:ebay:apis:eBLBaseComponents\">" +
    `<Item><ItemID>${input.listingId}</ItemID><StartPrice currencyID="${xmlEscape(input.currency)}">` +
    `${input.price.toFixed(2)}</StartPrice></Item></ReviseFixedPriceItemRequest>`
}

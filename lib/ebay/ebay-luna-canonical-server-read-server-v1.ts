import "server-only"

import {
  createSellerOsLunaCanonicalServerReadV1,
} from "./ebay-luna-canonical-server-read-v1"
import { fetchLunaAuthenticatedBrowserProductV1 } from
  "./ebay-luna-canonical-browser-worker-server-v1"

type LinkageLoader = Parameters<
  typeof createSellerOsLunaCanonicalServerReadV1
>[0]["loadLinkageById"]

/** Server composition only. Creating it performs no Luna request. */
export function createSellerOsProtectedLunaServerReadV1(input: Readonly<{
  loadLinkageById: LinkageLoader
  now?: () => string
}>) {
  return createSellerOsLunaCanonicalServerReadV1({
    loadLinkageById: input.loadLinkageById,
    readFixedProduct: fetchLunaAuthenticatedBrowserProductV1,
    now: input.now,
  })
}

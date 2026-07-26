import type { ReactNode } from "react"

import { SellerOsShell } from "./components/seller-os/seller-os-shell"

export default function AdminLayout({ children }: { children: ReactNode }) {
  const previewUxEnabled = process.env.VERCEL_ENV === "preview"
    ? process.env.SELLER_OS_UX_V2_ENABLED !== "false"
    : process.env.NODE_ENV !== "production" &&
      process.env.SELLER_OS_UX_V2_ENABLED === "true"

  return previewUxEnabled
    ? <SellerOsShell>{children}</SellerOsShell>
    : children
}

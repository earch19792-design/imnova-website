"use client"

import { usePathname } from "next/navigation"

import { SINGLE_PRODUCT_LAB_BANNER } from "@/lib/ebay/single-product-lab"

function isSellerOsPath(pathname: string) {
  return pathname === "/admin" ||
    pathname === "/admin/ebay-seller-os" ||
    pathname.startsWith("/admin/ebay/")
}

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const showPilotBanner = isSellerOsPath(pathname)
  return (
    <>
      {showPilotBanner && (
        <>
          <div aria-hidden="true" className="h-[4.5rem] sm:h-16" />
          <div
            role="status"
            aria-live="polite"
            className="fixed inset-x-3 top-3 z-[100] mx-auto max-w-4xl rounded-2xl border border-amber-200/60 bg-amber-100 px-4 py-3 text-center text-xs font-black tracking-wide text-black shadow-2xl sm:text-sm"
          >
            {SINGLE_PRODUCT_LAB_BANNER}
          </div>
        </>
      )}
      {children}
    </>
  )
}

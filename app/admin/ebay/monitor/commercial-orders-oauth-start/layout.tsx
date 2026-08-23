import type { Metadata } from "next"
import type { ReactNode } from "react"

export const metadata: Metadata = {
  referrer: "no-referrer",
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
}

export default function CommercialOrdersOAuthStartLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return children
}

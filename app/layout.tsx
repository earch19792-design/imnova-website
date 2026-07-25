import type { Metadata, Viewport } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: { default: "Seller OS", template: "%s | Seller OS" },
  description: "Plataforma privada de operación profesional para vendedores en marketplaces.",
  applicationName: "Seller OS",
  robots: { index: false, follow: false },
  referrer: "same-origin",
}

export const viewport: Viewport = { width: "device-width", initialScale: 1 }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning className="scroll-smooth">
      <body className="min-h-screen overflow-x-hidden bg-black font-sans text-white antialiased selection:bg-white selection:text-black">
        {children}
      </body>
    </html>
  )
}

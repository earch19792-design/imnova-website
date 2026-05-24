import type { Metadata } from "next"

import { Orbitron } from "next/font/google"

import { Analytics } from "@vercel/analytics/next"

import "./globals.css"

/* =================================================
FONT
================================================= */

const orbitron = Orbitron({
  subsets: ["latin"],
})

/* =================================================
GLOBAL SEO METADATA
================================================= */

export const metadata: Metadata = {

  metadataBase: new URL(
    "https://www.imnova.com"
  ),

  title: {

    default:
      "IMNOVA | Innovación Inteligente para el Bienestar del Futuro",

    template:
      "%s | IMNOVA",

  },

  description:
    "IMNOVA desarrolla tecnología futurista, nutrición funcional y productos inteligentes diseñados para impulsar una nueva generación de innovación, rendimiento y bienestar moderno.",

  applicationName:
    "IMNOVA",

  generator:
    "Next.js",

  referrer:
    "origin-when-cross-origin",

  keywords: [

    "IMNOVA",
    "innovación tecnológica",
    "tecnología inteligente",
    "wellness",
    "bienestar",
    "nutrición funcional",
    "productos inteligentes",
    "ecosistema futurista",
    "wellness technology",
    "Mash Coffee+",
    "café funcional",
    "alto rendimiento",
    "ecosistema wellness",
    "startup tecnológica",
    "innovación funcional",
    "AI ecosystem",
    "tecnología aplicada",
    "bienestar moderno",
    "productos premium",

  ],

  authors: [
    {
      name:
        "IMNOVA GROUP LLC",
    },
  ],

  creator:
    "IMNOVA GROUP LLC",

  publisher:
    "IMNOVA GROUP LLC",

  category:
    "Technology",

  classification:
    "Tecnología, Wellness, Nutrición Funcional e Innovación",

  openGraph: {

    title:
      "IMNOVA LABS",

    description:
      "Tecnología futurista para la próxima generación.",

    url:
      "https://www.imnova.com",

    siteName:
      "IMNOVA",

    locale:
      "es_US",

    type:
      "website",

  },

}

/* =================================================
ROOT LAYOUT
================================================= */

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {

  return (

    <html
      lang="es"
      suppressHydrationWarning
    >

      <body
        className={`
          ${orbitron.className}
          bg-black
          text-white
          antialiased
          overflow-x-hidden
          selection:bg-cyan-400
          selection:text-black
        `}
      >

        {/* GLOBAL BACKGROUND */}

        <div
          className="
            fixed
            inset-0
            -z-50
            bg-[radial-gradient(circle_at_top,#0f172a_0%,#000_45%)]
          "
        />

        {/* GRID EFFECT */}

        <div
          className="
            fixed
            inset-0
            -z-40
            opacity-[0.04]
            bg-[linear-gradient(rgba(0,255,255,0.2)_1px,transparent_1px),linear-gradient(90deg,rgba(0,255,255,0.2)_1px,transparent_1px)]
            bg-[size:40px_40px]
            pointer-events-none
          "
        />

        {/* CYAN GLOW */}

        <div
          className="
            fixed
            top-[-250px]
            left-1/2
            h-[500px]
            w-[500px]
            -translate-x-1/2
            rounded-full
            bg-cyan-400/10
            blur-3xl
            pointer-events-none
            -z-30
          "
        />

        {children}

        <Analytics />

      </body>

    </html>

  )

}
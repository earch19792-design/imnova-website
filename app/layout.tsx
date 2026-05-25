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
      className="
        scroll-smooth
      "
    >

      <body
        className={`
          ${orbitron.className}
          relative
          overflow-x-hidden
          bg-black
          text-white
          antialiased
          selection:bg-white
          selection:text-black
        `}
      >

        {/* =================================================
        GLOBAL BACKGROUND
        ================================================= */}

        <div
          className="
            fixed
            inset-0
            -z-50
            bg-black
          "
        />

        {/* =================================================
        CINEMATIC AMBIENT LIGHT
        ================================================= */}

        <div
          className="
            pointer-events-none
            fixed
            inset-0
            -z-40
            overflow-hidden
          "
        >

          {/* TOP LIGHT */}

          <div
            className="
              absolute
              left-1/2
              top-[-300px]
              h-[900px]
              w-[900px]
              -translate-x-1/2
              rounded-full
              bg-white/[0.035]
              blur-[180px]
            "
          />

          {/* LEFT LIGHT */}

          <div
            className="
              absolute
              left-[-200px]
              top-[25%]
              h-[500px]
              w-[500px]
              rounded-full
              bg-white/[0.02]
              blur-[140px]
            "
          />

          {/* RIGHT LIGHT */}

          <div
            className="
              absolute
              right-[-200px]
              bottom-[10%]
              h-[500px]
              w-[500px]
              rounded-full
              bg-white/[0.02]
              blur-[140px]
            "
          />

        </div>

        {/* =================================================
        PREMIUM GRID
        ================================================= */}

        <div
          className="
            pointer-events-none
            fixed
            inset-0
            -z-30
            opacity-[0.015]
            bg-[linear-gradient(rgba(255,255,255,0.10)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.10)_1px,transparent_1px)]
            bg-[size:120px_120px]
          "
        />

        {/* =================================================
        NOISE TEXTURE
        ================================================= */}

        <div
          className="
            pointer-events-none
            fixed
            inset-0
            -z-20
            opacity-[0.018]
            mix-blend-soft-light
            bg-[url('/noise.png')]
          "
        />

        {/* =================================================
        GLOBAL VIGNETTE
        ================================================= */}

        <div
          className="
            pointer-events-none
            fixed
            inset-0
            -z-10
            bg-[radial-gradient(circle_at_center,transparent_45%,rgba(0,0,0,0.85)_100%)]
          "
        />

        {/* =================================================
        MAIN CONTENT
        ================================================= */}

        <main
          className="
            relative
            z-10
          "
        >

          {children}

        </main>

        {/* =================================================
        ANALYTICS
        ================================================= */}

        <Analytics />

      </body>

    </html>

  )

}
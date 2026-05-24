import type { Metadata } from 'next'
import { Inter, Space_Grotesk } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import './app/globals.css'

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter"
})

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display"
})

export const metadata: Metadata = {
  title: 'IMNOVA | Ingeniería para el Futuro de la Vida Humana',

  description:
    'Tecnología, bienestar e innovación inteligente diseñados para elevar la vida moderna. Bebidas funcionales, tecnologías inteligentes y soluciones con IA.',

  generator: 'v0.app',

  keywords: [
    'innovation',
    'technology',
    'wellness',
    'AI',
    'smart home',
    'functional beverages',
    'IMNOVA'
  ],

  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },

      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },

      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],

    apple: '/apple-icon.png',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="es"
      data-scroll-behavior="smooth"
      className="bg-background"
    >
      <body
        className={`${inter.variable} ${spaceGrotesk.variable} font-sans antialiased`}
      >
        {children}

        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
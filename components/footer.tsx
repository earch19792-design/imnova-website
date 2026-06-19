"use client"

import Link from "next/link"
import { ArrowUpRight } from "lucide-react"

const footerLinks = [
  {
    name: "Inicio",
    href: "#hero",
  },
  {
    name: "Ideas",
    href: "#ideas",
  },
  {
    name: "Como funciona",
    href: "#como-funciona",
  },
  {
    name: "Beneficios",
    href: "#beneficios",
  },
  {
    name: "Tienda",
    href: "/store",
  },
  {
    name: "Privacidad",
    href: "/privacy-policy",
  },
  {
    name: "Terminos",
    href: "/terms",
  },
  {
    name: "Contacto",
    href: "/contact",
  },
]

export function Footer() {
  return (
    <footer className="relative overflow-hidden border-t border-stone-200 bg-[#f4efe6] px-6 py-14 text-stone-900 md:py-20">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(14,165,183,0.10),transparent_30%),radial-gradient(circle_at_90%_30%,rgba(245,158,11,0.10),transparent_28%)]" />

      <div className="relative z-10 mx-auto max-w-7xl">
        <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
          <div>
            <Link
              href="/"
              className="inline-flex items-center gap-4 rounded-2xl focus:outline-none focus:ring-2 focus:ring-cyan-500/60"
            >
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-stone-950 text-xl font-black text-white shadow-[0_18px_48px_rgba(15,23,42,0.16)]">
                I
              </div>

              <div>
                <div className="text-2xl font-black tracking-[-0.04em] text-stone-950">
                  IMNOVA
                </div>
                <div className="mt-1 text-[10px] font-black uppercase tracking-[0.22em] text-stone-500">
                  Comunidad que decide lo proximo
                </div>
              </div>
            </Link>

            <p className="mt-7 max-w-xl text-base leading-8 text-stone-600">
              IMNOVA convierte intereses reales de comunidad en ideas que se
              validan, se ajustan y pueden llegar al mercado como productos
              utiles.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="#comunidad"
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-stone-950 px-6 text-[12px] font-black uppercase tracking-[0.14em] text-white transition hover:-translate-y-0.5 hover:bg-cyan-700 focus:outline-none focus:ring-2 focus:ring-cyan-500/60"
              >
                Unirme gratis
                <ArrowUpRight className="h-4 w-4" />
              </Link>

              <Link
                href="#ideas"
                className="inline-flex min-h-12 items-center justify-center rounded-full border border-stone-200 bg-white/70 px-6 text-[12px] font-black uppercase tracking-[0.14em] text-stone-800 transition hover:bg-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
              >
                Votar ideas
              </Link>
            </div>
          </div>

          <div className="rounded-[28px] border border-stone-200 bg-white/60 p-5 shadow-[0_18px_55px_rgba(58,44,28,0.06)] backdrop-blur">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {footerLinks.map(link => (
                <Link
                  key={link.name}
                  href={link.href}
                  className="group inline-flex min-h-11 items-center justify-between rounded-2xl px-4 py-3 text-sm font-semibold text-stone-600 transition hover:bg-[#f8f4ec] hover:text-stone-950 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                >
                  <span>{link.name}</span>
                  <ArrowUpRight className="h-3.5 w-3.5 opacity-0 transition group-hover:opacity-100" />
                </Link>
              ))}
            </div>

            <div className="mt-5 border-t border-stone-200 pt-5">
              <Link
                href="/admin"
                className="inline-flex rounded-full border border-stone-200/70 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.16em] text-stone-400 transition hover:bg-white hover:text-stone-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
              >
                Acceso interno
              </Link>
            </div>
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-4 border-t border-stone-200 pt-6 text-sm text-stone-500 md:flex-row md:items-center md:justify-between">
          <p>
            (c) {new Date().getFullYear()} IMNOVA GROUP LLC. Todos los derechos
            reservados.
          </p>

          <div className="flex flex-wrap gap-3 text-xs font-semibold uppercase tracking-[0.14em] text-stone-400">
            <span>Wyoming LLC</span>
            <span>/</span>
            <span>Original ID 2025-001823496</span>
          </div>
        </div>
      </div>
    </footer>
  )
}

"use client"

import Link from "next/link"
import { useEffect, useState } from "react"

import { AnimatePresence, motion } from "framer-motion"
import { ArrowUpRight, Menu, X } from "lucide-react"

type NavigationProps = {
  onOpenCommunity?: () => void
}

const primaryNavItems = [
  {
    name: "Inicio",
    href: "#hero",
  },
  {
    name: "Votar ideas",
    href: "#ideas-activas",
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
]

const supportNavItems = [
  {
    name: "Mision y vision",
    href: "#mision-vision",
  },
  {
    name: "Contacto",
    href: "/contact",
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
    name: "Admin",
    href: "/admin",
  },
]

export function Navigation({
  onOpenCommunity,
}: NavigationProps) {
  const [isScrolled, setIsScrolled] = useState(false)
  const [isMenuOpen, setIsMenuOpen] = useState(false)

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 32)
    }

    handleScroll()
    window.addEventListener("scroll", handleScroll, { passive: true })

    return () => window.removeEventListener("scroll", handleScroll)
  }, [])

  useEffect(() => {
    if (!isMenuOpen) {
      return
    }

    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"

    return () => {
      document.body.style.overflow = originalOverflow
    }
  }, [isMenuOpen])

  const handleOpenCommunity = () => {
    setIsMenuOpen(false)
    onOpenCommunity?.()
  }

  const communityCtaClassName = `hidden min-h-11 items-center justify-center rounded-full px-5 text-[11px] font-black uppercase tracking-[0.14em] shadow-[0_14px_38px_rgba(15,23,42,0.18)] transition hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-cyan-500/60 sm:inline-flex ${
    isScrolled
      ? "bg-stone-950 text-white hover:bg-cyan-700"
      : "bg-cyan-200 text-stone-950 hover:bg-white"
  }`

  return (
    <motion.header
      initial={{
        y: -80,
        opacity: 0,
      }}
      animate={{
        y: 0,
        opacity: 1,
      }}
      transition={{
        duration: 0.55,
        ease: [0.22, 1, 0.36, 1],
      }}
      className="fixed left-1/2 top-3 z-50 w-full max-w-[1440px] -translate-x-1/2 px-3 sm:px-5"
    >
      <div
        className={`relative overflow-hidden rounded-[24px] border transition-all duration-300 ${
          isScrolled
            ? "border-stone-200/80 bg-[#fbf7ef]/92 shadow-[0_18px_55px_rgba(58,44,28,0.12)] backdrop-blur-2xl"
            : "border-white/12 bg-stone-950/58 shadow-[0_18px_58px_rgba(0,0,0,0.24)] backdrop-blur-2xl"
        }`}
      >
        <div className="relative z-10 grid grid-cols-[auto_1fr_auto] items-center gap-3 px-3 py-3 md:px-4">
          <Link
            href="#hero"
            className="flex min-w-0 items-center gap-3 rounded-2xl pr-2 focus:outline-none focus:ring-2 focus:ring-cyan-500/60"
            onClick={() => setIsMenuOpen(false)}
          >
            <div
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-base font-black shadow-[0_12px_35px_rgba(15,23,42,0.18)] ${
                isScrolled
                  ? "bg-stone-950 text-white"
                  : "bg-white text-stone-950"
              }`}
            >
              I
            </div>

            <div className="hidden min-w-0 sm:block">
              <div
                className={`text-base font-black tracking-[-0.04em] ${
                  isScrolled ? "text-stone-950" : "text-white"
                }`}
              >
                IMNOVA
              </div>
              <div
                className={`mt-0.5 whitespace-nowrap text-[8px] font-bold uppercase tracking-[0.22em] ${
                  isScrolled ? "text-stone-500" : "text-white/48"
                }`}
              >
                Comunidad que decide
              </div>
            </div>
          </Link>

          <nav
            aria-label="Principal"
            className="hidden items-center justify-center gap-1 lg:flex"
          >
            {primaryNavItems.map(item => (
              <Link
                key={item.name}
                href={item.href}
                className={`rounded-full px-3 py-2.5 text-[11px] font-black uppercase tracking-[0.14em] transition focus:outline-none focus:ring-2 focus:ring-cyan-500/50 xl:px-4 ${
                  isScrolled
                    ? "text-stone-600 hover:bg-white/75 hover:text-stone-950"
                    : "text-white/62 hover:bg-white/10 hover:text-white"
                }`}
              >
                {item.name}
              </Link>
            ))}
          </nav>

          <div className="flex items-center justify-end gap-2">
            {onOpenCommunity ? (
              <button
                type="button"
                onClick={handleOpenCommunity}
                className={communityCtaClassName}
              >
                Unirme gratis
              </button>
            ) : (
              <Link
                href="#comunidad"
                className={communityCtaClassName}
              >
                Unirme gratis
              </Link>
            )}

            <button
              type="button"
              aria-label={isMenuOpen ? "Cerrar menu" : "Abrir menu"}
              aria-expanded={isMenuOpen}
              onClick={() => setIsMenuOpen(current => !current)}
              className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border transition focus:outline-none focus:ring-2 focus:ring-cyan-500/60 ${
                isScrolled
                  ? "border-stone-200 bg-white/75 text-stone-950 hover:bg-white"
                  : "border-white/15 bg-white/10 text-white hover:bg-white/16"
              }`}
            >
              {isMenuOpen ? (
                <X className="h-5 w-5" />
              ) : (
                <Menu className="h-5 w-5" />
              )}
            </button>
          </div>
        </div>

        <AnimatePresence>
          {isMenuOpen && (
            <motion.div
              initial={{
                opacity: 0,
                y: -8,
              }}
              animate={{
                opacity: 1,
                y: 0,
              }}
              exit={{
                opacity: 0,
                y: -8,
              }}
              transition={{
                duration: 0.2,
              }}
              role="dialog"
              aria-label="Menu principal"
              className="relative z-20 border-t border-stone-200/80 bg-[#fbf7ef]/96 px-4 py-4"
            >
              <div className="grid gap-2 sm:grid-cols-2 lg:hidden">
                {primaryNavItems.map(item => (
                  <Link
                    key={item.name}
                    href={item.href}
                    onClick={() => setIsMenuOpen(false)}
                    className="min-h-12 rounded-2xl border border-stone-200 bg-white/70 px-5 py-4 text-[12px] font-black uppercase tracking-[0.14em] text-stone-800 transition hover:bg-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                  >
                    {item.name}
                  </Link>
                ))}
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                {supportNavItems.map(item => (
                  <Link
                    key={item.name}
                    href={item.href}
                    onClick={() => setIsMenuOpen(false)}
                    className={`min-h-11 rounded-2xl border px-4 py-3 text-[11px] font-bold uppercase tracking-[0.13em] transition focus:outline-none focus:ring-2 focus:ring-cyan-500/50 ${
                      item.name === "Admin"
                        ? "border-stone-200/60 bg-transparent text-stone-400 hover:bg-white/60 hover:text-stone-600"
                        : "border-stone-200 bg-white/55 text-stone-600 hover:bg-white hover:text-stone-900"
                    }`}
                  >
                    {item.name}
                  </Link>
                ))}
              </div>

              {onOpenCommunity ? (
                <button
                  type="button"
                  onClick={handleOpenCommunity}
                  className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-stone-950 px-5 text-[12px] font-black uppercase tracking-[0.14em] text-white transition hover:bg-cyan-700 focus:outline-none focus:ring-2 focus:ring-cyan-500/60"
                >
                  Unirme gratis
                  <ArrowUpRight className="h-4 w-4" />
                </button>
              ) : (
                <Link
                  href="#comunidad"
                  onClick={() => setIsMenuOpen(false)}
                  className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-stone-950 px-5 text-[12px] font-black uppercase tracking-[0.14em] text-white transition hover:bg-cyan-700 focus:outline-none focus:ring-2 focus:ring-cyan-500/60"
                >
                  Unirme gratis
                  <ArrowUpRight className="h-4 w-4" />
                </Link>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.header>
  )
}

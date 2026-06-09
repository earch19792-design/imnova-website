"use client"

import Link from "next/link"
import {
  useEffect,
  useState,
} from "react"

import {
  AnimatePresence,
  motion,
} from "framer-motion"

import {
  Menu,
  X,
} from "lucide-react"

const navItems = [
  {
    name: "Inicio",
    href: "#hero",
  },
  {
    name: "Disponible ahora",
    href: "#available-now",
  },
  {
    name: "Viene pronto",
    href: "#innovations",
  },
  {
    name: "Ecosistema",
    href: "#working",
  },
  {
    name: "Fases",
    href: "#pipeline",
  },
  {
    name: "Donde comprar",
    href: "#where-to-buy",
  },
  {
    name: "Contacto",
    href: "#contact",
  },
]

const desktopNavItems =
  navItems.filter(
    item => item.name !== "Contacto"
  )

export function Navigation() {
  const [
    isScrolled,
    setIsScrolled,
  ] = useState(false)

  const [
    isMenuOpen,
    setIsMenuOpen,
  ] = useState(false)

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 40)
    }

    handleScroll()

    window.addEventListener(
      "scroll",
      handleScroll
    )

    return () =>
      window.removeEventListener(
        "scroll",
        handleScroll
      )
  }, [])

  return (
    <motion.header
      initial={{
        y: -120,
        opacity: 0,
      }}
      animate={{
        y: 0,
        opacity: 1,
      }}
      transition={{
        duration: 0.9,
        ease: [0.22, 1, 0.36, 1],
      }}
      className="fixed left-1/2 top-4 z-50 w-full max-w-[1440px] -translate-x-1/2 px-4 sm:px-6"
    >
      <div
        className={`
          relative
          overflow-hidden
          rounded-[26px]
          border
          border-white/10
          transition-all
          duration-500
          ${
            isScrolled
              ? "bg-black/78 shadow-[0_10px_60px_rgba(0,0,0,0.45)] backdrop-blur-2xl"
              : "bg-black/42 backdrop-blur-xl"
          }
        `}
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.04),transparent_60%)]" />
        <div className="pointer-events-none absolute inset-0 opacity-[0.015] bg-[url('/noise.png')]" />

        <div className="relative z-10 grid grid-cols-[auto_1fr_auto] items-center gap-4 px-4 py-3 lg:gap-6 lg:px-5">
          <Link
            href="#hero"
            className="flex min-w-0 shrink-0 items-center gap-3"
          >
            <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05]">
              <span className="text-base font-black text-white">
                I
              </span>
            </div>

            <div className="hidden min-w-0 sm:block">
              <div className="text-[1.05rem] font-black tracking-[-0.035em] text-white">
                IMNOVA
              </div>
              <div className="mt-1 max-w-[210px] truncate text-[8px] uppercase tracking-[0.28em] text-white/45">
                Tecnologia · Nutricion · Bienestar
              </div>
            </div>
          </Link>

          <nav className="hidden min-w-0 items-center justify-center gap-1 overflow-hidden xl:flex 2xl:gap-2">
            {desktopNavItems.map(item => (
              <Link
                key={item.name}
                href={item.href}
                className="whitespace-nowrap rounded-full px-2.5 py-2 text-[9px] font-medium uppercase tracking-[0.14em] text-white/68 transition-all duration-300 hover:bg-white/[0.05] hover:text-white 2xl:px-3 2xl:text-[10px]"
              >
                {item.name === "Disponible ahora"
                  ? "Disponible"
                  : item.name}
              </Link>
            ))}
          </nav>

          <div className="flex shrink-0 items-center justify-end gap-2">
            <Link
              href="/store"
              className="hidden whitespace-nowrap rounded-2xl border border-cyan-300/20 bg-cyan-400/10 px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-100 transition-all duration-300 hover:border-cyan-300/35 hover:bg-cyan-400/20 hover:text-white sm:inline-flex"
            >
              Tienda
            </Link>

            <Link
              href="/admin"
              className="hidden whitespace-nowrap rounded-2xl border border-white/10 bg-white/[0.015] px-4 py-3 text-[10px] font-medium uppercase tracking-[0.18em] text-white/45 transition-all duration-300 hover:border-white/20 hover:bg-white/[0.06] hover:text-white md:inline-flex"
            >
              Admin
            </Link>

            <motion.button
              type="button"
              aria-label="Abrir menu"
              aria-expanded={isMenuOpen}
              whileTap={{
                scale: 0.96,
              }}
              onClick={() =>
                setIsMenuOpen(
                  current => !current
                )
              }
              className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white/[0.035] p-3 text-white transition hover:bg-white/[0.07] xl:hidden"
            >
              {isMenuOpen ? (
                <X className="h-5 w-5" />
              ) : (
                <Menu className="h-5 w-5" />
              )}
            </motion.button>
          </div>
        </div>

        <AnimatePresence>
          {isMenuOpen && (
            <motion.div
              initial={{
                opacity: 0,
                y: -10,
              }}
              animate={{
                opacity: 1,
                y: 0,
              }}
              exit={{
                opacity: 0,
                y: -10,
              }}
              transition={{
                duration: 0.25,
              }}
              className="relative z-20 border-t border-white/10 px-5 py-5 xl:hidden"
            >
              <div className="grid gap-3 sm:grid-cols-2">
                {navItems.map(item => (
                  <Link
                    key={item.name}
                    href={item.href}
                    onClick={() =>
                      setIsMenuOpen(false)
                    }
                    className="rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-4 text-[11px] font-semibold uppercase tracking-[0.20em] text-white/75 transition hover:bg-white/[0.06] hover:text-white"
                  >
                    {item.name}
                  </Link>
                ))}

              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.header>
  )
}

"use client"

import { useState, useEffect } from "react"

import {
  motion,
  AnimatePresence,
} from "framer-motion"

import {
  Menu,
  X,
  ChevronDown,
  Sparkles,
} from "lucide-react"

import Link from "next/link"

const navItems = [
  { name: "Inicio", href: "#hero" },
  { name: "Ecosistema", href: "#ecosystem" },
  { name: "Innovaciones", href: "#innovations" },
  { name: "Tecnología", href: "#technology" },
  { name: "Nutrición", href: "#nutrition" },
  { name: "Contacto", href: "/contact" },
]

const categoryLinks = [
  {
    name: "Bebidas Nutricionales",
    href: "/store#bebidas-nutricionales",
  },
  {
    name: "Alimentos Nutricionales",
    href: "/store#alimentos-nutricionales",
  },
]

export function Navigation() {

  const [isScrolled, setIsScrolled] =
    useState(false)

  const [isMenuOpen, setIsMenuOpen] =
    useState(false)

  useEffect(() => {

    const handleScroll = () => {
      setIsScrolled(window.scrollY > 40)
    }

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

  /* =================================================
  IMNOVA LABS
  ================================================= */

  const handleInnovaLabs =
    () => {

      window.location.href =
        "/admin"

    }

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
        duration: 1.2,
        ease: [0.22, 1, 0.36, 1],
      }}
      className="
        fixed
        top-5
        left-1/2
        z-50
        w-full
        max-w-6xl
        -translate-x-1/2
        px-4
      "
    >

      <div
        className={`
          relative
          overflow-hidden
          rounded-[30px]
          border
          border-white/10
          transition-all
          duration-500

          ${
            isScrolled
              ? `
                bg-black/72
                backdrop-blur-2xl
                shadow-[0_10px_60px_rgba(0,0,0,0.45)]
              `
              : `
                bg-black/38
                backdrop-blur-xl
              `
          }
        `}
      >

        {/* =========================================
        SOFT LIGHT
        ========================================= */}

        <div
          className="
            pointer-events-none
            absolute
            inset-0
            bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.04),transparent_60%)]
          "
        />

        {/* =========================================
        NOISE
        ========================================= */}

        <div
          className="
            pointer-events-none
            absolute
            inset-0
            opacity-[0.015]
            bg-[url('/noise.png')]
          "
        />

        {/* =========================================
        MAIN NAV
        ========================================= */}

        <div
          className="
            relative
            z-10
            flex
            items-center
            justify-between
            px-4
            py-4
            md:px-6
            lg:px-8
          "
        >

          {/* =========================================
          LEFT
          ========================================= */}

          <div className="flex items-center gap-5">

            <Link
              href="#hero"
              className="relative z-20"
            >

              <motion.div
                whileHover={{
                  scale: 1.02,
                }}
                transition={{
                  duration: 0.3,
                }}
                className="
                  flex
                  items-center
                  gap-4
                "
              >

                {/* =========================================
                LOGO
                ========================================= */}

                <div className="relative">

                  <div
                    className="
                      absolute
                      inset-0
                      rounded-2xl
                      bg-white/[0.08]
                      blur-xl
                    "
                  />

                  <div
                    className="
                      relative
                      flex
                      h-11
                      w-11
                      items-center
                      justify-center
                      rounded-2xl
                      border
                      border-white/10
                      bg-white/[0.05]
                      backdrop-blur-xl
                    "
                  >

                    <span
                      className="
                        text-lg
                        font-black
                        text-white
                      "
                    >

                      I

                    </span>

                  </div>

                </div>

                {/* =========================================
                TEXT
                ========================================= */}

                <div className="hidden sm:block">

                  <h1
                    className="
                      text-[1.15rem]
                      font-black
                      tracking-[-0.045em]
                      text-white
                    "
                  >

                    IMNOVA

                  </h1>

                  <p
                    className="
                      mt-1
                      text-[8px]
                      uppercase
                      tracking-[0.30em]
                      text-white/45
                    "
                  >

                    TECNOLOGÍA • NUTRICIÓN • BIENESTAR

                  </p>

                </div>

              </motion.div>

            </Link>

          </div>

          {/* =========================================
          RIGHT
          ========================================= */}

          <div className="flex items-center gap-3">

            {/* =========================================
            IMNOVA LABS BUTTON
            ========================================= */}

            <motion.button
              whileHover={{
                scale: 1.02,
              }}
              whileTap={{
                scale: 0.98,
              }}
              onClick={handleInnovaLabs}
              className="
                relative
                z-50
                flex
                items-center
                gap-2
                rounded-2xl
                border
                border-white/10
                bg-white/[0.03]
                px-4
                py-3
                text-[10px]
                uppercase
                tracking-[0.28em]
                font-medium
                text-white/70
                backdrop-blur-xl
                transition-all
                duration-300
                hover:border-white/20
                hover:bg-white/[0.06]
                hover:text-white
                whitespace-nowrap
              "
            >

              <Sparkles className="h-4 w-4" />

              <span className="hidden sm:block">
                IMNOVA LABS
              </span>

            </motion.button>

            {/* =========================================
            MENU BUTTON
            ========================================= */}

            <motion.button
              whileHover={{
                scale: 1.03,
              }}
              whileTap={{
                scale: 0.97,
              }}
              onClick={() =>
                setIsMenuOpen(!isMenuOpen)
              }
              className="
                flex
                items-center
                gap-3
                rounded-2xl
                border
                border-white/10
                bg-white/[0.03]
                px-5
                py-3
                backdrop-blur-xl
                transition-all
                duration-300
                hover:border-white/20
                hover:bg-white/[0.06]
              "
            >

              <span
                className="
                  hidden
                  sm:block
                  text-[10px]
                  uppercase
                  tracking-[0.30em]
                  text-white/70
                "
              >

                MENU

              </span>

              {isMenuOpen ? (
                <X className="h-5 w-5 text-white" />
              ) : (
                <Menu className="h-5 w-5 text-white" />
              )}

            </motion.button>

          </div>

        </div>

        {/* =========================================
        MOBILE MENU
        ========================================= */}

        <AnimatePresence>

          {isMenuOpen && (

            <motion.div
              initial={{
                opacity: 0,
                y: -20,
                filter: "blur(10px)",
              }}
              animate={{
                opacity: 1,
                y: 0,
                filter: "blur(0px)",
              }}
              exit={{
                opacity: 0,
                y: -20,
                filter: "blur(10px)",
              }}
              transition={{
                duration: 0.45,
                ease: [0.22, 1, 0.36, 1],
              }}
              className="
                relative
                z-[999]
                border-t
                border-white/10
                px-6
                py-8
              "
            >

              <div className="grid gap-10 lg:grid-cols-2">

                {/* =========================================
                LINKS
                ========================================= */}

                <div className="flex flex-col gap-5">

                  {navItems.map(
                    (item, index) => (

                    <motion.div
                      key={item.name}
                      initial={{
                        opacity: 0,
                        x: -20,
                      }}
                      animate={{
                        opacity: 1,
                        x: 0,
                      }}
                      transition={{
                        delay:
                          index * 0.05,
                      }}
                    >

                      <Link
                        href={item.href}
                        onClick={() =>
                          setIsMenuOpen(false)
                        }
                        className="
                          group
                          relative
                          w-fit
                          text-[13px]
                          uppercase
                          tracking-[0.30em]
                          text-white/70
                          transition-all
                          duration-300
                          hover:text-white
                        "
                      >

                        {item.name}

                        <span
                          className="
                            absolute
                            -bottom-1
                            left-0
                            h-px
                            w-0
                            bg-white/60
                            transition-all
                            duration-300
                            group-hover:w-full
                          "
                        />

                      </Link>

                    </motion.div>

                  ))}

                </div>

                {/* =========================================
                STORE
                ========================================= */}

                <div className="flex flex-col gap-4">

                  <div
                    className="
                      mb-2
                      text-[10px]
                      uppercase
                      tracking-[0.35em]
                      text-white/40
                    "
                  >

                    TIENDA

                  </div>

                  {categoryLinks.map(
                    (item) => (

                    <Link
                      key={item.name}
                      href={item.href}
                      className="
                        group
                        rounded-[24px]
                        border
                        border-white/10
                        bg-white/[0.03]
                        px-6
                        py-5
                        text-white
                        transition-all
                        duration-300
                        hover:border-white/20
                        hover:bg-white/[0.06]
                      "
                    >

                      <div className="flex items-center justify-between">

                        <span className="text-white/80">
                          {item.name}
                        </span>

                        <ChevronDown
                          className="
                            h-4
                            w-4
                            rotate-[-90deg]
                            text-white/50
                            transition-transform
                            duration-300
                            group-hover:translate-x-1
                          "
                        />

                      </div>

                    </Link>

                  ))}

                </div>

              </div>

            </motion.div>

          )}

        </AnimatePresence>

      </div>

    </motion.header>
  )
}
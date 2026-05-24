"use client"

import { useState, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"

import {
  Menu,
  X,
  ChevronDown,
  Sparkles,
} from "lucide-react"

import Link from "next/link"

import { products }
from "@/data/products"

/* =================================================
NAVIGATION LINKS
================================================= */

const navItems = [
  { name: "Inicio", href: "#hero" },
  { name: "Nosotros", href: "#about" },
  { name: "Ecosistema", href: "#ecosystem" },
  { name: "Innovaciones", href: "#innovations" },
  { name: "Tecnología", href: "#technology" },
  { name: "Contacto", href: "#contact" },
]

/* =================================================
STORE LINKS
================================================= */

const storeLinks = [
  {
    name: "Bebidas Nutricionales",
    href: "/store#bebidas",
  },

  {
    name: "Alimentos Nutricionales",
    href: "/store#alimentos",
  },

  {
    name: "Suplementos Wellness",
    href: "/store#wellness",
  },
]

/* =================================================
COMPONENT
================================================= */

export function Navigation() {

  const [isScrolled, setIsScrolled] =
    useState(false)

  const [isMobileMenuOpen, setIsMobileMenuOpen] =
    useState(false)

  const [isStoreOpen, setIsStoreOpen] =
    useState(false)

  /* =================================================
  SCROLL DETECTION
  ================================================= */

  useEffect(() => {

    const handleScroll = () => {

      setIsScrolled(
        window.scrollY > 50
      )

    }

    window.addEventListener(
      "scroll",
      handleScroll
    )

    return () => {

      window.removeEventListener(
        "scroll",
        handleScroll
      )

    }

  }, [])

  return (
    <motion.header
      initial={{
        y: -100,
        opacity: 0,
      }}
      animate={{
        y: 0,
        opacity: 1,
      }}
      transition={{
        duration: 0.8,
        ease: "easeOut",
      }}
      className={`
        fixed
        top-0
        left-0
        right-0
        z-50
        transition-all
        duration-500

        ${
          isScrolled
            ? "py-4"
            : "py-6"
        }
      `}
    >

      <div className="mx-auto max-w-7xl px-6">

        <div
          className={`
            relative
            overflow-visible
            rounded-full
            border
            border-white/10
            transition-all
            duration-500

            ${
              isScrolled
                ? `
                  bg-black/60
                  backdrop-blur-3xl
                  shadow-[0_0_80px_rgba(0,255,255,0.06)]
                `
                : `
                  bg-black/30
                  backdrop-blur-2xl
                `
            }
          `}
        >

          {/* Glow */}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-cyan-400/[0.03] via-transparent to-blue-500/[0.03]" />

          {/* Noise */}
          <div className="pointer-events-none absolute inset-0 opacity-[0.02] bg-[url('/noise.png')]" />

          <div
            className="
              relative
              z-10
              flex
              items-center
              justify-between
              px-6
              py-4
              lg:px-8
            "
          >

            {/* =================================================
            LOGO
            ================================================= */}

            <Link
              href="#hero"
              className="relative z-20"
            >

              <motion.div
                whileHover={{
                  scale: 1.05,
                }}
                className="flex items-center gap-3"
              >

                <div className="relative">

                  <div className="absolute inset-0 rounded-2xl bg-cyan-400/20 blur-2xl" />

                  <div
                    className="
                      relative
                      flex
                      h-11
                      w-11
                      items-center
                      justify-center
                      rounded-2xl
                      bg-gradient-to-br
                      from-cyan-400
                      to-blue-500
                      shadow-[0_0_40px_rgba(0,255,255,0.25)]
                    "
                  >

                    <span className="text-xl font-black text-white">
                      I
                    </span>

                  </div>

                </div>

                <div>

                  <h1
                    className="
                      text-xl
                      font-black
                      tracking-[-0.04em]
                      text-white
                    "
                  >

                    IMNOVA

                  </h1>

                  <p
                    className="
                      text-[10px]
                      uppercase
                      tracking-[0.35em]
                      text-cyan-300
                    "
                  >

                    Innovation Ecosystem

                  </p>

                </div>

              </motion.div>

            </Link>

            {/* =================================================
            DESKTOP NAVIGATION
            ================================================= */}

            <nav
              className="
                hidden
                lg:flex
                items-center
                gap-10
              "
            >

              {navItems.map((item) => (

                <Link
                  key={item.name}
                  href={item.href}
                  className="
                    group
                    relative
                    text-sm
                    font-medium
                    tracking-[0.02em]
                    text-zinc-300
                    transition-all
                    duration-300
                    hover:text-cyan-200
                    hover:drop-shadow-[0_0_12px_rgba(0,255,255,0.5)]
                  "
                >

                  {item.name}

                  <span
                    className="
                      absolute
                      -bottom-2
                      left-0
                      h-px
                      w-0
                      bg-cyan-300
                      transition-all
                      duration-300
                      group-hover:w-full
                    "
                  />

                </Link>

              ))}

              {/* STORE */}
              <div
                className="relative"
                onMouseEnter={() =>
                  setIsStoreOpen(true)
                }
                onMouseLeave={() =>
                  setIsStoreOpen(false)
                }
              >

                <button
                  className="
                    flex
                    items-center
                    gap-2
                    text-sm
                    font-medium
                    tracking-[0.02em]
                    text-zinc-300
                    transition-all
                    duration-300
                    hover:text-cyan-200
                  "
                >

                  Tienda

                  <ChevronDown
                    className={`
                      h-4
                      w-4
                      transition-transform
                      duration-300

                      ${
                        isStoreOpen
                          ? "rotate-180"
                          : ""
                      }
                    `}
                  />

                </button>

                <AnimatePresence>

                  {isStoreOpen && (

                    <motion.div
                      initial={{
                        opacity: 0,
                        y: 10,
                        scale: 0.98,
                      }}
                      animate={{
                        opacity: 1,
                        y: 0,
                        scale: 1,
                      }}
                      exit={{
                        opacity: 0,
                        y: 10,
                        scale: 0.98,
                      }}
                      transition={{
                        duration: 0.25,
                      }}
                      className="
                        absolute
                        right-0
                        top-full
                        z-[999]
                        mt-4
                        w-80
                        overflow-hidden
                        rounded-[36px]
                        border
                        border-cyan-400/20
                        bg-black/70
                        p-5
                        backdrop-blur-3xl
                        shadow-[0_0_100px_rgba(0,255,255,0.10)]
                      "
                    >

                      <div className="absolute inset-0 bg-gradient-to-br from-cyan-400/[0.05] via-transparent to-transparent" />

                      <div className="relative z-10">

                        <div className="mb-5">

                          <p
                            className="
                              text-xs
                              uppercase
                              tracking-[0.35em]
                              text-cyan-300
                            "
                          >

                            IMNOVA STORE

                          </p>

                          <h3
                            className="
                              mt-3
                              text-2xl
                              font-black
                              tracking-[-0.03em]
                              text-white
                            "
                          >

                            Ecosistema Comercial

                          </h3>

                        </div>

                        <div className="flex flex-col gap-3">

                          {storeLinks.map((item) => (

                            <Link
                              key={item.name}
                              href={item.href}
                              className="
                                group
                                rounded-2xl
                                border
                                border-cyan-400/10
                                bg-white/[0.04]
                                px-5
                                py-4
                                transition-all
                                duration-300
                                hover:border-cyan-300/40
                                hover:bg-white/[0.08]
                                hover:translate-x-1
                              "
                            >

                              <div className="flex items-center justify-between">

                                <span className="text-sm font-medium text-white">

                                  {item.name}

                                </span>

                                <span
                                  className="
                                    text-cyan-300
                                    transition-transform
                                    duration-300
                                    group-hover:translate-x-1
                                  "
                                >

                                  →

                                </span>

                              </div>

                            </Link>

                          ))}

                        </div>

                      </div>

                    </motion.div>

                  )}

                </AnimatePresence>

              </div>

            </nav>

            {/* =================================================
            CTA BUTTON
            ================================================= */}

            <div className="hidden lg:block">

              <motion.button
                whileHover={{
                  scale: 1.03,
                }}
                whileTap={{
                  scale: 0.98,
                }}
                onClick={async () => {

                  try {

                    const currentProduct =
                      products[0]

                    const response =
                      await fetch(
                        "/api/innova-lab",
                        {
                          method: "POST",

                          headers: {
                            "Content-Type":
                              "application/json",
                          },

                          body: JSON.stringify({
                            product:
                              currentProduct.name,

                            status:
                              currentProduct.status,

                            progress:
                              currentProduct.progress,
                          }),
                        }
                      )

                    const data =
                      await response.json()

                    if (data.success) {

                      alert(
                        "WhatsApp enviado correctamente 🚀"
                      )

                    } else {

                      alert(
                        "Error enviando WhatsApp"
                      )

                    }

                  } catch (error) {

                    console.error(error)

                    alert(
                      "Error de conexión"
                    )

                  }

                }}
                className="
                  flex
                  items-center
                  gap-2
                  rounded-full
                  bg-gradient-to-r
                  from-cyan-400
                  to-blue-500
                  px-6
                  py-3
                  text-sm
                  font-bold
                  text-black
                  shadow-[0_0_40px_rgba(0,255,255,0.20)]
                  transition-all
                  duration-300
                  hover:shadow-[0_0_70px_rgba(0,255,255,0.35)]
                "
              >

                <Sparkles className="h-4 w-4" />

                IMNOVA LABS

              </motion.button>

            </div>

            {/* MOBILE BUTTON */}

            <button
              onClick={() =>
                setIsMobileMenuOpen(
                  !isMobileMenuOpen
                )
              }
              className="
                lg:hidden
                relative
                z-20
                rounded-xl
                border
                border-white/10
                bg-white/[0.04]
                p-3
                backdrop-blur-xl
              "
            >

              {isMobileMenuOpen ? (
                <X
                  size={24}
                  className="text-white"
                />
              ) : (
                <Menu
                  size={24}
                  className="text-white"
                />
              )}

            </button>

          </div>

        </div>

      </div>

    </motion.header>
  )
}
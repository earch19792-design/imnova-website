"use client"

import { motion } from "framer-motion"
import Link from "next/link"
import { ArrowUpRight } from "lucide-react"

const footerLinks = {
  explore: [
    {
      name: "Mision y vision",
      href: "#mision-vision",
    },
    {
      name: "Como funciona",
      href: "#como-funciona",
    },
    {
      name: "Ideas en votacion",
      href: "#ideas",
    },
    {
      name: "Beneficios",
      href: "#beneficios",
    },
    {
      name: "Comunidad",
      href: "#comunidad",
    },
  ],
  community: [
    {
      name: "Unirme gratis",
      href: "#comunidad",
    },
    {
      name: "Votar ideas",
      href: "#ideas",
    },
    {
      name: "Sobre nosotros",
      href: "/about",
    },
    {
      name: "Tienda",
      href: "/store",
    },
  ],
  access: [
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
  ],
}

export function Footer() {
  const linkGroups = [
    {
      title: "Explorar",
      links: footerLinks.explore,
    },
    {
      title: "Comunidad",
      links: footerLinks.community,
    },
    {
      title: "Accesos",
      links: footerLinks.access,
    },
  ]

  return (
    <footer className="relative overflow-hidden border-t border-white/10 bg-black px-6 py-16 text-white md:py-20">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(34,211,238,0.12),transparent_32%),radial-gradient(circle_at_90%_30%,rgba(251,191,36,0.08),transparent_30%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.02] bg-[linear-gradient(rgba(255,255,255,0.18)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.18)_1px,transparent_1px)] bg-[size:88px_88px]" />

      <div className="relative z-10 mx-auto max-w-7xl">
        <div className="grid gap-10 lg:grid-cols-[1.1fr_1.4fr] lg:items-start">
          <div>
            <Link href="/">
              <motion.div
                whileHover={{
                  scale: 1.02,
                }}
                className="inline-flex items-center gap-4"
              >
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-cyan-200/15 bg-cyan-300/[0.08] shadow-[0_0_45px_rgba(34,211,238,0.12)]">
                  <span className="text-xl font-black text-white">
                    I
                  </span>
                </div>

                <div>
                  <div className="text-2xl font-black tracking-[-0.04em]">
                    IMNOVA
                  </div>
                  <div className="mt-1 text-[10px] uppercase tracking-[0.26em] text-cyan-100/55">
                    Comunidad que decide lo proximo
                  </div>
                </div>
              </motion.div>
            </Link>

            <p className="mt-8 max-w-xl text-base leading-8 text-zinc-400">
              IMNOVA une comunidad, ideas y beneficios para crear productos
              que nacen desde intereses reales, no desde suposiciones.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="#comunidad"
                className="inline-flex items-center gap-3 rounded-2xl border border-cyan-200/20 bg-cyan-300/[0.10] px-5 py-4 text-xs font-black uppercase tracking-[0.16em] text-cyan-50 transition hover:border-cyan-200/40 hover:bg-cyan-300/[0.16]"
              >
                Unirme gratis
                <ArrowUpRight className="h-4 w-4" />
              </Link>

              <Link
                href="#ideas"
                className="inline-flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.035] px-5 py-4 text-xs font-black uppercase tracking-[0.16em] text-white/70 transition hover:bg-white/[0.07] hover:text-white"
              >
                Votar ideas
              </Link>
            </div>
          </div>

          <div className="grid gap-5 sm:grid-cols-3">
            {linkGroups.map(group => (
              <div
                key={group.title}
                className="rounded-2xl border border-white/10 bg-white/[0.025] p-5 backdrop-blur-xl"
              >
                <h4 className="text-[10px] font-black uppercase tracking-[0.24em] text-cyan-100/60">
                  {group.title}
                </h4>

                <ul className="mt-5 space-y-3">
                  {group.links.map(link => (
                    <li key={link.name}>
                      <Link
                        href={link.href}
                        className={`group inline-flex items-center gap-2 text-sm transition hover:text-white ${
                          link.name === "Admin"
                            ? "text-zinc-700 hover:text-zinc-400"
                            : "text-zinc-400"
                        }`}
                      >
                        <span>{link.name}</span>
                        <ArrowUpRight className="h-3.5 w-3.5 opacity-0 transition group-hover:opacity-100" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-5 border-t border-white/10 pt-6 text-sm text-zinc-500 md:flex-row md:items-center md:justify-between">
          <p>
            © {new Date().getFullYear()} IMNOVA GROUP LLC. Todos los derechos
            reservados.
          </p>

          <div className="flex flex-wrap gap-3 text-xs uppercase tracking-[0.16em]">
            <span>Wyoming LLC</span>
            <span className="text-zinc-700">/</span>
            <span>Original ID 2025-001823496</span>
          </div>
        </div>
      </div>
    </footer>
  )
}

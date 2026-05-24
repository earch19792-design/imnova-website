"use client"

import { motion } from "framer-motion"
import Link from "next/link"

const footerLinks = {
  tienda: [
    { name: "Bebidas Funcionales", href: "#" },
    { name: "Tecnología Inteligente", href: "#" },
    { name: "Bienestar", href: "#" },
  ],

  empresa: [
    { name: "Sobre Nosotros", href: "#about" },
    { name: "Innovaciones", href: "#innovations" },
    { name: "Contacto", href: "#contact" },
  ],

  legal: [
    { name: "Privacidad", href: "#" },
    { name: "Términos", href: "#" },
  ],
}

export function Footer() {
  return (
    <footer className="relative overflow-hidden border-t border-white/5 py-24">

      {/* Background */}
      <div className="absolute inset-0 bg-black" />

      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.05),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(59,130,246,0.05),transparent_35%)]" />

      <div className="relative z-10 mx-auto max-w-7xl px-6">

        {/* Main Grid */}
        <div className="grid gap-16 border-b border-white/5 pb-16 md:grid-cols-2 lg:grid-cols-4">

          {/* Brand */}
          <div className="lg:col-span-1">
            <Link href="#hero">
              <motion.div
                whileHover={{ scale: 1.02 }}
                className="mb-8 flex items-center gap-4"
              >

                <div className="relative">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400 to-blue-600 shadow-[0_0_40px_rgba(0,200,255,0.18)]">
                    <span className="text-2xl font-black text-white">
                      I
                    </span>
                  </div>

                  <div className="absolute inset-0 rounded-2xl bg-cyan-400/20 blur-2xl" />
                </div>

                <div>
                  <h3 className="text-2xl font-black tracking-tight text-white">
                    IMNOVA
                  </h3>

                  <p className="text-xs uppercase tracking-[0.35em] text-cyan-300">
                    Group LLC
                  </p>
                </div>

              </motion.div>
            </Link>

            <p className="max-w-xs text-sm leading-relaxed text-zinc-500">
              Diseñando innovación para la próxima generación de bienestar,
              tecnología y evolución humana.
            </p>
          </div>

          {/* Tienda */}
          <div>
            <h4 className="mb-5 text-sm font-semibold uppercase tracking-[0.2em] text-white">
              Tienda
            </h4>

            <ul className="space-y-4">
              {footerLinks.tienda.map((link) => (
                <li key={link.name}>
                  <Link
                    href={link.href}
                    className="text-sm text-zinc-500 transition-colors hover:text-white"
                  >
                    {link.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Empresa */}
          <div>
            <h4 className="mb-5 text-sm font-semibold uppercase tracking-[0.2em] text-white">
              Empresa
            </h4>

            <ul className="space-y-4">
              {footerLinks.empresa.map((link) => (
                <li key={link.name}>
                  <Link
                    href={link.href}
                    className="text-sm text-zinc-500 transition-colors hover:text-white"
                  >
                    {link.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h4 className="mb-5 text-sm font-semibold uppercase tracking-[0.2em] text-white">
              Legal
            </h4>

            <ul className="space-y-4">
              {footerLinks.legal.map((link) => (
                <li key={link.name}>
                  <Link
                    href={link.href}
                    className="text-sm text-zinc-500 transition-colors hover:text-white"
                  >
                    {link.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

        </div>

        {/* Bottom */}
        <div className="flex flex-col items-center justify-between gap-6 pt-10 sm:flex-row">

          <p className="text-sm text-zinc-600">
            © {new Date().getFullYear()} IMNOVA Group LLC. Todos los derechos reservados.
          </p>

          {/* Social */}
          <div className="flex items-center gap-6">
            {["Instagram", "LinkedIn", "YouTube"].map((social) => (
              <motion.a
                key={social}
                href="#"
                whileHover={{ y: -2 }}
                className="text-sm text-zinc-600 transition-colors hover:text-white"
              >
                {social}
              </motion.a>
            ))}
          </div>

        </div>

        {/* Background Text */}
        <div className="pointer-events-none absolute bottom-[-40px] left-0 right-0 overflow-hidden">
          <div className="select-none text-center text-[18vw] font-black leading-none text-white/[0.02]">
            IMNOVA
          </div>
        </div>

      </div>
    </footer>
  )
}
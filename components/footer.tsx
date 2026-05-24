"use client"

import { motion } from "framer-motion"
import Link from "next/link"

const footerLinks = {
  products: [
    { name: "Bebidas Funcionales", href: "#" },
    { name: "Tecnología Inteligente", href: "#" },
    { name: "Soluciones IA", href: "#" },
    { name: "Bienestar", href: "#" },
  ],
  company: [
    { name: "Sobre Nosotros", href: "/about" },
    { name: "Innovaciones", href: "#innovations" },
    { name: "Contacto", href: "/contact" },
    { name: "Prensa", href: "#" },
  ],
  resources: [
    { name: "Blog", href: "#" },
    { name: "Investigación", href: "#technology" },
    { name: "Partners", href: "#" },
    { name: "Soporte", href: "#" },
  ],
  legal: [
    { name: "Privacidad", href: "/privacy-policy" },
    { name: "Términos", href: "/terms" },
    { name: "Cookies", href: "#" },
  ],
}

export function Footer() {
  return (
    <footer className="relative py-20 border-t border-border/50">

      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-b from-background to-secondary/20" />

      <div className="relative z-10 mx-auto max-w-7xl px-6">

        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-8 lg:gap-12 mb-16">

         {/* Brand */}
<div className="col-span-2 md:col-span-4 lg:col-span-1 mb-8 lg:mb-0">

  <Link href="/">
    <motion.div
      whileHover={{ scale: 1.02 }}
      className="flex items-center gap-3 mb-6"
    >
      <div className="relative">
        <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-primary to-primary/50 flex items-center justify-center shadow-lg shadow-primary/20">
          <span className="text-lg font-bold text-white">
            I
          </span>
        </div>
      </div>

      <div>
        <div className="text-xl font-bold tracking-tight">
          IMNOVA
        </div>

        <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">
          Group LLC
        </div>
      </div>

    </motion.div>
  </Link>

  <p className="text-sm text-muted-foreground leading-relaxed max-w-xs">
    Global Ecommerce & Innovation
  </p>

</div>
          <div>
            <h4 className="font-semibold mb-4 text-sm">
              Productos
            </h4>

            <ul className="space-y-3">
              {footerLinks.products.map((link) => (
                <li key={link.name}>
                  <Link
                    href={link.href}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {link.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Company */}
          <div>
            <h4 className="font-semibold mb-4 text-sm">
              Empresa
            </h4>

            <ul className="space-y-3">
              {footerLinks.company.map((link) => (
                <li key={link.name}>
                  <Link
                    href={link.href}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {link.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Resources */}
          <div>
            <h4 className="font-semibold mb-4 text-sm">
              Recursos
            </h4>

            <ul className="space-y-3">
              {footerLinks.resources.map((link) => (
                <li key={link.name}>
                  <Link
                    href={link.href}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {link.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h4 className="font-semibold mb-4 text-sm">
              Legal
            </h4>

            <ul className="space-y-3">
              {footerLinks.legal.map((link) => (
                <li key={link.name}>
                  <Link
                    href={link.href}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {link.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

        </div>

        {/* Bottom Bar */}
        <div className="pt-8 border-t border-border/50 flex flex-col sm:flex-row items-center justify-between gap-4">

          <p className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} IMNOVA GROUP LLC.
            Todos los derechos reservados.
          </p>

          {/* Social Links */}
          <div className="flex items-center gap-6">

            {["LinkedIn", "Instagram", "YouTube"].map((social) => (
              <motion.a
                key={social}
                href="#"
                whileHover={{ y: -2 }}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                {social}
              </motion.a>
            ))}

          </div>

        </div>

      </div>

    </footer>
  )
}
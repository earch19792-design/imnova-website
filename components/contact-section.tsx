"use client"

import { motion, useInView } from "framer-motion"
import { useRef } from "react"
import { Mail, Phone, MapPin, Send } from "lucide-react"

export function ContactSection() {
  const ref = useRef(null)

  const isInView = useInView(ref, {
    once: true,
    margin: "-100px",
  })

  return (
    <section
      id="contact"
      ref={ref}
      className="relative isolate overflow-hidden bg-gradient-to-b from-black via-[#050505] to-black py-32 md:py-40"
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(0,255,255,0.08),transparent_50%)]" />
      <div className="absolute left-0 top-1/2 h-72 w-72 -translate-y-1/2 rounded-full bg-cyan-400/10 blur-3xl" />
      <div className="absolute right-0 bottom-0 h-72 w-72 rounded-full bg-white/[0.06] blur-3xl" />

      <div className="relative z-10 mx-auto max-w-7xl px-6">
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.9 }}
          className="mb-16 max-w-3xl text-center mx-auto"
        >
          <span className="inline-flex rounded-full border border-cyan-400/20 bg-white/[0.04] px-4 py-2 text-xs uppercase tracking-[0.35em] text-cyan-300">
            Contacto
          </span>
          <h2 className="mt-8 text-4xl font-black tracking-[-0.04em] text-white sm:text-5xl">
            Conecta con IMNOVA desde cualquier dispositivo.
          </h2>
          <p className="mt-6 text-lg leading-8 text-zinc-400">
            Estamos listos para acompañarte en la transformación de tu marca, producto o experiencia digital. Contáctanos y hablemos de oportunidades.
          </p>
        </motion.div>

        <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            animate={isInView ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.9, delay: 0.1 }}
            className="rounded-[40px] border border-white/10 bg-white/[0.04] p-8 shadow-[0_0_120px_rgba(0,255,255,0.05)] backdrop-blur-2xl"
          >
            <div className="space-y-6">
              <div className="rounded-3xl bg-white/[0.04] p-6">
                <p className="text-sm uppercase tracking-[0.35em] text-cyan-300">Nuestra oficina</p>
                <p className="mt-4 text-lg font-semibold text-white">IMNOVA Group LLC</p>
                <p className="mt-2 text-sm text-zinc-400">Miami, FL · Estados Unidos</p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-3xl border border-white/10 bg-black/50 p-5">
                  <div className="flex items-center gap-3 text-cyan-300">
                    <Mail className="h-5 w-5" />
                    <span className="text-sm uppercase tracking-[0.35em] text-white/70">Email</span>
                  </div>
                  <a href="mailto:contacto@imnova.com" className="mt-4 block text-lg font-semibold text-white hover:text-cyan-300">
                    contacto@imnova.com
                  </a>
                </div>

                <div className="rounded-3xl border border-white/10 bg-black/50 p-5">
                  <div className="flex items-center gap-3 text-cyan-300">
                    <Phone className="h-5 w-5" />
                    <span className="text-sm uppercase tracking-[0.35em] text-white/70">Teléfono</span>
                  </div>
                  <a href="tel:+1234567890" className="mt-4 block text-lg font-semibold text-white hover:text-cyan-300">
                    +1 (234) 567-890
                  </a>
                </div>
              </div>

              <div className="rounded-3xl border border-white/10 bg-black/50 p-5">
                <div className="flex items-center gap-3 text-cyan-300">
                  <MapPin className="h-5 w-5" />
                  <span className="text-sm uppercase tracking-[0.35em] text-white/70">Presencia</span>
                </div>
                <p className="mt-4 text-lg font-semibold text-white">Soluciones globales con enfoque en Latinoamérica y Norteamérica.</p>
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 30 }}
            animate={isInView ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.9, delay: 0.2 }}
            className="rounded-[40px] border border-white/10 bg-white/[0.04] p-8 shadow-[0_0_120px_rgba(0,255,255,0.05)] backdrop-blur-2xl"
          >
            <form
              onSubmit={(event) => event.preventDefault()}
              className="space-y-6"
            >
              <label className="block text-sm text-zinc-400">
                Nombre
                <input
                  type="text"
                  placeholder="Tu nombre"
                  className="mt-2 w-full rounded-3xl border border-white/10 bg-black/70 px-4 py-3 text-white outline-none transition focus:border-cyan-400/50 focus:ring-2 focus:ring-cyan-400/20"
                />
              </label>

              <label className="block text-sm text-zinc-400">
                Email
                <input
                  type="email"
                  placeholder="correo@ejemplo.com"
                  className="mt-2 w-full rounded-3xl border border-white/10 bg-black/70 px-4 py-3 text-white outline-none transition focus:border-cyan-400/50 focus:ring-2 focus:ring-cyan-400/20"
                />
              </label>

              <label className="block text-sm text-zinc-400">
                Mensaje
                <textarea
                  placeholder="Cuéntanos sobre tu proyecto"
                  rows={5}
                  className="mt-2 w-full rounded-3xl border border-white/10 bg-black/70 px-4 py-3 text-white outline-none transition focus:border-cyan-400/50 focus:ring-2 focus:ring-cyan-400/20"
                />
              </label>

              <button
                type="submit"
                className="inline-flex w-full items-center justify-center gap-3 rounded-full bg-cyan-400 px-6 py-4 text-sm font-bold uppercase tracking-[0.20em] text-black transition hover:bg-cyan-300"
              >
                <Send className="h-4 w-4" />
                Enviar mensaje
              </button>
            </form>
          </motion.div>
        </div>
      </div>
    </section>
  )
}

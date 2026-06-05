"use client"

import { motion, useInView } from "framer-motion"
import { useRef } from "react"

const partners = [
  "MASH Coffee+",
  "Wellness Lab",
  "Smart Nutrition",
  "Global Design",
  "Future Health",
  "Social Impact",
  "Tech Wellness",
  "Premium Labs",
]

export function PartnersSection() {
  const ref = useRef(null)

  const isInView = useInView(ref, {
    once: true,
    margin: "-100px",
  })

  return (
    <section
      id="partners"
      ref={ref}
      className="relative isolate overflow-hidden bg-gradient-to-b from-black via-[#050505] to-black py-32 md:py-40"
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(0,255,255,0.08),transparent_50%)]" />
      <div className="absolute left-1/2 top-0 h-72 w-72 -translate-x-1/2 rounded-full bg-cyan-400/10 blur-3xl" />
      <div className="absolute right-0 bottom-0 h-72 w-72 rounded-full bg-white/[0.06] blur-3xl" />

      <div className="relative z-10 mx-auto max-w-7xl px-6">
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.9 }}
          className="mb-16 text-center"
        >
          <span className="inline-flex rounded-full border border-cyan-400/20 bg-white/[0.04] px-4 py-2 text-xs uppercase tracking-[0.35em] text-cyan-300">
            Partners
          </span>
          <h2 className="mt-8 text-4xl font-black tracking-[-0.04em] text-white sm:text-5xl">
            Colaboraciones que impulsan el bienestar global.
          </h2>
          <p className="mt-6 mx-auto max-w-2xl text-lg leading-8 text-zinc-400">
            Trabajamos con marcas, creadores y equipos estratégicos para escalar tecnología, productos y experiencias a clientes de todo el mundo.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.9, delay: 0.1 }}
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          {partners.map((partner) => (
            <div
              key={partner}
              className="rounded-[32px] border border-white/10 bg-white/[0.04] p-6 text-center shadow-[0_0_80px_rgba(0,255,255,0.04)] backdrop-blur-2xl transition hover:border-cyan-400/20 hover:bg-white/[0.06]"
            >
              <p className="text-sm uppercase tracking-[0.35em] text-cyan-300">Partner</p>
              <h3 className="mt-4 text-xl font-semibold text-white">{partner}</h3>
              <p className="mt-3 text-sm leading-6 text-zinc-400">
                Acelerando estrategias de producto, diseño y expansión global.
              </p>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  )
}

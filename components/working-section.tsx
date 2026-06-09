"use client"

import { motion } from "framer-motion"

import {
  Bot,
  Boxes,
  Globe2,
  HeartPulse,
  Network,
  Users,
} from "lucide-react"

const workStreams = [
  {
    title: "Nutricion funcional",
    description:
      "Desarrollo de formulas, formatos y experiencias de consumo pensadas para energia, enfoque y bienestar diario.",
    icon: HeartPulse,
  },
  {
    title: "Marcas y productos",
    description:
      "Construccion de lineas comerciales con identidad premium, packaging, canales y narrativa lista para mercado.",
    icon: Boxes,
  },
  {
    title: "Sistemas inteligentes",
    description:
      "Automatizacion, datos y herramientas internas para acelerar decisiones, seguimiento y ejecucion del ecosistema.",
    icon: Bot,
  },
  {
    title: "Comunidad",
    description:
      "Activacion de usuarios, feedback, contenido y experiencias para que la familia IMNOVA participe en lo que viene.",
    icon: Users,
  },
  {
    title: "Canales de venta",
    description:
      "Tienda, ecommerce, marketplaces y rutas de distribucion para mover productos desde lanzamiento hasta escala.",
    icon: Network,
  },
  {
    title: "Expansion",
    description:
      "Preparacion del ecosistema para crecer en Latinoamerica, Norteamerica y nuevos mercados digitales.",
    icon: Globe2,
  },
]

export function WorkingSection() {
  return (
    <section
      id="working"
      className="relative isolate overflow-hidden bg-black py-36 md:py-44"
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(251,191,36,0.11),transparent_40%),linear-gradient(180deg,rgba(0,0,0,0.15),rgba(0,0,0,0.95))]" />
      <div className="absolute inset-0 opacity-[0.02] bg-[linear-gradient(rgba(255,255,255,0.12)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.12)_1px,transparent_1px)] bg-[size:100px_100px]" />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-200/20 to-transparent" />

      <div className="relative z-10 mx-auto max-w-7xl px-6">
        <motion.div
          initial={{
            opacity: 0,
            y: 32,
          }}
          whileInView={{
            opacity: 1,
            y: 0,
          }}
          transition={{
            duration: 0.85,
          }}
          viewport={{ once: true }}
          className="mx-auto max-w-5xl text-center"
        >
          <div className="inline-flex items-center gap-3 rounded-full border border-amber-200/20 bg-amber-200/10 px-5 py-3 text-[10px] uppercase tracking-[0.34em] text-amber-100">
            <Network className="h-4 w-4" />
            En que esta trabajando IMNOVA
          </div>

          <h2 className="mt-9 text-5xl font-black leading-[0.98] tracking-[-0.04em] text-white md:text-7xl">
            Un ecosistema en construccion,
            <span className="block bg-gradient-to-r from-amber-200 via-white to-cyan-200 bg-clip-text text-transparent">
              no solo una lista de productos
            </span>
          </h2>

          <p className="mx-auto mt-8 max-w-3xl text-lg leading-8 text-zinc-400">
            Esta seccion responde en que frentes avanza IMNOVA: producto,
            tecnologia, comunidad, venta y expansion. Los productos especificos
            quedan en sus secciones correspondientes.
          </p>
        </motion.div>

        <div className="mt-16 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {workStreams.map(
            (stream, index) => (
              <motion.article
                key={stream.title}
                initial={{
                  opacity: 0,
                  y: 36,
                }}
                whileInView={{
                  opacity: 1,
                  y: 0,
                }}
                transition={{
                  duration: 0.75,
                  delay:
                    index * 0.06,
                }}
                viewport={{ once: true }}
                className="group relative overflow-hidden rounded-[32px] border border-white/10 bg-white/[0.035] p-7 backdrop-blur-xl transition duration-300 hover:border-amber-200/20 hover:bg-white/[0.055]"
              >
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(251,191,36,0.08),transparent_58%)] opacity-0 transition duration-300 group-hover:opacity-100" />

                <div className="relative z-10">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-amber-200/15 bg-amber-200/[0.08]">
                    <stream.icon className="h-6 w-6 text-amber-100" />
                  </div>

                  <h3 className="mt-7 text-3xl font-black leading-tight tracking-[-0.04em] text-white">
                    {stream.title}
                  </h3>

                  <p className="mt-5 leading-7 text-zinc-400">
                    {stream.description}
                  </p>
                </div>
              </motion.article>
            )
          )}
        </div>
      </div>
    </section>
  )
}

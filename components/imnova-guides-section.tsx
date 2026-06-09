"use client"

import { motion } from "framer-motion"

import {
  ArrowUpRight,
  BookOpen,
  Brain,
  FlaskConical,
  Sparkles,
  type LucideIcon,
  UsersRound,
} from "lucide-react"

type GuideCard = {
  title: string
  description: string
  cta: string
  icon: LucideIcon
  action?: "community"
}

type ImnovaGuidesSectionProps = {
  onJoinFamily?: () => void
}

const guideCards: GuideCard[] = [
  {
    title: "Cómo usar Mash Coffee+ en tu rutina diaria",
    description:
      "Ideas prácticas para integrar café funcional en momentos de enfoque, energía y productividad.",
    cta: "Ver guía",
    icon: BookOpen,
  },
  {
    title: "Qué significa energía limpia",
    description:
      "Una explicación simple sobre cómo IMNOVA diseña productos pensados para bienestar moderno.",
    cta: "Aprender más",
    icon: Sparkles,
  },
  {
    title: "Detrás de cada innovación",
    description:
      "Conoce cómo una idea pasa por validación, desarrollo, testing y comercialización dentro de IMNOVA.",
    cta: "Ver proceso",
    icon: FlaskConical,
  },
  {
    title: "Únete a la familia IMNOVA",
    description:
      "Recibe avances, lanzamientos y oportunidades para participar en futuras decisiones de producto.",
    cta: "Unirme",
    icon: UsersRound,
    action: "community",
  },
]

export function ImnovaGuidesSection({
  onJoinFamily,
}: ImnovaGuidesSectionProps) {
  return (
    <section
      id="imnova-guides"
      className="relative isolate overflow-hidden bg-black py-32 md:py-40"
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(34,211,238,0.11),transparent_40%),radial-gradient(circle_at_80%_60%,rgba(251,191,36,0.08),transparent_34%)]" />
      <div className="absolute inset-0 opacity-[0.022] bg-[linear-gradient(rgba(255,255,255,0.12)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.12)_1px,transparent_1px)] bg-[size:92px_92px]" />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200/20 to-transparent" />

      <div className="relative z-10 mx-auto max-w-7xl px-6">
        <motion.div
          initial={{
            opacity: 0,
            y: 30,
          }}
          whileInView={{
            opacity: 1,
            y: 0,
          }}
          transition={{
            duration: 0.8,
          }}
          viewport={{ once: true }}
          className="mx-auto max-w-4xl text-center"
        >
          <div className="inline-flex items-center gap-3 rounded-full border border-cyan-300/20 bg-cyan-300/[0.08] px-5 py-3 text-[10px] uppercase tracking-[0.34em] text-cyan-100">
            <Brain className="h-4 w-4" />
            Ideas de uso
          </div>

          <h2 className="mt-9 text-5xl font-black leading-[0.98] tracking-[-0.04em] text-white md:text-7xl">
            Guías IMNOVA
          </h2>

          <p className="mx-auto mt-8 max-w-3xl text-lg leading-8 text-zinc-400">
            Ideas simples para entender, usar y aprovechar mejor cada
            innovación antes de que llegue al mercado.
          </p>
        </motion.div>

        <div className="mt-16 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {guideCards.map(
            (guide, index) => {
              const Icon =
                guide.icon

              const isCommunityAction =
                guide.action === "community" &&
                Boolean(onJoinFamily)

              return (
                <motion.article
                  key={guide.title}
                  initial={{
                    opacity: 0,
                    y: 34,
                  }}
                  whileInView={{
                    opacity: 1,
                    y: 0,
                  }}
                  transition={{
                    duration: 0.72,
                    delay:
                      index * 0.06,
                  }}
                  viewport={{ once: true }}
                  className="group relative flex min-h-[360px] flex-col overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.035] p-6 backdrop-blur-2xl transition duration-300 hover:-translate-y-1 hover:border-cyan-200/25 hover:bg-white/[0.055]"
                >
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.12),transparent_42%)] opacity-0 transition duration-300 group-hover:opacity-100" />

                  <div className="relative z-10 flex flex-1 flex-col">
                    <div className="flex h-14 w-14 items-center justify-center rounded-3xl border border-cyan-200/15 bg-cyan-300/[0.08]">
                      <Icon className="h-6 w-6 text-cyan-100" />
                    </div>

                    <h3 className="mt-8 text-2xl font-black leading-tight tracking-[-0.03em] text-white">
                      {guide.title}
                    </h3>

                    <p className="mt-5 flex-1 text-sm leading-7 text-zinc-400">
                      {guide.description}
                    </p>

                    {isCommunityAction ? (
                      <button
                        type="button"
                        onClick={onJoinFamily}
                        className="mt-8 inline-flex items-center gap-2 self-start rounded-3xl border border-cyan-200/20 bg-cyan-300/[0.08] px-5 py-3 text-[10px] font-black uppercase tracking-[0.18em] text-cyan-100 transition-colors hover:border-cyan-200/35 hover:bg-cyan-300/[0.14]"
                      >
                        {guide.cta}
                        <ArrowUpRight className="h-3.5 w-3.5" />
                      </button>
                    ) : (
                      <span className="mt-8 inline-flex items-center gap-2 self-start rounded-3xl border border-white/10 bg-white/[0.035] px-5 py-3 text-[10px] font-black uppercase tracking-[0.18em] text-white/65">
                        {guide.cta}
                        <ArrowUpRight className="h-3.5 w-3.5" />
                      </span>
                    )}
                  </div>
                </motion.article>
              )
            }
          )}
        </div>
      </div>
    </section>
  )
}

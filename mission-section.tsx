"use client"

import { motion } from "framer-motion"
import { useInView } from "framer-motion"
import { useRef } from "react"
import { Target, Eye } from "lucide-react"

export function MissionSection() {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: "-100px" })

  return (
    <section ref={ref} className="relative py-32 overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0">
        <div className="absolute inset-0 bg-gradient-to-b from-background via-primary/5 to-background" />
        <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(ellipse_at_center,rgba(59,130,246,0.1)_0%,transparent_70%)]" />
      </div>

      {/* Animated Lines */}
      <div className="absolute inset-0 overflow-hidden">
        <svg className="absolute w-full h-full" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="lineGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="transparent" />
              <stop offset="50%" stopColor="rgba(59, 130, 246, 0.3)" />
              <stop offset="100%" stopColor="transparent" />
            </linearGradient>
          </defs>
          <motion.line
            x1="0"
            y1="30%"
            x2="100%"
            y2="30%"
            stroke="url(#lineGradient)"
            strokeWidth="1"
            initial={{ pathLength: 0 }}
            animate={isInView ? { pathLength: 1 } : {}}
            transition={{ duration: 2, ease: "easeInOut" }}
          />
          <motion.line
            x1="0"
            y1="70%"
            x2="100%"
            y2="70%"
            stroke="url(#lineGradient)"
            strokeWidth="1"
            initial={{ pathLength: 0 }}
            animate={isInView ? { pathLength: 1 } : {}}
            transition={{ duration: 2, ease: "easeInOut", delay: 0.3 }}
          />
        </svg>
      </div>

      <div className="relative z-10 mx-auto max-w-7xl px-6">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-20">
          {/* Mission */}
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={isInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.8 }}
            className="relative"
          >
            <div className="glass-card p-8 sm:p-12 rounded-3xl h-full">
              <div className="flex items-center gap-4 mb-8">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center">
                  <Target className="w-7 h-7 text-primary" />
                </div>
                <div>
                  <span className="text-xs text-primary uppercase tracking-widest">
                    Nuestra
                  </span>
                  <h3 className="text-2xl font-bold">Misión</h3>
                </div>
              </div>

              <p className="text-lg text-muted-foreground leading-relaxed">
                {'"'}Desarrollar productos innovadores, bebidas funcionales y tecnologías 
                inteligentes que mejoren la calidad de vida de las personas, aportando 
                bienestar, vitalidad, eficiencia y soluciones prácticas para el día a día.
              </p>

              <p className="text-lg text-muted-foreground leading-relaxed mt-6">
                En IMNOVA trabajamos para crear un futuro donde la innovación, la salud 
                y la tecnología se integren de forma accesible, moderna y funcional, 
                ayudando a las personas a vivir de manera más cómoda, productiva y conectada.{'"'}
              </p>

              {/* Decorative Element */}
              <div className="absolute -bottom-4 -right-4 w-32 h-32 bg-primary/10 rounded-full blur-3xl" />
            </div>
          </motion.div>

          {/* Vision */}
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={isInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="relative"
          >
            <div className="glass-card p-8 sm:p-12 rounded-3xl h-full">
              <div className="flex items-center gap-4 mb-8">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center">
                  <Eye className="w-7 h-7 text-primary" />
                </div>
                <div>
                  <span className="text-xs text-primary uppercase tracking-widest">
                    Nuestra
                  </span>
                  <h3 className="text-2xl font-bold">Visión</h3>
                </div>
              </div>

              <p className="text-lg text-muted-foreground leading-relaxed">
                {'"'}Convertirse en una empresa líder en innovación tecnológica y desarrollo 
                de productos funcionales a nivel internacional, reconocida por transformar 
                ideas futuristas en soluciones reales que impacten positivamente la vida humana.{'"'}
              </p>

              {/* Key Points */}
              <div className="grid grid-cols-2 gap-4 mt-8">
                {["Liderazgo Global", "Impacto Positivo", "Innovación Real", "Visión Futurista"].map((point, i) => (
                  <motion.div
                    key={point}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={isInView ? { opacity: 1, scale: 1 } : {}}
                    transition={{ duration: 0.4, delay: 0.5 + i * 0.1 }}
                    className="flex items-center gap-2"
                  >
                    <div className="w-2 h-2 rounded-full bg-primary" />
                    <span className="text-sm">{point}</span>
                  </motion.div>
                ))}
              </div>

              {/* Decorative Element */}
              <div className="absolute -top-4 -left-4 w-32 h-32 bg-primary/10 rounded-full blur-3xl" />
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  )
}

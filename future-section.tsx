"use client"

import { motion } from "framer-motion"
import { useInView } from "framer-motion"
import { useRef } from "react"
import { Home, Wifi, Heart, Building2, Zap, Users } from "lucide-react"

const futureVisions = [
  {
    icon: Home,
    title: "Hogares Inteligentes",
    description: "Espacios que se adaptan a ti, optimizando energía, confort y bienestar automáticamente.",
  },
  {
    icon: Wifi,
    title: "Vida Conectada",
    description: "Ecosistemas integrados que sincronizan todos los aspectos de tu vida diaria.",
  },
  {
    icon: Heart,
    title: "Bienestar Tecnológico",
    description: "Salud preventiva y personalizada impulsada por IA y dispositivos inteligentes.",
  },
  {
    icon: Building2,
    title: "Ciudades Futuristas",
    description: "Infraestructura urbana inteligente para comunidades más sostenibles y eficientes.",
  },
  {
    icon: Zap,
    title: "Productividad Avanzada",
    description: "Herramientas que amplifican tu potencial y maximizan tu tiempo.",
  },
  {
    icon: Users,
    title: "Innovación Humana",
    description: "Tecnología que potencia las capacidades humanas, no las reemplaza.",
  },
]

export function FutureSection() {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: "-100px" })

  return (
    <section ref={ref} className="relative py-32 overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-b from-background via-primary/5 to-background" />

      {/* Animated Orbs */}
      <motion.div
        animate={{
          x: [0, 100, 0],
          y: [0, -50, 0],
        }}
        transition={{ duration: 20, repeat: Infinity, ease: "easeInOut" }}
        className="absolute top-1/4 left-1/4 w-64 h-64 bg-primary/10 rounded-full blur-[100px]"
      />
      <motion.div
        animate={{
          x: [0, -80, 0],
          y: [0, 60, 0],
        }}
        transition={{ duration: 25, repeat: Infinity, ease: "easeInOut" }}
        className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-primary/5 rounded-full blur-[120px]"
      />

      <div className="relative z-10 mx-auto max-w-7xl px-6">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8 }}
          className="text-center mb-20"
        >
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full glass text-xs text-primary mb-6 uppercase tracking-widest">
            Visión de Futuro
          </span>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold mb-6 text-balance">
            El futuro de la{" "}
            <span className="text-primary">vida humana</span>
          </h2>
          <p className="max-w-2xl mx-auto text-muted-foreground text-lg">
            Nuestra visión de cómo la tecnología transformará cada aspecto de la experiencia humana.
          </p>
        </motion.div>

        {/* Vision Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {futureVisions.map((vision, index) => (
            <motion.div
              key={vision.title}
              initial={{ opacity: 0, y: 30 }}
              animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.6, delay: index * 0.1 }}
              className="group"
            >
              <div className="relative h-full p-8 rounded-2xl bg-gradient-to-br from-secondary/50 to-secondary/20 border border-border/50 hover:border-primary/30 transition-all duration-500">
                {/* Hover Glow */}
                <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-primary/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

                <div className="relative z-10">
                  <motion.div
                    whileHover={{ scale: 1.1, rotate: 5 }}
                    className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center mb-6"
                  >
                    <vision.icon className="w-6 h-6 text-primary" />
                  </motion.div>

                  <h3 className="text-xl font-semibold mb-3">{vision.title}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">
                    {vision.description}
                  </p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Bottom CTA */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8, delay: 0.6 }}
          className="text-center mt-16"
        >
          <p className="text-lg text-muted-foreground mb-6">
            Sé parte del futuro. Únete al ecosistema IMNOVA.
          </p>
          <motion.button
            whileHover={{ scale: 1.02, boxShadow: "0 0 40px rgba(59, 130, 246, 0.3)" }}
            whileTap={{ scale: 0.98 }}
            className="px-8 py-4 bg-white text-black rounded-full font-medium"
          >
            Unirse al Futuro
          </motion.button>
        </motion.div>
      </div>
    </section>
  )
}

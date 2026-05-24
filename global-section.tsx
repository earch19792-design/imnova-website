"use client"

import { motion } from "framer-motion"
import { useInView } from "framer-motion"
import { useRef, useState } from "react"

const locations = [
  { name: "United States", x: 18, y: 42, size: "lg" },
  { name: "Costa Rica", x: 24, y: 55, size: "sm" },
  { name: "Nicaragua", x: 22, y: 52, size: "sm" },
  { name: "United Arab Emirates", x: 63, y: 40, size: "md" },
]

export function GlobalSection() {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: "-100px" })
  const [activeLocation, setActiveLocation] = useState<number | null>(null)

  return (
    <section ref={ref} className="relative py-32 overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-b from-background via-secondary/20 to-background" />

      <div className="relative z-10 mx-auto max-w-7xl px-6">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8 }}
          className="text-center mb-16"
        >
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full glass text-xs text-primary mb-6 uppercase tracking-widest">
            Global Expansion Network
          </span>

          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold mb-6 text-balance">
            Construyendo presencia{" "}
            <span className="text-primary">internacional</span>
          </h2>

          <p className="max-w-2xl mx-auto text-muted-foreground text-lg">
            Construyendo presencia estratégica en mercados internacionales a través de innovación,
            ecommerce y marcas de consumo de nueva generación.
          </p>
        </motion.div>

        {/* World Map */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={isInView ? { opacity: 1, scale: 1 } : {}}
          transition={{ duration: 1 }}
          className="relative aspect-[2/1] glass-card rounded-3xl overflow-hidden p-8"
        >
          {/* Map Background */}
          <div className="absolute inset-0 opacity-30">
            <svg
              viewBox="0 0 100 50"
              className="w-full h-full"
              preserveAspectRatio="xMidYMid slice"
            >
              {/* Simplified world map outline */}
              <path
                d="M10,25 Q15,20 20,22 Q25,24 30,20 Q35,18 40,22 Q45,26 50,24 Q55,22 60,25 Q65,28 70,25 Q75,22 80,26 Q85,30 90,28"
                stroke="rgba(59, 130, 246, 0.3)"
                strokeWidth="0.2"
                fill="none"
              />

              {/* Americas */}
              <ellipse
                cx="22"
                cy="40"
                rx="12"
                ry="18"
                fill="rgba(59, 130, 246, 0.05)"
                stroke="rgba(59, 130, 246, 0.2)"
                strokeWidth="0.1"
              />

              {/* Europe/Africa */}
              <ellipse
                cx="50"
                cy="38"
                rx="10"
                ry="15"
                fill="rgba(59, 130, 246, 0.05)"
                stroke="rgba(59, 130, 246, 0.2)"
                strokeWidth="0.1"
              />

              {/* Asia/Oceania */}
              <ellipse
                cx="78"
                cy="40"
                rx="15"
                ry="20"
                fill="rgba(59, 130, 246, 0.05)"
                stroke="rgba(59, 130, 246, 0.2)"
                strokeWidth="0.1"
              />
            </svg>
          </div>

          {/* Grid */}
          <div className="absolute inset-0 bg-[linear-gradient(rgba(59,130,246,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(59,130,246,0.03)_1px,transparent_1px)] bg-[size:5%_10%]" />

          {/* Location Points */}
          {locations.map((location, index) => (
            <motion.div
              key={location.name}
              initial={{ scale: 0, opacity: 0 }}
              animate={isInView ? { scale: 1, opacity: 1 } : {}}
              transition={{ duration: 0.5, delay: 0.5 + index * 0.1 }}
              style={{ left: `${location.x}%`, top: `${location.y}%` }}
              className="absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer"
              onMouseEnter={() => setActiveLocation(index)}
              onMouseLeave={() => setActiveLocation(null)}
            >
              {/* Pulse Effect */}
              <motion.div
                animate={{
                  scale: [1, 1.5, 1],
                  opacity: [0.5, 0, 0.5],
                }}
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  delay: index * 0.2,
                }}
                className={`absolute inset-0 rounded-full bg-primary ${
                  location.size === "lg"
                    ? "w-6 h-6 -m-3"
                    : location.size === "md"
                    ? "w-4 h-4 -m-2"
                    : "w-3 h-3 -m-1.5"
                }`}
              />

              {/* Point */}
              <div
                className={`relative rounded-full bg-primary transition-transform duration-300 ${
                  location.size === "lg"
                    ? "w-4 h-4"
                    : location.size === "md"
                    ? "w-3 h-3"
                    : "w-2 h-2"
                } ${activeLocation === index ? "scale-150" : ""}`}
              />

              {/* Label */}
              {activeLocation === index && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="absolute top-full left-1/2 -translate-x-1/2 mt-2 px-3 py-1.5 glass rounded-lg whitespace-nowrap text-xs z-10"
                >
                  {location.name}
                </motion.div>
              )}
            </motion.div>
          ))}

          {/* Connection Lines */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none">
            {locations.map((loc1, i) =>
              locations.slice(i + 1).map((loc2, j) => {
                const distance = Math.sqrt(
                  Math.pow(loc1.x - loc2.x, 2) +
                    Math.pow(loc1.y - loc2.y, 2)
                )

                if (distance < 40) {
                  return (
                    <motion.line
                      key={`${i}-${j}`}
                      x1={`${loc1.x}%`}
                      y1={`${loc1.y}%`}
                      x2={`${loc2.x}%`}
                      y2={`${loc2.y}%`}
                      stroke="rgba(59, 130, 246, 0.15)"
                      strokeWidth="0.5"
                      initial={{ pathLength: 0, opacity: 0 }}
                      animate={
                        isInView
                          ? { pathLength: 1, opacity: 1 }
                          : {}
                      }
                      transition={{
                        duration: 1.5,
                        delay: 1 + (i + j) * 0.1,
                      }}
                    />
                  )
                }

                return null
              })
            )}
          </svg>

          {/* Stats Overlay */}
          <div className="absolute bottom-6 left-6 right-6 flex flex-wrap justify-center gap-8">
            {[
              { label: "Strategic Markets", value: "4" },
              { label: "Brand Launch", value: "1+" },
              { label: "Products Pipeline", value: "5" },
              { label: "Global Vision", value: "Next Gen" },
            ].map((stat, index) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 20 }}
                animate={isInView ? { opacity: 1, y: 0 } : {}}
                transition={{
                  duration: 0.6,
                  delay: 1.5 + index * 0.1,
                }}
                className="text-center"
              >
                <div className="text-2xl sm:text-3xl font-bold text-primary">
                  {stat.value}
                </div>

                <div className="text-xs text-muted-foreground uppercase tracking-wider">
                  {stat.label}
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  )
}
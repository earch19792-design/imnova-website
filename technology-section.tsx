"use client"

import { motion } from "framer-motion"
import { useInView } from "framer-motion"
import { useRef } from "react"

import {
  Atom,
  Database,
  GitBranch,
  Layers,
  Activity,
  Cpu,
} from "lucide-react"

import { products }
from "@/data/products"

/* =================================================
LIVE METRICS
================================================= */

const launchReady =
  products.filter(
    (product) =>
      product.status ===
      "Launch Ready"
  ).length

const testingProducts =
  products.filter(
    (product) =>
      product.status ===
      "Testing"
  ).length

const techMetrics = [
  {
    label:
      "Productos Activos",

    value:
      products.length,

    icon:
      Layers,
  },

  {
    label:
      "Launch Ready",

    value:
      launchReady,

    icon:
      Activity,
  },

  {
    label:
      "En Testing",

    value:
      testingProducts,

    icon:
      GitBranch,
  },

  {
    label:
      "Innovación Global",

    value:
      "Activa",

    icon:
      Database,
  },
]

/* =================================================
RESEARCH AREAS
================================================= */

const researchAreas = [
  "Nutrición Inteligente",
  "Wellness Functional",
  "Protein Formulation",
  "AI Commerce",
  "Amazon Ecosystem",
  "Smart Branding",
]

export function TechnologySection() {

  const ref = useRef(null)

  const isInView = useInView(ref, {
    once: true,
    margin: "-100px",
  })

  return (
    <section
      id="technology"
      ref={ref}
      className="
        relative
        overflow-hidden
        py-32
      "
    >

      {/* Background */}
      <div
        className="
          absolute
          inset-0
          bg-gradient-to-b
          from-background
          via-secondary/30
          to-background
        "
      />

      {/* Circuit Pattern */}
      <div className="absolute inset-0 opacity-20">

        <svg
          className="h-full w-full"
          xmlns="http://www.w3.org/2000/svg"
        >

          <defs>

            <pattern
              id="circuit"
              x="0"
              y="0"
              width="100"
              height="100"
              patternUnits="userSpaceOnUse"
            >

              <circle
                cx="50"
                cy="50"
                r="1"
                fill="rgba(59, 130, 246, 0.5)"
              />

              <line
                x1="50"
                y1="0"
                x2="50"
                y2="40"
                stroke="rgba(59, 130, 246, 0.2)"
                strokeWidth="0.5"
              />

              <line
                x1="50"
                y1="60"
                x2="50"
                y2="100"
                stroke="rgba(59, 130, 246, 0.2)"
                strokeWidth="0.5"
              />

              <line
                x1="0"
                y1="50"
                x2="40"
                y2="50"
                stroke="rgba(59, 130, 246, 0.2)"
                strokeWidth="0.5"
              />

              <line
                x1="60"
                y1="50"
                x2="100"
                y2="50"
                stroke="rgba(59, 130, 246, 0.2)"
                strokeWidth="0.5"
              />

            </pattern>

          </defs>

          <rect
            width="100%"
            height="100%"
            fill="url(#circuit)"
          />

        </svg>

      </div>

      <div className="relative z-10 mx-auto max-w-7xl px-6">

        {/* =================================================
        HEADER
        ================================================= */}

        <motion.div
          initial={{
            opacity: 0,
            y: 30,
          }}
          animate={
            isInView
              ? {
                  opacity: 1,
                  y: 0,
                }
              : {}
          }
          transition={{
            duration: 0.8,
          }}
          className="mb-20 text-center"
        >

          <span
            className="
              glass
              mb-6
              inline-flex
              items-center
              gap-2
              rounded-full
              px-3
              py-1
              text-xs
              uppercase
              tracking-widest
              text-primary
            "
          >

            Tecnología e Investigación

          </span>

          <h2
            className="
              mb-6
              text-3xl
              font-bold
              text-balance
              sm:text-4xl
              lg:text-5xl
            "
          >

            Tecnología detrás del
            {" "}

            <span className="text-primary">

              ecosistema IMNOVA

            </span>

          </h2>

          <p
            className="
              mx-auto
              max-w-2xl
              text-lg
              text-muted-foreground
            "
          >

            Seguimiento inteligente del
            desarrollo de productos,
            testing y lanzamientos globales.

          </p>

        </motion.div>

        {/* =================================================
        DASHBOARD
        ================================================= */}

        <div className="grid gap-6 lg:grid-cols-3">

          {/* =================================================
          METRICS PANEL
          ================================================= */}

          <motion.div
            initial={{
              opacity: 0,
              x: -30,
            }}
            animate={
              isInView
                ? {
                    opacity: 1,
                    x: 0,
                  }
                : {}
            }
            transition={{
              duration: 0.8,
            }}
            className="
              glass-card
              rounded-2xl
              p-6
              lg:col-span-1
            "
          >

            <div className="mb-6 flex items-center gap-3">

              <Cpu className="h-5 w-5 text-primary" />

              <h3 className="font-semibold">

                Dashboard IMNOVA

              </h3>

            </div>

            <div className="space-y-4">

              {techMetrics.map(
                (metric, index) => (

                <motion.div
                  key={metric.label}
                  initial={{
                    opacity: 0,
                    x: -20,
                  }}
                  animate={
                    isInView
                      ? {
                          opacity: 1,
                          x: 0,
                        }
                      : {}
                  }
                  transition={{
                    duration: 0.5,
                    delay:
                      0.2 + index * 0.1,
                  }}
                  className="
                    flex
                    items-center
                    justify-between
                    rounded-xl
                    bg-secondary/50
                    p-4
                  "
                >

                  <div className="flex items-center gap-3">

                    <div
                      className="
                        flex
                        h-10
                        w-10
                        items-center
                        justify-center
                        rounded-lg
                        bg-primary/20
                      "
                    >

                      <metric.icon
                        className="
                          h-5
                          w-5
                          text-primary
                        "
                      />

                    </div>

                    <span
                      className="
                        text-sm
                        text-muted-foreground
                      "
                    >

                      {metric.label}

                    </span>

                  </div>

                  <span
                    className="
                      text-xl
                      font-bold
                    "
                  >

                    {metric.value}

                  </span>

                </motion.div>

              ))}

            </div>

          </motion.div>

          {/* =================================================
          MAIN VISUAL
          ================================================= */}

          <motion.div
            initial={{
              opacity: 0,
              y: 30,
            }}
            animate={
              isInView
                ? {
                    opacity: 1,
                    y: 0,
                  }
                : {}
            }
            transition={{
              duration: 0.8,
              delay: 0.2,
            }}
            className="
              glass-card
              rounded-2xl
              p-6
              lg:col-span-2
            "
          >

            <div className="mb-6 flex items-center gap-3">

              <Layers className="h-5 w-5 text-primary" />

              <h3 className="font-semibold">

                Núcleo Tecnológico

              </h3>

            </div>

            {/* =================================================
            LAB VISUALIZATION
            ================================================= */}

            <div
              className="
                relative
                aspect-[16/9]
                overflow-hidden
                rounded-xl
                bg-secondary/30
              "
            >

              {/* Animated Grid */}
              <div
                className="
                  absolute
                  inset-0
                  bg-[linear-gradient(rgba(59,130,246,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(59,130,246,0.05)_1px,transparent_1px)]
                  bg-[size:20px_20px]
                "
              />

              {/* Center */}
              <div
                className="
                  absolute
                  inset-0
                  flex
                  items-center
                  justify-center
                "
              >

                <motion.div
                  animate={{
                    rotate: 360,
                  }}
                  transition={{
                    duration: 60,
                    repeat: Infinity,
                    ease: "linear",
                  }}
                  className="
                    relative
                    h-48
                    w-48
                  "
                >

                  {/* Rings */}
                  <div className="absolute inset-0 rounded-full border border-primary/30" />

                  <div className="absolute inset-4 rounded-full border border-primary/20" />

                  <div className="absolute inset-8 rounded-full border border-primary/10" />

                  {/* =================================================
                  LIVE PRODUCT NODES
                  ================================================= */}

                  {products.map(
                    (product, i) => {

                      const angles = [
                        0,
                        60,
                        120,
                        180,
                        240,
                        300,
                      ]

                      return (

                        <motion.div
                          key={product.id}
                          style={{
                            position:
                              "absolute",

                            top:
                              "50%",

                            left:
                              "50%",

                            transform:
                              `
                              rotate(${angles[i]}deg)
                              translateY(-96px)
                              rotate(-${angles[i]}deg)
                              `,
                          }}
                          animate={{
                            scale: [
                              1,
                              1.2,
                              1,
                            ],
                          }}
                          transition={{
                            duration: 2,
                            repeat: Infinity,
                            delay:
                              i * 0.3,
                          }}
                          className="
                            group
                            relative
                            -ml-2
                            -mt-2
                            h-4
                            w-4
                            rounded-full
                            bg-cyan-400
                            shadow-[0_0_20px_rgba(0,255,255,0.8)]
                          "
                        >

                          {/* Tooltip */}
                          <div
                            className="
                              absolute
                              left-1/2
                              top-6
                              hidden
                              -translate-x-1/2
                              whitespace-nowrap
                              rounded-xl
                              border
                              border-cyan-400/20
                              bg-black/90
                              px-4
                              py-3
                              text-xs
                              backdrop-blur-2xl
                              group-hover:block
                            "
                          >

                            <p className="font-bold text-white">

                              {product.name}

                            </p>

                            <p className="mt-1 text-zinc-400">

                              {product.status}

                            </p>

                            <p className="mt-1 text-cyan-300">

                              {product.progress}%

                            </p>

                          </div>

                        </motion.div>

                      )
                    }
                  )}

                </motion.div>

                {/* Center Logo */}
                <div
                  className="
                    absolute
                    inset-0
                    flex
                    items-center
                    justify-center
                  "
                >

                  <div
                    className="
                      flex
                      h-20
                      w-20
                      items-center
                      justify-center
                      rounded-full
                      bg-gradient-to-br
                      from-primary/30
                      to-primary/10
                      backdrop-blur-sm
                    "
                  >

                    <Atom
                      className="
                        h-10
                        w-10
                        text-primary
                      "
                    />

                  </div>

                </div>

              </div>

              {/* Floating Labels */}
              <motion.div
                animate={{
                  y: [-5, 5, -5],
                }}
                transition={{
                  duration: 4,
                  repeat: Infinity,
                }}
                className="
                  glass
                  absolute
                  left-6
                  top-6
                  rounded-lg
                  px-3
                  py-2
                  text-xs
                "
              >

                <span className="text-primary">

                  ●

                </span>

                {" "}
                Live Product Tracking

              </motion.div>

              <motion.div
                animate={{
                  y: [5, -5, 5],
                }}
                transition={{
                  duration: 3,
                  repeat: Infinity,
                }}
                className="
                  glass
                  absolute
                  bottom-6
                  right-6
                  rounded-lg
                  px-3
                  py-2
                  text-xs
                "
              >

                <span className="text-green-400">

                  ●

                </span>

                {" "}
                Systems Online

              </motion.div>

              <motion.div
                animate={{
                  y: [-3, 3, -3],
                }}
                transition={{
                  duration: 3.5,
                  repeat: Infinity,
                }}
                className="
                  glass
                  absolute
                  right-6
                  top-6
                  rounded-lg
                  px-3
                  py-2
                  text-xs
                "
              >

                <span className="text-primary">

                  ●

                </span>

                {" "}
                AI Analysis

              </motion.div>

            </div>

            {/* =================================================
            RESEARCH AREAS
            ================================================= */}

            <div className="mt-6">

              <h4
                className="
                  mb-4
                  text-sm
                  text-muted-foreground
                "
              >

                Áreas Estratégicas

              </h4>

              <div className="flex flex-wrap gap-2">

                {researchAreas.map(
                  (area, i) => (

                  <motion.span
                    key={area}
                    initial={{
                      opacity: 0,
                      scale: 0.9,
                    }}
                    animate={
                      isInView
                        ? {
                            opacity: 1,
                            scale: 1,
                          }
                        : {}
                    }
                    transition={{
                      duration: 0.4,
                      delay:
                        0.5 + i * 0.1,
                    }}
                    className="
                      rounded-full
                      bg-primary/10
                      px-3
                      py-1.5
                      text-xs
                      text-primary
                    "
                  >

                    {area}

                  </motion.span>

                ))}

              </div>

            </div>

          </motion.div>

        </div>

      </div>

    </section>
  )
}
"use client"

import {
  motion,
  useMotionValue,
  useSpring,
  useTransform,
} from "framer-motion"

import { useInView } from "framer-motion"

import {
  useRef,
  useEffect,
} from "react"

import {
  Sparkles,
  Zap,
  Globe,
} from "lucide-react"

export function AboutSection() {

  const ref = useRef(null)

  const isInView = useInView(
    ref,
    {
      once: true,
      margin: "-100px",
    }
  )

  /* =========================================
  MOUSE REACTIVE LIGHT
  ========================================= */

  const mouseX =
    useMotionValue(0)

  const mouseY =
    useMotionValue(0)

  const smoothMouseX =
    useSpring(mouseX, {
      stiffness: 120,
      damping: 20,
    })

  const smoothMouseY =
    useSpring(mouseY, {
      stiffness: 120,
      damping: 20,
    })

  const rotateX =
    useTransform(
      smoothMouseY,
      [-300, 300],
      [8, -8]
    )

  const rotateY =
    useTransform(
      smoothMouseX,
      [-300, 300],
      [-8, 8]
    )

  useEffect(() => {

    const handleMouseMove =
      (e: MouseEvent) => {

        const rect =
          ref.current?.getBoundingClientRect()

        if (!rect) return

        const x =
          e.clientX -
          rect.left -
          rect.width / 2

        const y =
          e.clientY -
          rect.top -
          rect.height / 2

        mouseX.set(x)
        mouseY.set(y)

      }

    window.addEventListener(
      "mousemove",
      handleMouseMove
    )

    return () =>
      window.removeEventListener(
        "mousemove",
        handleMouseMove
      )

  }, [mouseX, mouseY])

  const stats = [
    {
      value: "50+",
      label: "Innovaciones",
      icon: Sparkles,
    },

    {
      value: "15+",
      label: "Países",
      icon: Globe,
    },

    {
      value: "100M+",
      label: "Vidas Impactadas",
      icon: Zap,
    },
  ]

  return (

    <section
      id="about"
      ref={ref}
      className="
        relative
        overflow-hidden
        py-32
        bg-black
      "
    >

      {/* =========================================
      BACKGROUND
      ========================================= */}

      <div className="absolute inset-0 bg-black" />

      <div
        className="
          absolute
          inset-0
          opacity-[0.015]
          bg-[linear-gradient(rgba(255,255,255,0.10)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.10)_1px,transparent_1px)]
          bg-[size:140px_140px]
        "
      />

      <motion.div
        style={{
          x: useTransform(
            smoothMouseX,
            [-300, 300],
            [-40, 40]
          ),

          y: useTransform(
            smoothMouseY,
            [-300, 300],
            [-40, 40]
          ),
        }}
        className="
          pointer-events-none
          absolute
          left-1/2
          top-1/2
          h-[700px]
          w-[700px]
          -translate-x-1/2
          -translate-y-1/2
          rounded-full
          bg-white/[0.03]
          blur-[140px]
        "
      />

      <div
        className="
          relative
          z-10
          mx-auto
          max-w-7xl
          px-6
        "
      >

        <div
          className="
            grid
            items-center
            gap-20
            lg:grid-cols-2
          "
        >

          {/* =========================================
          LEFT CONTENT
          ========================================= */}

          <motion.div
            initial={{
              opacity: 0,
              x: -50,
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
              duration: 1,
              ease: [0.22, 1, 0.36, 1],
            }}
          >

            <span
              className="
                inline-flex
                items-center
                gap-3
                rounded-full
                border
                border-white/10
                bg-white/[0.03]
                px-5
                py-3
                text-[10px]
                uppercase
                tracking-[0.35em]
                text-white/60
                backdrop-blur-md
              "
            >

              <Sparkles className="h-4 w-4" />

              SOBRE NOSOTROS

            </span>

            <h2
              className="
                mt-10
                max-w-3xl
                text-5xl
                font-black
                leading-[0.95]
                tracking-[-0.05em]
                text-white
                sm:text-6xl
              "
            >

              Transformando
              Innovación en
              Sistemas del Futuro

            </h2>

            <div
              className="
                mt-10
                space-y-6
                text-lg
                leading-relaxed
                text-white/55
              "
            >

              <p>

                IMNOVA desarrolla productos,
                tecnologías y ecosistemas
                inteligentes diseñados para
                redefinir la nutrición, el
                bienestar y la evolución humana.

              </p>

              <p>

                Combinamos inteligencia
                artificial, automatización,
                ciencia y diseño futurista
                para construir una nueva
                generación de experiencias.

              </p>

            </div>

            {/* =========================================
            STATS
            ========================================= */}

            <div
              className="
                mt-14
                grid
                grid-cols-3
                gap-5
              "
            >

              {stats.map(
                (
                  stat,
                  index
                ) => (

                <motion.div
                  key={stat.label}
                  initial={{
                    opacity: 0,
                    y: 20,
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
                    duration: 0.6,
                    delay:
                      0.3 +
                      index * 0.1,
                  }}
                  className="
                    rounded-[28px]
                    border
                    border-white/10
                    bg-white/[0.03]
                    p-6
                    text-center
                    backdrop-blur-md
                  "
                >

                  <stat.icon
                    className="
                      mx-auto
                      h-5
                      w-5
                      text-white/60
                    "
                  />

                  <div
                    className="
                      mt-4
                      text-3xl
                      font-black
                      tracking-[-0.05em]
                      text-white
                    "
                  >

                    {stat.value}

                  </div>

                  <div
                    className="
                      mt-2
                      text-[10px]
                      uppercase
                      tracking-[0.30em]
                      text-white/35
                    "
                  >

                    {stat.label}

                  </div>

                </motion.div>

              ))}

            </div>

          </motion.div>

          {/* =========================================
          RIGHT VISUAL
          ========================================= */}

          <motion.div
            initial={{
              opacity: 0,
              x: 50,
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
              duration: 1,
              delay: 0.2,
              ease: [0.22, 1, 0.36, 1],
            }}
            style={{
              rotateX,
              rotateY,
              transformStyle:
                "preserve-3d",
            }}
            className="relative"
          >

            <div
              className="
                relative
                mx-auto
                aspect-square
                max-w-lg
              "
            >

              {/* =========================================
              CENTRAL SYSTEM
              ========================================= */}

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
                    duration: 40,
                    repeat: Infinity,
                    ease: "linear",
                  }}
                  className="
                    absolute
                    inset-10
                    rounded-full
                    border
                    border-white/10
                  "
                />

                <motion.div
                  animate={{
                    rotate: -360,
                  }}
                  transition={{
                    duration: 60,
                    repeat: Infinity,
                    ease: "linear",
                  }}
                  className="
                    absolute
                    inset-0
                    rounded-full
                    border
                    border-white/[0.05]
                  "
                />

                <div
                  className="
                    relative
                    flex
                    h-72
                    w-72
                    items-center
                    justify-center
                    rounded-full
                    border
                    border-white/10
                    bg-white/[0.03]
                    backdrop-blur-xl
                  "
                >

                  <div
                    className="
                      absolute
                      inset-0
                      rounded-full
                      bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.06),transparent_60%)]
                    "
                  />

                  <div className="text-center">

                    <div
                      className="
                        text-6xl
                        font-black
                        tracking-[-0.06em]
                        text-white
                      "
                    >

                      IM

                    </div>

                    <div
                      className="
                        mt-3
                        text-[10px]
                        uppercase
                        tracking-[0.45em]
                        text-white/35
                      "
                    >

                      NOVA SYSTEM

                    </div>

                  </div>

                </div>

              </div>

              {/* =========================================
              FLOATING PANELS
              ========================================= */}

              <motion.div
                animate={{
                  y: [-10, 10, -10],
                }}
                transition={{
                  duration: 5,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
                className="
                  absolute
                  -right-2
                  top-10
                  rounded-[28px]
                  border
                  border-white/10
                  bg-white/[0.03]
                  p-5
                  backdrop-blur-md
                "
              >

                <div className="flex items-center gap-4">

                  <div
                    className="
                      flex
                      h-10
                      w-10
                      items-center
                      justify-center
                      rounded-2xl
                      bg-white/[0.05]
                    "
                  >

                    <Sparkles
                      className="
                        h-5
                        w-5
                        text-white/60
                      "
                    />

                  </div>

                  <div>

                    <div
                      className="
                        text-[10px]
                        uppercase
                        tracking-[0.30em]
                        text-white/35
                      "
                    >

                      STATUS

                    </div>

                    <div
                      className="
                        mt-2
                        text-sm
                        font-semibold
                        text-white
                      "
                    >

                      Innovation Active

                    </div>

                  </div>

                </div>

              </motion.div>

              <motion.div
                animate={{
                  y: [10, -10, 10],
                }}
                transition={{
                  duration: 6,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
                className="
                  absolute
                  -bottom-2
                  -left-2
                  rounded-[28px]
                  border
                  border-white/10
                  bg-white/[0.03]
                  p-5
                  backdrop-blur-md
                "
              >

                <div className="flex items-center gap-4">

                  <div
                    className="
                      flex
                      h-10
                      w-10
                      items-center
                      justify-center
                      rounded-2xl
                      bg-white/[0.05]
                    "
                  >

                    <Zap
                      className="
                        h-5
                        w-5
                        text-white/60
                      "
                    />

                  </div>

                  <div>

                    <div
                      className="
                        text-[10px]
                        uppercase
                        tracking-[0.30em]
                        text-white/35
                      "
                    >

                      SYSTEM

                    </div>

                    <div
                      className="
                        mt-2
                        text-sm
                        font-semibold
                        text-white
                      "
                    >

                      AI Synced

                    </div>

                  </div>

                </div>

              </motion.div>

            </div>

          </motion.div>

        </div>

      </div>

    </section>
  )
}
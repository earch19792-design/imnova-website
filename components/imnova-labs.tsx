"use client"

/* 
================================================
MENÚ PRINCIPAL
SECCIÓN: IMNOVA LABS
COMPONENTE: ImnovaLabs
VERSIÓN: AI CINEMATIC PREMIUM
================================================
*/

import {
  motion,
  useMotionValue,
  useSpring,
  useTransform,
} from "framer-motion"

import {
  useEffect,
} from "react"

const pipelineSteps = [
  {
    title: "IDEA",
    status: "COMPLETADO",
    progress: "10%",
    description:
      "Nacimiento del concepto, visión y validación inicial.",
  },

  {
    title: "VALIDACIÓN",
    status: "COMPLETADO",
    progress: "25%",
    description:
      "Investigación de mercado y análisis estratégico.",
  },

  {
    title: "DISEÑO",
    status: "COMPLETADO",
    progress: "40%",
    description:
      "Branding, packaging, renders y experiencia visual.",
  },

  {
    title: "PROTOTIPO",
    status: "ACTIVO",
    progress: "58%",
    description:
      "Desarrollo técnico y primeras pruebas funcionales.",
  },

  {
    title: "TESTING",
    status: "EN PROCESO",
    progress: "72%",
    description:
      "Optimización, pruebas reales y validación final.",
  },

  {
    title: "PRODUCCIÓN",
    status: "PENDIENTE",
    progress: "85%",
    description:
      "Fabricación, supply chain y escalamiento.",
  },

  {
    title: "LANZAMIENTO",
    status: "PENDIENTE",
    progress: "100%",
    description:
      "Salida oficial al mercado y distribución.",
  },
]

export default function ImnovaLabs() {

  /* =================================================
  MOUSE REACTIVE LIGHT
  ================================================= */

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

  const glowX =
    useTransform(
      smoothMouseX,
      [-500, 500],
      ["45%", "55%"]
    )

  const glowY =
    useTransform(
      smoothMouseY,
      [-500, 500],
      ["45%", "55%"]
    )

  /* =================================================
  GLOBAL MOUSE TRACKING
  ================================================= */

  useEffect(() => {

    const handleMouseMove =
      (e: MouseEvent) => {

        const centerX =
          window.innerWidth / 2

        const centerY =
          window.innerHeight / 2

        mouseX.set(
          e.clientX - centerX
        )

        mouseY.set(
          e.clientY - centerY
        )

      }

    window.addEventListener(
      "mousemove",
      handleMouseMove
    )

    return () => {

      window.removeEventListener(
        "mousemove",
        handleMouseMove
      )

    }

  }, [mouseX, mouseY])

  return (

    <section
      id="imnova-labs"
      className="
        relative
        isolate
        overflow-hidden
        border-t
        border-white/10
        bg-black
        py-36
      "
    >

      {/* =================================================
      BASE BACKGROUND
      ================================================= */}

      <div className="absolute inset-0 bg-black" />

      {/* =================================================
      MOUSE REACTIVE LIGHT
      ================================================= */}

      <motion.div
        style={{
          background:
            `radial-gradient(circle at ${glowX} ${glowY},
            rgba(255,255,255,0.05),
            transparent 35%)`,
        }}
        className="
          pointer-events-none
          absolute
          inset-0
          opacity-80
          blur-3xl
        "
      />

      {/* =================================================
      AMBIENT LIGHTING
      ================================================= */}

      <motion.div
        animate={{
          opacity: [0.3, 0.5, 0.3],
          scale: [1, 1.08, 1],
        }}
        transition={{
          duration: 12,
          repeat: Infinity,
          ease: "easeInOut",
        }}
        className="
          absolute
          right-0
          top-0
          h-[700px]
          w-[700px]
          rounded-full
          bg-white/[0.03]
          blur-[180px]
        "
      />

      {/* =================================================
      GRID
      ================================================= */}

      <div
        className="
          absolute
          inset-0
          opacity-[0.015]
          bg-[linear-gradient(rgba(255,255,255,0.10)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.10)_1px,transparent_1px)]
          bg-[size:120px_120px]
        "
      />

      {/* =================================================
      CONTENT
      ================================================= */}

      <div
        className="
          relative
          z-10
          mx-auto
          max-w-7xl
          px-6
          lg:px-10
        "
      >

        {/* =================================================
        HEADER
        ================================================= */}

        <motion.div
          initial={{
            opacity: 0,
            y: 40,
            filter: "blur(10px)",
          }}
          whileInView={{
            opacity: 1,
            y: 0,
            filter: "blur(0px)",
          }}
          transition={{
            duration: 1,
            ease: [0.22, 1, 0.36, 1],
          }}
          viewport={{ once: true }}
          className="
            max-w-4xl
          "
        >

          {/* BADGE */}

          <div
            className="
              mb-6
              inline-flex
              items-center
              gap-3
              rounded-full
              border
              border-white/10
              bg-white/[0.03]
              px-5
              py-3
              backdrop-blur-md
            "
          >

            <span className="relative flex h-2.5 w-2.5">

              <span
                className="
                  absolute
                  inline-flex
                  h-full
                  w-full
                  animate-ping
                  rounded-full
                  bg-green-400
                  opacity-75
                "
              />

              <span
                className="
                  relative
                  inline-flex
                  h-2.5
                  w-2.5
                  rounded-full
                  bg-green-400
                "
              />

            </span>

            <span
              className="
                text-[10px]
                uppercase
                tracking-[0.35em]
                text-white/60
              "
            >

              IMNOVA LABS • LIVE SYSTEM

            </span>

          </div>

          {/* TITLE */}

          <h2
            className="
              text-5xl
              font-black
              leading-[0.92]
              tracking-[-0.06em]
              text-white
              md:text-7xl
            "
          >

            Del concepto

            <span
              className="
                block
                bg-gradient-to-r
                from-white
                via-zinc-200
                to-zinc-500
                bg-clip-text
                text-transparent
              "
            >

              al mercado.

            </span>

          </h2>

          {/* DIVIDER */}

          <div
            className="
              mt-10
              h-px
              w-24
              rounded-full
              bg-gradient-to-r
              from-transparent
              via-white/30
              to-transparent
            "
          />

          {/* DESCRIPTION */}

          <p
            className="
              mt-10
              max-w-2xl
              text-lg
              leading-relaxed
              text-white/50
            "
          >

            Seguimiento inteligente del
            desarrollo de productos desde
            la idea inicial hasta la expansión
            global del ecosistema IMNOVA™.

          </p>

        </motion.div>

        {/* =================================================
        LIVE STATUS
        ================================================= */}

        <motion.div
          initial={{
            opacity: 0,
            y: 40,
          }}
          whileInView={{
            opacity: 1,
            y: 0,
          }}
          transition={{
            duration: 0.9,
            delay: 0.1,
          }}
          viewport={{ once: true }}
          className="
            mt-16
            flex
            flex-wrap
            gap-4
          "
        >

          {/* SYSTEM */}

          <div
            className="
              rounded-[28px]
              border
              border-white/10
              bg-white/[0.03]
              px-6
              py-5
              backdrop-blur-md
            "
          >

            <div
              className="
                text-[10px]
                uppercase
                tracking-[0.35em]
                text-white/35
              "
            >

              SYSTEM

            </div>

            <div
              className="
                mt-3
                flex
                items-center
                gap-3
              "
            >

              <div
                className="
                  h-2.5
                  w-2.5
                  rounded-full
                  bg-green-400
                "
              />

              <span
                className="
                  font-semibold
                  text-white
                "
              >

                ACTIVE

              </span>

            </div>

          </div>

          {/* PRODUCT */}

          <div
            className="
              rounded-[28px]
              border
              border-white/10
              bg-white/[0.03]
              px-6
              py-5
              backdrop-blur-md
            "
          >

            <div
              className="
                text-[10px]
                uppercase
                tracking-[0.35em]
                text-white/35
              "
            >

              ACTIVE PROJECT

            </div>

            <div
              className="
                mt-3
                font-semibold
                text-white
              "
            >

              MASH NUTRI+

            </div>

          </div>

          {/* STAGE */}

          <div
            className="
              rounded-[28px]
              border
              border-white/10
              bg-white/[0.03]
              px-6
              py-5
              backdrop-blur-md
            "
          >

            <div
              className="
                text-[10px]
                uppercase
                tracking-[0.35em]
                text-white/35
              "
            >

              CURRENT PHASE

            </div>

            <div
              className="
                mt-3
                font-semibold
                text-white
              "
            >

              PROTOTYPE

            </div>

          </div>

        </motion.div>

        {/* =================================================
        ACTION BUTTON
        ================================================= */}

        <motion.button
          whileHover={{
            scale: 1.02,
          }}
          whileTap={{
            scale: 0.98,
          }}
          onClick={async () => {

            await fetch(
              "/api/imnova-labs",
              {
                method: "POST",

                headers: {
                  "Content-Type":
                    "application/json",
                },

                body: JSON.stringify({
                  product:
                    "MASH NUTRI+",

                  status:
                    "TESTING",

                  progress:
                    "72%",
                }),
              }
            )

            alert(
              "WhatsApp enviado 🚀"
            )

          }}
          className="
            mt-10
            rounded-2xl
            border
            border-white/10
            bg-white/[0.03]
            px-7
            py-4
            text-sm
            font-semibold
            uppercase
            tracking-[0.18em]
            text-white
            backdrop-blur-md
            transition-all
            duration-300
            hover:border-white/20
            hover:bg-white/[0.06]
          "
        >

          Test Notification

        </motion.button>

        {/* =================================================
        TIMELINE
        ================================================= */}

        <div className="mt-24 grid gap-6">

          {pipelineSteps.map(
            (
              step,
              index
            ) => (

            <motion.div
              key={step.title}
              initial={{
                opacity: 0,
                y: 50,
                filter: "blur(10px)",
              }}
              whileInView={{
                opacity: 1,
                y: 0,
                filter: "blur(0px)",
              }}
              transition={{
                duration: 0.8,
                delay:
                  index * 0.06,
                ease: [
                  0.22,
                  1,
                  0.36,
                  1,
                ],
              }}
              viewport={{ once: true }}
              className={`
                group
                relative
                overflow-hidden
                rounded-[36px]
                border
                p-8
                backdrop-blur-md
                transition-all
                duration-500

                ${
                  step.status === "ACTIVO"

                    ? `
                      border-white/20
                      bg-white/[0.05]
                    `

                    : `
                      border-white/10
                      bg-white/[0.03]
                    `
                }

                hover:-translate-y-1
                hover:border-white/20
                hover:bg-white/[0.05]
              `}
            >

              {/* =========================================
              LIGHTING
              ========================================= */}

              <div
                className="
                  pointer-events-none
                  absolute
                  inset-0
                  bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.05),transparent_60%)]
                "
              />

              <div className="relative z-10">

                {/* TOP */}

                <div
                  className="
                    flex
                    items-center
                    justify-between
                    gap-6
                  "
                >

                  <div>

                    <div
                      className="
                        text-[10px]
                        uppercase
                        tracking-[0.35em]
                        text-white/35
                      "
                    >

                      ETAPA {index + 1}

                    </div>

                    <h3
                      className="
                        mt-4
                        text-3xl
                        font-black
                        tracking-[-0.05em]
                        text-white
                      "
                    >

                      {step.title}

                    </h3>

                  </div>

                  <div
                    className="
                      rounded-full
                      border
                      border-white/10
                      bg-white/[0.03]
                      px-4
                      py-2
                      text-[10px]
                      uppercase
                      tracking-[0.30em]
                      text-white/55
                    "
                  >

                    {step.status}

                  </div>

                </div>

                {/* DESCRIPTION */}

                <p
                  className="
                    mt-6
                    max-w-2xl
                    leading-relaxed
                    text-white/50
                  "
                >

                  {step.description}

                </p>

                {/* PROGRESS */}

                <div className="mt-8">

                  <div
                    className="
                      mb-4
                      flex
                      items-center
                      justify-between
                    "
                  >

                    <span
                      className="
                        text-[10px]
                        uppercase
                        tracking-[0.30em]
                        text-white/35
                      "
                    >

                      DEVELOPMENT

                    </span>

                    <span
                      className="
                        text-sm
                        font-semibold
                        text-white/60
                      "
                    >

                      {step.progress}

                    </span>

                  </div>

                  <div
                    className="
                      h-[6px]
                      overflow-hidden
                      rounded-full
                      bg-white/5
                    "
                  >

                    <motion.div
                      initial={{
                        width: 0,
                      }}
                      whileInView={{
                        width:
                          step.progress,
                      }}
                      transition={{
                        duration: 1.2,
                      }}
                      viewport={{
                        once: true,
                      }}
                      className="
                        h-full
                        rounded-full
                        bg-white/70
                      "
                    />

                  </div>

                </div>

              </div>

            </motion.div>

          ))}

        </div>

      </div>

    </section>
  )
}
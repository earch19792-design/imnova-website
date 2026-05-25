"use client"

import { motion } from "framer-motion"
import { useInView } from "framer-motion"
import { useEffect, useRef, useState } from "react"

import {
  Rocket,
  FlaskConical,
  Activity,
  Package,
  ArrowUpRight,
  Timer,
  TrendingUp,
  Cpu,
} from "lucide-react"

import { products } from "@/data/products"

type Product = {
  id: number
  name: string
  category: string
  status: string
  progress: number
  phase: string
  nextMilestone: string
  revealDate: string
  labStatus: string

  theme: {
    glow: string
    border: string
    text: string
    bg: string
  }
}

export function EcosystemSection() {

  const ref = useRef(null)

  const isInView = useInView(
    ref,
    {
      once: true,
      margin: "-100px",
    }
  )

  /* =========================================
  LIVE PRODUCTS STATE
  ========================================= */

  const [
    liveProducts,
    setLiveProducts,
  ] = useState<Product[]>(products)

  /* =========================================
  REALTIME SYNC
  ========================================= */

  useEffect(() => {

    const handleUpdate = (
      event: Event
    ) => {

      const customEvent =
        event as CustomEvent

      const updated =
        customEvent.detail

      setLiveProducts((prevProducts) =>

        prevProducts.map((product) =>

          product.id === updated.id

            ? {

                ...product,

                status:
                  updated.status,

                progress:
                  updated.progress,

                phase:
                  updated.phase,

                nextMilestone:
                  updated.nextMilestone,

              }

            : product

        )

      )

    }

    window.addEventListener(
      "productsUpdated",
      handleUpdate as EventListener
    )

    return () => {

      window.removeEventListener(
        "productsUpdated",
        handleUpdate as EventListener
      )

    }

  }, [])

  /* =========================================
  COUNTDOWN
  ========================================= */

  const getCountdown = (
    revealDate: string
  ) => {

    const now =
      new Date().getTime()

    const reveal =
      new Date(
        revealDate
      ).getTime()

    const distance =
      reveal - now

    if (distance <= 0) {

      return "LIVE"

    }

    const days =
      Math.floor(
        distance /
        (1000 * 60 * 60 * 24)
      )

    const hours =
      Math.floor(
        (
          distance %
          (1000 * 60 * 60 * 24)
        ) /
        (1000 * 60 * 60)
      )

    return `${days}D ${hours}H`

  }

  /* =========================================
  LIVE METRICS
  ========================================= */

  const totalProducts =
    liveProducts.length

  const launchReady =
    liveProducts.filter(
      (p) =>
        p.status ===
        "🔥 Preparando lanzamiento"
    ).length

  const testing =
    liveProducts.filter(
      (p) =>
        p.status ===
        "🧪 Probando mejoras"
    ).length

  const avgProgress =
    Math.round(

      liveProducts.reduce(
        (acc, p) =>
          acc + p.progress,
        0
      ) / liveProducts.length

    )

  const metrics = [
    {
      label:
        "Productos Activos",

      value:
        totalProducts,

      icon:
        Package,
    },

    {
      label:
        "Próximos Lanzamientos",

      value:
        launchReady,

      icon:
        Rocket,
    },

    {
      label:
        "En Laboratorio",

      value:
        testing,

      icon:
        FlaskConical,
    },

    {
      label:
        "Desarrollo Global",

      value:
        `${avgProgress}%`,

      icon:
        Activity,
    },
  ]

  return (

    <section
      id="ecosystem"
      ref={ref}
      className="
        relative
        overflow-hidden
        py-32
      "
    >

      {/* =========================================
      BACKGROUND
      ========================================= */}

      <div className="absolute inset-0 bg-black" />

      <div
        className="
          absolute
          top-1/2
          left-1/2
          h-[900px]
          w-[900px]
          -translate-x-1/2
          -translate-y-1/2
          rounded-full
          bg-white/[0.03]
          blur-[180px]
        "
      />

      <div
        className="
          absolute
          inset-0
          opacity-[0.015]
          bg-[linear-gradient(rgba(255,255,255,0.10)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.10)_1px,transparent_1px)]
          bg-[size:140px_140px]
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

        {/* =========================================
        HEADER
        ========================================= */}

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
            duration: 1,
          }}
          className="
            mb-24
            text-center
          "
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

            <Cpu className="h-4 w-4" />

            AI ECOSYSTEM • SEASON 01

          </span>

          <h2
            className="
              mx-auto
              mt-10
              max-w-5xl
              text-5xl
              font-black
              leading-[0.95]
              tracking-[-0.05em]
              text-white
              sm:text-6xl
              lg:text-7xl
            "
          >

            El Ecosistema de
            Innovación del Futuro

          </h2>

          <p
            className="
              mx-auto
              mt-8
              max-w-3xl
              text-lg
              leading-relaxed
              text-white/55
            "
          >

            Un sistema operativo de productos,
            nutrición y tecnología diseñado para
            evolucionar en tiempo real.

          </p>

        </motion.div>

        {/* =========================================
        METRICS
        ========================================= */}

        <div
          className="
            grid
            gap-6
            md:grid-cols-2
            xl:grid-cols-4
          "
        >

          {metrics.map((metric, index) => (

            <motion.div
              key={metric.label}
              initial={{
                opacity: 0,
                y: 40,
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
                duration: 0.7,
                delay: index * 0.05,
              }}
              className="
                group
                relative
                overflow-hidden
                rounded-[32px]
                border
                border-white/10
                bg-white/[0.03]
                p-8
                backdrop-blur-md
                transition-all
                duration-500
                hover:-translate-y-1
                hover:border-white/20
                hover:bg-white/[0.05]
              "
            >

              {/* LIGHT */}

              <div
                className="
                  pointer-events-none
                  absolute
                  inset-0
                  bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.04),transparent_60%)]
                "
              />

              <div
                className="
                  relative
                  z-10
                  flex
                  items-center
                  justify-between
                "
              >

                <div>

                  <p
                    className="
                      text-[10px]
                      uppercase
                      tracking-[0.35em]
                      text-white/35
                    "
                  >

                    {metric.label}

                  </p>

                  <h3
                    className="
                      mt-5
                      text-6xl
                      font-black
                      tracking-[-0.06em]
                      text-white
                    "
                  >

                    {metric.value}

                  </h3>

                  <div
                    className="
                      mt-5
                      flex
                      items-center
                      gap-2
                      text-white/40
                    "
                  >

                    <TrendingUp className="h-4 w-4" />

                    <span className="text-sm">
                      Sistema Activo
                    </span>

                  </div>

                </div>

                <div
                  className="
                    flex
                    h-16
                    w-16
                    items-center
                    justify-center
                    rounded-2xl
                    border
                    border-white/10
                    bg-white/[0.03]
                  "
                >

                  <metric.icon
                    className="
                      h-7
                      w-7
                      text-white/70
                    "
                  />

                </div>

              </div>

            </motion.div>

          ))}

        </div>

        {/* =========================================
        PRODUCTS
        ========================================= */}

        <div
          className="
            mt-20
            grid
            gap-8
            lg:grid-cols-2
          "
        >

          {liveProducts.map((product, index) => (

            <motion.div
              key={product.id}
              initial={{
                opacity: 0,
                y: 50,
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
                duration: 0.7,
                delay: index * 0.08,
              }}
              className="
                group
                relative
                overflow-hidden
                rounded-[36px]
                border
                border-white/10
                bg-white/[0.03]
                p-8
                backdrop-blur-md
                transition-all
                duration-500
                hover:-translate-y-1
                hover:border-white/20
                hover:bg-white/[0.05]
              "
            >

              {/* =========================================
              LIGHTING
              ========================================= */}

              <div
                className="
                  pointer-events-none
                  absolute
                  inset-0
                  bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.04),transparent_60%)]
                "
              />

              <div className="relative z-10">

                {/* =========================================
                TOP
                ========================================= */}

                <div
                  className="
                    flex
                    items-start
                    justify-between
                    gap-6
                  "
                >

                  <div>

                    <div
                      className="
                        inline-flex
                        items-center
                        gap-2
                        rounded-full
                        border
                        border-white/10
                        bg-white/[0.03]
                        px-4
                        py-2
                        text-[10px]
                        uppercase
                        tracking-[0.35em]
                        text-white/50
                      "
                    >

                      <div className="h-2 w-2 rounded-full bg-green-400" />

                      LIVE SYSTEM

                    </div>

                    <h3
                      className="
                        mt-6
                        text-4xl
                        font-black
                        tracking-[-0.05em]
                        text-white
                      "
                    >

                      {product.name}

                    </h3>

                    <p
                      className="
                        mt-4
                        max-w-xl
                        leading-relaxed
                        text-white/55
                      "
                    >

                      {product.phase}

                    </p>

                  </div>

                  <ArrowUpRight
                    className="
                      h-6
                      w-6
                      text-white/30
                      transition-all
                      duration-300
                      group-hover:translate-x-1
                      group-hover:-translate-y-1
                    "
                  />

                </div>

                {/* =========================================
                STATS
                ========================================= */}

                <div
                  className="
                    mt-10
                    grid
                    grid-cols-2
                    gap-5
                  "
                >

                  <div
                    className="
                      rounded-[28px]
                      border
                      border-white/10
                      bg-white/[0.03]
                      p-5
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

                      STATUS

                    </div>

                    <div
                      className="
                        mt-4
                        text-lg
                        font-semibold
                        text-white
                      "
                    >

                      {product.status}

                    </div>

                  </div>

                  <div
                    className="
                      rounded-[28px]
                      border
                      border-white/10
                      bg-white/[0.03]
                      p-5
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

                      DESARROLLO

                    </div>

                    <div
                      className="
                        mt-4
                        text-lg
                        font-semibold
                        text-white
                      "
                    >

                      {product.progress}%

                    </div>

                  </div>

                </div>

                {/* =========================================
                PROGRESS
                ========================================= */}

                <div className="mt-10">

                  <div
                    className="
                      flex
                      items-center
                      justify-between
                    "
                  >

                    <span
                      className="
                        text-[10px]
                        uppercase
                        tracking-[0.35em]
                        text-white/35
                      "
                    >

                      AI PROGRESS

                    </span>

                    <span
                      className="
                        text-sm
                        text-white/45
                      "
                    >

                      {product.progress}% synced

                    </span>

                  </div>

                  <div
                    className="
                      mt-4
                      h-[8px]
                      overflow-hidden
                      rounded-full
                      bg-white/5
                    "
                  >

                    <motion.div
                      initial={{
                        width: 0,
                      }}
                      animate={{
                        width:
                          `${product.progress}%`,
                      }}
                      transition={{
                        duration: 1.2,
                      }}
                      className="
                        h-full
                        rounded-full
                        bg-white/70
                      "
                    />

                  </div>

                </div>

                {/* =========================================
                REVEAL SECTION
                ========================================= */}

                <div
                  className="
                    mt-10
                    rounded-[28px]
                    border
                    border-white/10
                    bg-white/[0.03]
                    p-6
                  "
                >

                  <div
                    className="
                      flex
                      items-center
                      justify-between
                      gap-6
                    "
                  >

                    <div>

                      <p
                        className="
                          text-[10px]
                          uppercase
                          tracking-[0.35em]
                          text-white/35
                        "
                      >

                        NEXT DEPLOYMENT

                      </p>

                      <p
                        className="
                          mt-4
                          text-white/75
                          leading-relaxed
                        "
                      >

                        {product.nextMilestone}

                      </p>

                    </div>

                    <div
                      className="
                        flex
                        items-center
                        gap-3
                        rounded-2xl
                        border
                        border-white/10
                        bg-black/30
                        px-5
                        py-4
                      "
                    >

                      <Timer
                        className="
                          h-5
                          w-5
                          text-white/45
                        "
                      />

                      <span
                        className="
                          text-lg
                          font-black
                          tracking-[-0.04em]
                          text-white
                        "
                      >

                        {getCountdown(
                          product.revealDate
                        )}

                      </span>

                    </div>

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
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

      return "Revelación Disponible"

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
        "Episodios Activos",

      value:
        totalProducts,

      icon:
        Package,
    },

    {
      label:
        "Próximas Revelaciones",

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

      {/* BACKGROUND */}

      <div className="absolute inset-0 bg-gradient-to-b from-background to-secondary/20" />

      <div
        className="
          absolute
          top-1/2
          left-1/2
          h-[800px]
          w-[800px]
          -translate-x-1/2
          -translate-y-1/2
          rounded-full
          bg-primary/5
          blur-[150px]
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

        {/* HEADER */}

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
          className="
            mb-20
            text-center
          "
        >

          <span
            className="
              inline-flex
              items-center
              gap-2
              rounded-full
              border
              border-cyan-400/20
              bg-cyan-400/10
              px-4
              py-2
              text-xs
              uppercase
              tracking-[0.3em]
              text-cyan-300
            "
          >

            TEMPORADA 01™

          </span>

          <h2
            className="
              mt-8
              text-4xl
              font-black
              text-white
              sm:text-5xl
              lg:text-6xl
            "
          >

            EL FUTURO DE LA

            <span className="text-cyan-400">

              {" "}NUTRICIÓN

            </span>

          </h2>

          <p
            className="
              mx-auto
              mt-8
              max-w-3xl
              text-lg
              leading-relaxed
              text-zinc-400
            "
          >

            Una nueva generación de innovación
            desarrollada en tiempo real por IMNOVA™.

          </p>

        </motion.div>

        {/* METRICS */}

        <div
          className="
            grid
            gap-6
            md:grid-cols-2
            xl:grid-cols-4
          "
        >

          {metrics.map((metric) => (

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
                duration: 0.6,
              }}
              className="
                rounded-[30px]
                border
                border-white/10
                bg-white/[0.03]
                p-7
                backdrop-blur-2xl
              "
            >

              <div
                className="
                  flex
                  items-center
                  justify-between
                "
              >

                <div>

                  <p
                    className="
                      text-sm
                      uppercase
                      tracking-[0.25em]
                      text-zinc-500
                    "
                  >

                    {metric.label}

                  </p>

                  <h3
                    className="
                      mt-4
                      text-5xl
                      font-black
                      text-white
                    "
                  >

                    {metric.value}

                  </h3>

                </div>

                <div
                  className="
                    flex
                    h-16
                    w-16
                    items-center
                    justify-center
                    rounded-2xl
                    bg-cyan-400/10
                  "
                >

                  <metric.icon
                    className="
                      h-8
                      w-8
                      text-cyan-300
                    "
                  />

                </div>

              </div>

            </motion.div>

          ))}

        </div>

        {/* PRODUCTS */}

        <div
          className="
            mt-16
            grid
            gap-8
            lg:grid-cols-2
          "
        >

          {liveProducts.map((product) => (

            <motion.div
              key={product.id}
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
                duration: 0.6,
              }}
              className={`
                relative
                overflow-hidden
                rounded-[36px]
                border
                ${product.theme.border}
                bg-white/[0.03]
                p-8
                backdrop-blur-2xl
              `}
            >

              <div
                className={`
                  absolute
                  inset-0
                  bg-gradient-to-br
                  ${product.theme.glow}
                  opacity-[0.03]
                `}
              />

              <div className="relative z-10">

                <div
                  className={`
                    inline-flex
                    rounded-full
                    border
                    ${product.theme.border}
                    ${product.theme.bg}
                    px-4
                    py-2
                    text-xs
                    uppercase
                    tracking-[0.3em]
                    ${product.theme.text}
                  `}
                >

                  {product.category}

                </div>

                <div className="mt-6">

                  <p
                    className="
                      text-xs
                      uppercase
                      tracking-[0.3em]
                      text-zinc-500
                    "
                  >

                    EPISODIO 0{product.id}

                  </p>

                  <h3
                    className="
                      mt-3
                      flex
                      items-center
                      gap-2
                      text-4xl
                      font-black
                      text-white
                    "
                  >

                    {product.name}

                    <ArrowUpRight
                      className="
                        h-5
                        w-5
                        text-cyan-300
                      "
                    />

                  </h3>

                </div>

                <p
                  className="
                    mt-4
                    text-zinc-400
                    leading-relaxed
                  "
                >

                  {product.phase}

                </p>

                <div
                  className="
                    mt-8
                    flex
                    items-center
                    justify-between
                  "
                >

                  <div>

                    <p
                      className="
                        text-xs
                        uppercase
                        tracking-[0.25em]
                        text-zinc-500
                      "
                    >

                      Estado Público

                    </p>

                    <p
                      className={`
                        mt-3
                        text-lg
                        font-bold
                        ${product.theme.text}
                      `}
                    >

                      {product.status}

                    </p>

                  </div>

                  <div className="text-right">

                    <p
                      className="
                        text-xs
                        uppercase
                        tracking-[0.25em]
                        text-zinc-500
                      "
                    >

                      Desarrollo

                    </p>

                    <p
                      className={`
                        mt-3
                        text-lg
                        font-bold
                        ${product.theme.text}
                      `}
                    >

                      {product.progress}%

                    </p>

                  </div>

                </div>

                <div
                  className="
                    mt-6
                    h-3
                    overflow-hidden
                    rounded-full
                    bg-white/10
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
                      duration: 1,
                    }}
                    className={`
                      h-full
                      rounded-full
                      bg-gradient-to-r
                      ${product.theme.glow}
                    `}
                  />

                </div>

                <div
                  className="
                    mt-8
                    rounded-3xl
                    border
                    border-cyan-400/10
                    bg-cyan-400/[0.04]
                    p-5
                  "
                >

                  <div
                    className="
                      flex
                      items-center
                      justify-between
                    "
                  >

                    <div>

                      <p
                        className="
                          text-xs
                          uppercase
                          tracking-[0.25em]
                          text-zinc-500
                        "
                      >

                        Próxima Revelación

                      </p>

                      <p
                        className="
                          mt-3
                          text-cyan-300
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
                      "
                    >

                      <Timer
                        className="
                          h-5
                          w-5
                          text-cyan-300
                        "
                      />

                      <span
                        className="
                          text-lg
                          font-black
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
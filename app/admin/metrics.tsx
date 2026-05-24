"use client"

import { useEffect, useState } from "react"

import {
  Package,
  Rocket,
  Activity,
  FlaskConical,
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
}

export function Metrics() {

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

      console.log(
        "EVENTO RECIBIDO METRICS",
        event
      )

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
  DEBUG
  ========================================= */

  console.log(
    "LIVE PRODUCTS",
    liveProducts
  )

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
        "Innovaciones Activas",

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

    <div
      className="
        grid
        gap-6
        md:grid-cols-2
        xl:grid-cols-4
      "
    >

      {metrics.map((metric) => (

        <div
          key={metric.label}
          className="
            rounded-[30px]
            border
            border-white/10
            bg-white/[0.03]
            p-7
            backdrop-blur-2xl
            shadow-[0_0_50px_rgba(0,255,255,0.03)]
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

              <h2
                className="
                  mt-4
                  text-5xl
                  font-black
                  text-white
                "
              >

                {metric.value}

              </h2>

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

        </div>

      ))}

    </div>

  )
}
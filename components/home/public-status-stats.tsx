"use client"

import { useEffect, useState } from "react"

import { products } from "@/data/products"

type Product = {
  id: number
  status: string
}

export function PublicStatusStats() {

  const [conceptCount, setConceptCount] =
    useState(0)

  const [
    upcomingCount,
    setUpcomingCount,
  ] = useState(0)

  const [
    availableCount,
    setAvailableCount,
  ] = useState(0)

  /* =========================================
  LOAD PRODUCT STATES
  ========================================= */

  useEffect(() => {

    let concept = 0
    let upcoming = 0
    let available = 0

    products.forEach((product) => {

      const saved =
        localStorage.getItem(
          `product-${product.id}`
        )

      const parsed =
        saved
          ? JSON.parse(saved)
          : product

      const status =
        parsed.status

      /* =========================================
      PUBLIC STATUS MAPPING
      ========================================= */

      if (
        status === "⚡ Concepto" ||
        status === "🧪 Probando mejoras"
      ) {

        concept++

      }

      else if (
        status ===
          "🔥 Preparando lanzamiento" ||

        status ===
          "🏭 Producción" ||

        status ===
          "🌎 Comercialización"
      ) {

        upcoming++

      }

      else if (
        status ===
        "🚀 Disponible"
      ) {

        available++

      }

    })

    setConceptCount(concept)

    setUpcomingCount(upcoming)

    setAvailableCount(available)

  }, [])

  /* =========================================
  UI
  ========================================= */

  const stats = [

    {
      value: conceptCount,
      label: "Concepto",
      icon: "⚡",
    },

    {
      value: upcomingCount,
      label: "Próximamente",
      icon: "🔥",
    },

    {
      value: availableCount,
      label: "Disponible",
      icon: "🚀",
    },
  ]

  return (

    <div
      className="
        mt-16
        grid
        gap-6
        sm:grid-cols-3
      "
    >

      {stats.map((stat) => (

        <div
          key={stat.label}
          className="
            rounded-[28px]
            border
            border-white/10
            bg-white/[0.03]
            p-6
            text-center
            backdrop-blur-2xl
          "
        >

          <div className="text-4xl">
            {stat.icon}
          </div>

          <div
            className="
              mt-4
              text-4xl
              font-black
              text-white
            "
          >

            {stat.value}

          </div>

          <div
            className="
              mt-3
              text-xs
              uppercase
              tracking-[0.25em]
              text-zinc-500
            "
          >

            {stat.label}

          </div>

        </div>

      ))}

    </div>
  )
}
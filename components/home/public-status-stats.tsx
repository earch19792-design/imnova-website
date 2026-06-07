"use client"

import { useEffect, useState } from "react"

import {
  getProducts,
  getProductStates,
} from "@/lib/products-service"
import { motion } from "framer-motion"

type Product = {
  state_id: string | null
}

type ProductState = {
  id: string
  name: string
}

export function PublicStatusStats() {

  const [conceptCount, setConceptCount] =
    useState(0)

  

  const [
  developmentCount,
  setDevelopmentCount,
] = useState(0)
const [
  availableCount,
  setAvailableCount,
] = useState(0)

  /* =========================================
  LOAD PRODUCT STATES
  ========================================= */

  useEffect(() => {

    async function loadProductStates() {

      const products =
        await getProducts()

      const states =
        await getProductStates()

      const stateMap =
        new Map(
          (states as ProductState[]).map(
            (state) => [
              state.id,
              state.name,
            ]
          )
        )

      let concept = 0
      let development = 0
      let available = 0

      ;(products as Product[]).forEach(
        (product) => {

          const stateName =
            product.state_id
              ? stateMap.get(
                  product.state_id
                )
              : null

          /* =========================================
          PUBLIC STATUS MAPPING
          ========================================= */

          if (
            stateName === "Idea" ||
            stateName === "Validación" ||
            stateName === "Priorizado"
          ) {

            concept++

          }

          else if (

            stateName === "Testing" ||
            stateName === "Producción" ||
            stateName === "Comercialización"

          ) {

            development++

          }

          else if (

            stateName === "Disponible"

          ) {

            available++

          }

        }
      )

      setConceptCount(concept)

      setDevelopmentCount(development)

      setAvailableCount(available)

    }

    loadProductStates()

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
  value: developmentCount,
  label: "Desarrollo",
  icon: "🧪",
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
      transition-all
      duration-300
      hover:-translate-y-3
      hover:scale-105
      hover:border-cyan-400/30
      hover:bg-white/[0.05]
    "
  >

          <motion.div
  className="text-4xl"
  animate={{
    y: [0, -4, 0],
  }}
  transition={{
    duration: 3,
    repeat: Infinity,
    ease: "easeInOut",
  }}
>
  {stat.icon}
</motion.div>
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

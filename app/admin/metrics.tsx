"use client"

import {
  Package,
  Rocket,
  FlaskConical,
  Store,
} from "lucide-react"

type Product = {
  id: string
  state_id: string | null
}

type ProductState = {
  id: string
  name: string
  progress: number
}

type MetricsProps = {
  products: Product[]
  states: ProductState[]
}

function normalizeStateName(
  name?: string
) {
  return (
    name || ""
  )
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .toLowerCase()
    .trim()
}

export function Metrics({
  products,
  states,
}: MetricsProps) {

  const getState =
    (stateId: string | null) =>
      states.find(
        (state) =>
          state.id === stateId
      )

  const countByStateNames =
    (
      stateNames: string[]
    ) => {

      const normalizedNames =
        new Set(
          stateNames.map(
            normalizeStateName
          )
        )

      return products.filter(
        (product) =>
          normalizedNames.has(
            normalizeStateName(
              getState(
                product.state_id
              )?.name
            )
          )
      ).length

    }

  const earlyStageProducts =
    countByStateNames([
      "Idea",
      "Validación",
      "Priorizado",
    ])

  const developmentProducts =
    countByStateNames([
      "Testing",
      "Producción",
    ])

  const commercializationProducts =
    countByStateNames([
      "Comercialización",
    ])

  const availableProducts =
    countByStateNames([
      "Disponible",
    ])

  const metrics = [
    {
      label:
        "Ideas / Validación",
      value:
        earlyStageProducts,
      icon:
        Package,
    },
    {
      label:
        "Desarrollo",
      value:
        developmentProducts,
      icon:
        FlaskConical,
    },
    {
      label:
        "Comercialización",
      value:
        commercializationProducts,
      icon:
        Rocket,
    },
    {
      label:
        "Disponibles",
      value:
        availableProducts,
      icon:
        Store,
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

      {
        metrics.map(
          (metric) => (

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

          )
        )
      }

    </div>

  )

}

"use client"

import {
  Package,
  Rocket,
  Activity,
  FlaskConical,
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

  const totalProducts =
    products.length

  const launchReady =
    products.filter(
      (product) =>
        getState(product.state_id)?.name ===
        "Comercialización"
    ).length

  const testing =
    products.filter(
      (product) =>
        getState(product.state_id)?.name ===
        "Testing"
    ).length

  const avgProgress =
    products.length > 0
      ? Math.round(
          products.reduce(
            (acc, product) =>
              acc +
              (
                getState(product.state_id)
                  ?.progress || 0
              ),
            0
          ) / products.length
        )
      : 0

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
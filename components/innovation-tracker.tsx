"use client"

import { products }
from "@/data/products"

export function InnovationTracker() {

  return (

    <section
      className="
        px-6
        py-24
      "
    >

      <div
        className="
          mx-auto
          max-w-6xl
        "
      >

        <div className="mb-14">

          <p
            className="
              mb-4
              text-sm
              uppercase
              tracking-[0.3em]
              text-cyan-300
            "
          >

            IMNOVA LABS

          </p>

          <h2
            className="
              text-4xl
              font-black
              text-white
            "
          >

            Desarrollo
            de Innovaciones

          </h2>

        </div>

        <div
          className="
            grid
            gap-8
            md:grid-cols-2
          "
        >

          {products.map((product) => (

            <div
              key={product.id}
              className="
                rounded-[32px]
                border
                border-white/10
                bg-white/[0.03]
                p-8
                backdrop-blur-xl
              "
            >

              <div className="mb-6">

                <div
                  className="
                    mb-4
                    inline-flex
                    rounded-full
                    border
                    border-cyan-400/20
                    px-4
                    py-2
                    text-xs
                    uppercase
                    tracking-[0.25em]
                    text-cyan-300
                  "
                >

                  {product.category}

                </div>

                <h3
                  className="
                    mb-3
                    text-3xl
                    font-black
                    text-white
                  "
                >

                  {product.name}

                </h3>

                <p
                  className="
                    text-white/60
                  "
                >

                  {product.phase}

                </p>

              </div>

              <div className="mb-5">

                <div
                  className="
                    mb-2
                    flex
                    items-center
                    justify-between
                  "
                >

                  <span className="text-white/70">
                    Progreso
                  </span>

                  <span className="text-cyan-300">
                    {product.progress}%
                  </span>

                </div>

                <div
                  className="
                    h-3
                    overflow-hidden
                    rounded-full
                    bg-white/10
                  "
                >

                  <div
                    style={{
                      width:
                        `${product.progress}%`,
                    }}
                    className="
                      h-full
                      rounded-full
                      bg-gradient-to-r
                      from-cyan-400
                      to-blue-500
                    "
                  />

                </div>

              </div>

              <div className="space-y-3">

                <div>

                  <p
                    className="
                      text-xs
                      uppercase
                      tracking-[0.2em]
                      text-white/40
                    "
                  >

                    Estado

                  </p>

                  <p className="text-white">

                    {product.status}

                  </p>

                </div>

                <div>

                  <p
                    className="
                      text-xs
                      uppercase
                      tracking-[0.2em]
                      text-white/40
                    "
                  >

                    Próximo Hito

                  </p>

                  <p className="text-white">

                    {product.nextMilestone}

                  </p>

                </div>

              </div>

            </div>

          ))}

        </div>

      </div>

    </section>

  )

}
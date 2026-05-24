/*
================================================
MENÚ PRINCIPAL
SECCIÓN: NOSOTROS / ABOUT US
================================================
*/

import { InnovationTracker }
from "@/components/innovation-tracker"

export const metadata = {
  title: "Nosotros | IMNOVA GROUP LLC",
  description:
    "IMNOVA GROUP LLC es una empresa especializada en innovación, comercio internacional y desarrollo de marcas enfocadas en ecommerce global.",
}

export default function AboutPage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-black via-zinc-950 to-black text-white px-6 py-24">

      <div className="max-w-6xl mx-auto">

        {/* Botón volver */}
        <a
          href="/"
          className="
            inline-flex
            items-center
            mb-12
            text-sm
            text-zinc-500
            hover:text-white
            transition-colors
            tracking-wide
          "
        >
          ← Volver al inicio
        </a>

        {/* Hero principal */}
        <section className="relative">

          <p
            className="
              uppercase
              tracking-[0.3em]
              text-zinc-500
              text-sm
            "
          >

            Innovación · Ecommerce · Tecnología

          </p>

          <h1
            className="
              text-5xl
              md:text-7xl
              font-black
              mt-6
              leading-tight
            "
          >

            IMNOVA GROUP LLC

          </h1>

          <div
            className="
              w-24
              h-[2px]
              bg-white/20
              mt-8
              rounded-full
            "
          />

          <p
            className="
              mt-10
              text-zinc-300
              text-lg
              md:text-xl
              leading-relaxed
              max-w-4xl
            "
          >

            IMNOVA GROUP LLC es una empresa especializada en comercio
            internacional, innovación tecnológica y desarrollo de marcas
            enfocadas en plataformas digitales de alto crecimiento.

          </p>

          <p
            className="
              mt-6
              text-zinc-400
              leading-relaxed
              max-w-4xl
            "
          >

            La compañía desarrolla soluciones modernas orientadas a mejorar la
            calidad de vida de las personas mediante productos funcionales,
            tecnología inteligente y estrategias de ecommerce internacional.

          </p>

          <p
            className="
              mt-6
              text-zinc-400
              leading-relaxed
              max-w-4xl
            "
          >

            Nuestro enfoque combina diseño, innovación y funcionalidad para
            crear productos adaptados a las nuevas tendencias del mercado
            global, ofreciendo experiencias prácticas, eficientes y alineadas
            con el futuro del comercio digital.

          </p>

        </section>

        {/* TRACKER */}
        <section className="mt-28">

          <InnovationTracker />

        </section>

        {/* Información corporativa */}
        <section className="mt-20">

          <h2 className="text-3xl font-bold">

            Información Corporativa

          </h2>

          <div
            className="
              grid
              md:grid-cols-2
              gap-6
              mt-10
            "
          >

            <div
              className="
                border
                border-zinc-800
                rounded-3xl
                p-8
                bg-zinc-950/60
                backdrop-blur
              "
            >

              <h3
                className="
                  text-xl
                  font-semibold
                  mb-3
                "
              >

                Fundadores

              </h3>

              <p
                className="
                  text-zinc-400
                  leading-relaxed
                "
              >

                Elio Jose Hurtado Espinoza
                <br />

                Ernesto Rodriguez Chavarria

              </p>

            </div>

            <div
              className="
                border
                border-zinc-800
                rounded-3xl
                p-8
                bg-zinc-950/60
                backdrop-blur
              "
            >

              <h3
                className="
                  text-xl
                  font-semibold
                  mb-3
                "
              >

                Correo Corporativo

              </h3>

              <p className="text-zinc-400">

                ceo@vital4life-usa.com

              </p>

            </div>

            <div
              className="
                border
                border-zinc-800
                rounded-3xl
                p-8
                bg-zinc-950/60
                backdrop-blur
              "
            >

              <h3
                className="
                  text-xl
                  font-semibold
                  mb-3
                "
              >

                Teléfono

              </h3>

              <p className="text-zinc-400">

                +505 5819-9840

              </p>

            </div>

            <div
              className="
                border
                border-zinc-800
                rounded-3xl
                p-8
                bg-zinc-950/60
                backdrop-blur
              "
            >

              <h3
                className="
                  text-xl
                  font-semibold
                  mb-3
                "
              >

                Dirección Comercial

              </h3>

              <p
                className="
                  text-zinc-400
                  leading-relaxed
                "
              >

                8534 NW 70th St
                <br />

                Miami, FL 33166

              </p>

            </div>

            <div
              className="
                border
                border-zinc-800
                rounded-3xl
                p-8
                bg-zinc-950/60
                backdrop-blur
                md:col-span-2
              "
            >

              <h3
                className="
                  text-xl
                  font-semibold
                  mb-3
                "
              >

                Marcas Comerciales

              </h3>

              <p className="text-zinc-400">

                MASH COFFEE+ · PURA+

              </p>

            </div>

          </div>

        </section>

        {/* Actividad comercial */}
        <section className="mt-24">

          <h2 className="text-3xl font-bold">

            Actividad Comercial

          </h2>

          <div
            className="
              mt-10
              border
              border-zinc-800
              rounded-3xl
              p-10
              bg-zinc-950/60
              backdrop-blur
            "
          >

            <p
              className="
                text-zinc-300
                leading-relaxed
                text-lg
              "
            >

              IMNOVA GROUP LLC desarrolla productos private label orientados a
              bebidas funcionales, café premium, mezclas nutricionales y
              soluciones wellness diseñadas para ecommerce internacional y
              marketplaces globales.

            </p>

            <p
              className="
                mt-6
                text-zinc-400
                leading-relaxed
              "
            >

              Actualmente la empresa trabaja en coordinación con proveedores
              internacionales, desarrollo de fórmulas, diseño de empaques,
              actividades de trademark en Estados Unidos, pruebas de laboratorio
              y preparación estratégica para lanzamiento comercial en plataformas
              digitales.

            </p>

          </div>

        </section>

        {/* Misión */}
        <section className="mt-24">

          <h2 className="text-3xl font-bold">

            Nuestra Misión

          </h2>

          <div
            className="
              mt-10
              border
              border-zinc-800
              rounded-3xl
              p-10
              bg-zinc-950/60
              backdrop-blur
            "
          >

            <p
              className="
                text-zinc-300
                text-lg
                leading-relaxed
              "
            >

              Crear productos innovadores y soluciones inteligentes que aporten
              valor real a la vida cotidiana de las personas, integrando
              tecnología, funcionalidad y diseño moderno para el mercado global.

            </p>

          </div>

        </section>

      </div>

    </main>
  )
}
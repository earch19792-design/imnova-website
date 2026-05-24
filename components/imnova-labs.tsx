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
  return (
    <section
      id="imnova-labs"
      className="
        relative
        overflow-hidden
        border-t
        border-white/10
        bg-black
        py-32
      "
    >

      {/* BACKGROUND */}

      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(0,255,255,0.08),transparent_30%)]" />

      {/* GRID */}

      <div className="absolute inset-0 opacity-[0.02] bg-[linear-gradient(rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.08)_1px,transparent_1px)] bg-[size:120px_120px]" />

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

        {/* HEADER */}

        <div className="max-w-3xl">

          <div
            className="
              mb-5
              inline-flex
              items-center
              gap-3
              rounded-full
              border
              border-cyan-400/20
              bg-white/[0.03]
              px-5
              py-3
              backdrop-blur-xl
            "
          >

            <div className="h-2 w-2 rounded-full bg-cyan-300 shadow-[0_0_18px_rgba(0,255,255,0.8)]" />

            <span
              className="
                text-[10px]
                uppercase
                tracking-[0.35em]
                text-cyan-300
              "
            >

              IMNOVA LABS

            </span>

          </div>

          <h2
            className="
              text-5xl
              md:text-6xl
              font-black
              leading-[0.95]
              tracking-[-0.06em]
              text-white
            "
          >

            Del concepto

            <span
              className="
                block
                bg-gradient-to-r
                from-cyan-200
                via-blue-300
                to-white
                bg-clip-text
                text-transparent
              "
            >

              al mercado.

            </span>

          </h2>

          <p
            className="
              mt-8
              max-w-2xl
              text-lg
              leading-8
              text-zinc-400
            "
          >

            Seguimiento del desarrollo de productos
            desde la idea inicial hasta su lanzamiento.

          </p>

        </div>

        {/* LIVE STATUS */}

        <div
          className="
            mt-16
            flex
            flex-wrap
            items-center
            gap-4
          "
        >

          <div
            className="
              flex
              items-center
              gap-3
              rounded-2xl
              border
              border-cyan-400/20
              bg-cyan-400/[0.06]
              px-5
              py-4
              shadow-[0_0_30px_rgba(0,255,255,0.10)]
            "
          >

            <div className="h-2 w-2 rounded-full bg-cyan-300 animate-pulse" />

            <span
              className="
                text-[10px]
                uppercase
                tracking-[0.30em]
                text-cyan-300
              "
            >

              SISTEMA ACTIVO

            </span>

          </div>

          <div
            className="
              rounded-2xl
              border
              border-white/10
              bg-white/[0.03]
              px-5
              py-4
            "
          >

            <span
              className="
                text-[10px]
                uppercase
                tracking-[0.30em]
                text-white/50
              "
            >

              PROYECTO ACTUAL

            </span>

            <div className="mt-2 text-white font-semibold">

              MASH NUTRI+

            </div>

          </div>

          <div
            className="
              rounded-2xl
              border
              border-white/10
              bg-white/[0.03]
              px-5
              py-4
            "
          >

            <span
              className="
                text-[10px]
                uppercase
                tracking-[0.30em]
                text-white/50
              "
            >

              ETAPA ACTIVA

            </span>

            <div className="mt-2 text-cyan-300 font-semibold">

              PROTOTIPO

            </div>

          </div>

        </div>

        {/* TEST BUTTON */}

        <button
          onClick={async () => {

            await fetch("/api/imnova-labs", {
              method: "POST",

              headers: {
                "Content-Type": "application/json",
              },

              body: JSON.stringify({
                product: "MASH NUTRI+",
                status: "TESTING",
                progress: "72%",
              }),
            })

            alert("WhatsApp enviado 🚀")

          }}
          className="
            mt-10
            rounded-2xl
            border
            border-cyan-400/20
            bg-cyan-400/[0.08]
            px-6
            py-4
            text-sm
            font-medium
            text-cyan-300
            transition-all
            duration-300
            hover:bg-cyan-400/[0.12]
          "
        >

          TEST WHATSAPP

        </button>

        {/* TIMELINE */}

        <div className="mt-24 grid gap-6">

          {pipelineSteps.map((step, index) => (

            <div
              key={step.title}
              className={`
                relative
                overflow-hidden
                rounded-[32px]
                border
                p-8
                backdrop-blur-xl
                transition-all
                duration-300

                ${
                  step.status === "ACTIVO"
                    ? `
                      border-cyan-400/30
                      bg-cyan-400/[0.06]
                      shadow-[0_0_40px_rgba(0,255,255,0.12)]
                    `
                    : `
                      border-white/10
                      bg-white/[0.03]
                    `
                }

                hover:border-cyan-400/20
                hover:bg-white/[0.05]
              `}
            >

              {/* GLOW */}

              <div className="absolute inset-0 bg-gradient-to-r from-cyan-400/[0.02] to-transparent" />

              <div className="relative z-10">

                <div className="flex items-center justify-between">

                  <h3
                    className="
                      text-2xl
                      font-black
                      tracking-[-0.04em]
                      text-white
                    "
                  >

                    {step.title}

                  </h3>

                  <span
                    className="
                      text-[10px]
                      uppercase
                      tracking-[0.30em]
                      text-cyan-300
                    "
                  >

                    ETAPA {index + 1}

                  </span>

                </div>

                <p
                  className="
                    mt-4
                    max-w-xl
                    leading-7
                    text-zinc-400
                  "
                >

                  {step.description}

                </p>

                <div className="mt-6 flex items-center justify-between">

                  <span
                    className="
                      text-[10px]
                      uppercase
                      tracking-[0.30em]
                      text-cyan-300
                    "
                  >

                    {step.status}

                  </span>

                  <span
                    className="
                      text-sm
                      font-medium
                      text-white/60
                    "
                  >

                    {step.progress}

                  </span>

                </div>

                {/* PROGRESS BAR */}

                <div
                  className="
                    mt-5
                    h-[5px]
                    overflow-hidden
                    rounded-full
                    bg-white/5
                  "
                >

                  <div
                    className="
                      h-full
                      rounded-full
                      bg-gradient-to-r
                      from-cyan-300
                      to-blue-500
                    "
                    style={{
                      width: step.progress,
                    }}
                  />

                </div>

              </div>

            </div>

          ))}

        </div>

      </div>

    </section>
  )
}
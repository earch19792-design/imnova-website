"use client"

import {
  Activity,
  Sparkles,
  Rocket,
  FlaskConical,
  Zap,
} from "lucide-react"

const activities = [

  {
    icon:
      FlaskConical,

    title:
      "Nueva fórmula energética aprobada",

    description:
      "MASH COFFEE+ superó la fase de testing avanzado con mejoras en rendimiento y estabilidad.",

    time:
      "Hace 2 horas",

    status:
      "LAB UPDATE",
  },

  {
    icon:
      Zap,

    title:
      "Optimización nutricional completada",

    description:
      "MASH NUTRI+ recibió ajustes finales para mejorar textura y absorción.",

    time:
      "Hace 5 horas",

    status:
      "OPTIMIZATION",
  },

  {
    icon:
      Sparkles,

    title:
      "Packaging oficial revelado",

    description:
      "Nuevo diseño premium preparado para la próxima fase de lanzamiento.",

    time:
      "Hoy",

    status:
      "REVEAL",
  },

  {
    icon:
      Rocket,

    title:
      "Próximo lanzamiento programado",

    description:
      "El laboratorio IMNOVA™ está preparando nuevas innovaciones para revelación pública.",

    time:
      "En progreso",

    status:
      "LIVE",
  },

]

export function ActivityFeed() {

  return (

    <div
      className="
        relative
        overflow-hidden
        rounded-[36px]
        border
        border-cyan-400/10
        bg-white/[0.03]
        p-8
        backdrop-blur-2xl
      "
    >

      {/* GLOW */}
      <div
        className="
          absolute
          inset-0
          bg-[radial-gradient(circle_at_top,rgba(0,255,255,0.08),transparent_40%)]
        "
      />

      <div className="relative z-10">

        {/* HEADER */}
        <div
          className="
            flex
            items-center
            justify-between
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
                border-cyan-400/20
                bg-cyan-400/10
                px-4
                py-2
              "
            >

              <Activity
                className="
                  h-4
                  w-4
                  text-cyan-300
                "
              />

              <span
                className="
                  text-xs
                  uppercase
                  tracking-[0.3em]
                  text-cyan-300
                "
              >

                LIVE DEVELOPMENT™

              </span>

            </div>

            <h2
              className="
                mt-5
                text-4xl
                font-black
                text-white
              "
            >

              Actividad del Laboratorio

            </h2>

            <p
              className="
                mt-4
                max-w-2xl
                text-zinc-400
              "
            >

              Sigue en tiempo real el desarrollo
              de las próximas innovaciones de
              IMNOVA™.

            </p>

          </div>

          {/* LIVE STATUS */}
          <div
            className="
              hidden
              items-center
              gap-3
              rounded-2xl
              border
              border-cyan-400/20
              bg-cyan-400/10
              px-5
              py-4
              lg:flex
            "
          >

            <div
              className="
                h-3
                w-3
                rounded-full
                bg-cyan-400
                animate-pulse
                shadow-[0_0_20px_rgba(0,255,255,0.7)]
              "
            />

            <div>

              <p
                className="
                  text-xs
                  uppercase
                  tracking-[0.25em]
                  text-cyan-300
                "
              >

                IMNOVA LAB STATUS

              </p>

              <p
                className="
                  mt-1
                  font-bold
                  text-white
                "
              >

                ACTIVE

              </p>

            </div>

          </div>

        </div>

        {/* FEED */}
        <div className="mt-12 space-y-6">

          {activities.map((activity) => (

            <div
              key={activity.title}
              className="
                group
                relative
                overflow-hidden
                rounded-[28px]
                border
                border-white/5
                bg-white/[0.02]
                p-6
                transition-all
                duration-500
                hover:border-cyan-400/20
                hover:bg-cyan-400/[0.03]
              "
            >

              {/* HOVER GLOW */}
              <div
                className="
                  absolute
                  inset-0
                  opacity-0
                  transition-opacity
                  duration-500
                  group-hover:opacity-100
                  bg-[radial-gradient(circle_at_top,rgba(0,255,255,0.08),transparent_60%)]
                "
              />

              <div
                className="
                  relative
                  z-10
                  flex
                  gap-5
                "
              >

                {/* ICON */}
                <div
                  className="
                    flex
                    h-14
                    w-14
                    items-center
                    justify-center
                    rounded-2xl
                    bg-cyan-400/10
                    border
                    border-cyan-400/10
                  "
                >

                  <activity.icon
                    className="
                      h-6
                      w-6
                      text-cyan-300
                    "
                  />

                </div>

                {/* CONTENT */}
                <div className="flex-1">

                  <div
                    className="
                      flex
                      flex-wrap
                      items-center
                      gap-3
                    "
                  >

                    <span
                      className="
                        rounded-full
                        border
                        border-cyan-400/20
                        bg-cyan-400/10
                        px-3
                        py-1
                        text-[10px]
                        font-bold
                        uppercase
                        tracking-[0.25em]
                        text-cyan-300
                      "
                    >

                      {activity.status}

                    </span>

                    <span
                      className="
                        text-sm
                        text-zinc-500
                      "
                    >

                      {activity.time}

                    </span>

                  </div>

                  <h3
                    className="
                      mt-4
                      text-2xl
                      font-bold
                      text-white
                    "
                  >

                    {activity.title}

                  </h3>

                  <p
                    className="
                      mt-4
                      max-w-3xl
                      leading-relaxed
                      text-zinc-400
                    "
                  >

                    {activity.description}

                  </p>

                </div>

              </div>

            </div>

          ))}

        </div>

      </div>

    </div>

  )
}
"use client"

import {
  LayoutDashboard,
  Activity,
  Package,
  BarChart3,
  Settings,
} from "lucide-react"

export function Sidebar() {

  const items = [
    {
      label: "Dashboard",
      icon: LayoutDashboard,
    },
    {
      label: "Productos",
      icon: Package,
    },
    {
      label: "Actividad",
      icon: Activity,
    },
    {
      label: "Analytics",
      icon: BarChart3,
    },
    {
      label: "Configuración",
      icon: Settings,
    },
  ]

  return (

    <aside
      className="
        fixed
        left-0
        top-0
        z-50
        flex
        h-screen
        w-[280px]
        flex-col
        border-r
        border-white/10
        bg-black/70
        backdrop-blur-3xl
      "
    >

      {/* LOGO */}
      <div
        className="
          flex
          items-center
          gap-4
          border-b
          border-white/10
          px-8
          py-8
        "
      >

        <div
          className="
            flex
            h-14
            w-14
            items-center
            justify-center
            rounded-2xl
            bg-gradient-to-br
            from-cyan-400
            to-blue-500
            shadow-[0_0_40px_rgba(0,255,255,0.25)]
          "
        >

          <span
            className="
              text-2xl
              font-black
              text-white
            "
          >

            I

          </span>

        </div>

        <div>

          <h1
            className="
              text-xl
              font-black
              text-white
            "
          >

            IMNOVA LABS™

          </h1>

          <p
            className="
              mt-1
              text-xs
              uppercase
              tracking-[0.3em]
              text-cyan-300
            "
          >

            Control Center

          </p>

        </div>

      </div>

      {/* MENU */}
      <div
        className="
          flex
          flex-1
          flex-col
          gap-3
          px-5
          py-8
        "
      >

        {items.map((item) => (

          <button
            key={item.label}
            className="
              flex
              items-center
              gap-4
              rounded-2xl
              border
              border-white/5
              bg-white/[0.03]
              px-5
              py-4
              text-left
              transition-all
              duration-300
              hover:border-cyan-400/20
              hover:bg-cyan-400/[0.05]
            "
          >

            <div
              className="
                flex
                h-11
                w-11
                items-center
                justify-center
                rounded-xl
                bg-cyan-400/10
              "
            >

              <item.icon
                className="
                  h-5
                  w-5
                  text-cyan-300
                "
              />

            </div>

            <span
              className="
                text-sm
                font-medium
                text-white
              "
            >

              {item.label}

            </span>

          </button>

        ))}

      </div>

      {/* FOOTER */}
      <div
        className="
          border-t
          border-white/10
          p-6
        "
      >

        <div
          className="
            rounded-2xl
            border
            border-cyan-400/20
            bg-cyan-400/10
            p-5
          "
        >

          <p
            className="
              text-xs
              uppercase
              tracking-[0.25em]
              text-cyan-300
            "
          >

            Sistema Operativo

          </p>

          <h3
            className="
              mt-3
              text-lg
              font-bold
              text-white
            "
          >

            IMNOVA ECOSYSTEM™

          </h3>

        </div>

      </div>

    </aside>

  )
}
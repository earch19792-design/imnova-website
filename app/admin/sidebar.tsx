"use client"

import {
  Package,
  BarChart3,
  UsersRound,
  Send,
  Target,
  Radar,
  Trophy,
} from "lucide-react"

type SidebarProps = {
  selectedMenu: string
  setSelectedMenu: (
    menu: string
  ) => void
}

export function Sidebar({
  selectedMenu,
  setSelectedMenu,
}: SidebarProps) {
  const items = [
    {
      label: "Comunidad",
      description:
        "Miembros, consentimientos, VIP y referidos.",
      step: "01",
      icon: UsersRound,
      value: "community",
    },
    {
      label: "Oportunidades",
      description:
        "Radar, ideas, encuestas y demanda no cubierta.",
      step: "02",
      icon: Target,
      value: "opportunities",
    },
    {
      label: "Productos",
      description:
        "Validacion, desarrollo, produccion y disponible.",
      step: "03",
      icon: Package,
      value: "products",
    },
    {
      label: "Comunicacion",
      description:
        "WhatsApp, email, campanas, plantillas y logs.",
      step: "04",
      icon: Send,
      value: "communication",
    },
    {
      label: "Analytics",
      description:
        "Conversion, votos, ventas, engagement y errores.",
      step: "05",
      icon: BarChart3,
      value: "analytics",
    },
    {
      label: "Market Radar",
      description:
        "Stock, precios, ofertas y rotacion externa.",
      step: "06",
      icon: Radar,
      value: "market-radar",
    },
    {
      label: "eBay Seller OS",
      description:
        "Radar, Pipeline, Listing y Review.",
      step: "07",
      icon: Trophy,
      value: "ebay-winner-pipeline",
    },
  ]

  return (
    <aside
      className="
        hidden
        lg:flex
        fixed
        left-0
        top-0
        z-50
        h-screen
        w-[280px]
        flex-col
        overflow-hidden
        border-r
        border-white/10
        bg-black/70
        backdrop-blur-3xl
      "
    >
      <div
        className="
          flex
          items-center
          gap-4
          shrink-0
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
            IMNOVA LABS
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

      <div
        className="
          flex
          flex-1
          flex-col
          gap-3
          overflow-y-auto
          overscroll-contain
          pl-5
          pr-3
          py-8
          [scrollbar-width:thin]
        "
      >
        {items.map((item) => (
          <button
            key={item.label}
            onClick={() =>
              setSelectedMenu(item.value)
            }
            className={`
              flex
              items-center
              gap-4
              rounded-2xl
              border
              px-5
              py-4
              text-left
              transition-all
              duration-300

              ${
                selectedMenu === item.value
                  ? "border-cyan-400/30 bg-cyan-400/10"
                  : "border-white/5 bg-white/[0.03]"
              }

              hover:border-cyan-400/20
              hover:bg-cyan-400/[0.05]
            `}
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

            <div className="min-w-0 flex-1">
              <div
                className="
                  flex
                  items-center
                  justify-between
                  gap-3
                "
              >
                <span
                  className="
                    text-sm
                    font-medium
                    text-white
                  "
                >
                  {item.label}
                </span>

                <span
                  className="
                    rounded-full
                    border
                    border-white/10
                    px-2
                    py-1
                    text-[9px]
                    uppercase
                    tracking-[0.18em]
                    text-cyan-100/50
                  "
                >
                  {item.step}
                </span>
              </div>

              <p
                className="
                  mt-2
                  text-xs
                  leading-5
                  text-white/40
                "
              >
                {item.description}
              </p>
            </div>
          </button>
        ))}

        <div className="grid gap-3">
          {[
            {
              href: "/admin/ebay-pro",
              eyebrow: "Staging/Lab",
              title: "eBay Pro Suite",
              detail:
                "Modulo profesional eBay bloqueado en produccion.",
            },
            {
              href: "/admin/marketplace-os",
              eyebrow: "Centro de venta",
              title: "Marketplace OS",
              detail:
                "Productos, bloqueos, margen y proxima accion.",
            },
            {
              href: "/admin/market-radar",
              eyebrow: "Hub ligero",
              title: "Market Radar",
              detail:
                "Descubrir oportunidades, stock, descuentos y señales.",
            },
            {
              href: "/admin/ebay-seller-os",
              eyebrow: "Hub ligero",
              title: "eBay Seller OS",
              detail:
                "Colas del vendedor, rescates, packs y decisiones.",
            },
            {
              href: "/admin/ebay-listing",
              eyebrow: "Hub ligero",
              title: "eBay Listing",
              detail:
                "Preparar listing, imágenes, gates y payload dry run.",
            },
          ].map((hub) => (
            <a
              key={hub.href}
              href={hub.href}
              className="
                block
                rounded-2xl
                border
                border-white/10
                bg-white/[0.035]
                px-5
                py-4
                text-left
                transition-all
                duration-300
                hover:border-cyan-300/25
                hover:bg-cyan-300/[0.06]
              "
            >
              <span className="text-[10px] font-black uppercase tracking-[0.28em] text-cyan-100/45">
                {hub.eyebrow}
              </span>
              <span className="mt-2 block text-sm font-black text-white">
                {hub.title}
              </span>
              <span className="mt-1 block text-xs leading-5 text-white/45">
                {hub.detail}
              </span>
            </a>
          ))}
        </div>

        <a
          href="/admin/ebay-listings"
          className="
            block
            rounded-2xl
            border
            border-cyan-300/15
            bg-cyan-300/[0.05]
            px-5
            py-4
            text-left
            transition-all
            duration-300
            hover:border-cyan-300/30
            hover:bg-cyan-300/[0.08]
          "
        >
          <span className="text-[10px] font-black uppercase tracking-[0.28em] text-cyan-100/50">
            Read-only
          </span>
          <span className="mt-2 block text-sm font-black text-white">
            eBay Proposals
          </span>
          <span className="mt-1 block text-xs leading-5 text-white/45">
            Candidate ideas | No eBay API | No draft
          </span>
        </a>

        <a
          href="/admin/ebay-listing-package"
          className="
            block
            rounded-2xl
            border
            border-cyan-300/15
            bg-cyan-300/[0.05]
            px-5
            py-4
            text-left
            transition-all
            duration-300
            hover:border-cyan-300/30
            hover:bg-cyan-300/[0.08]
          "
        >
          <span className="text-[10px] font-black uppercase tracking-[0.28em] text-cyan-100/50">
            eBay Seller OS
          </span>
          <span className="mt-2 block text-sm font-black text-white">
            Centro de venta
          </span>
          <span className="mt-1 block text-xs leading-5 text-white/45">
            Radar → Pipeline → Listing → Review
          </span>
          <span className="mt-3 grid grid-cols-2 gap-1.5 text-[10px] font-black uppercase tracking-[0.08em] text-cyan-50/70">
            <span className="rounded-md border border-cyan-300/15 bg-black/20 px-2 py-1">
              Radar
            </span>
            <span className="rounded-md border border-cyan-300/15 bg-black/20 px-2 py-1">
              Pipeline
            </span>
            <span className="rounded-md border border-cyan-300/15 bg-black/20 px-2 py-1">
              Listing
            </span>
            <span className="rounded-md border border-cyan-300/15 bg-black/20 px-2 py-1">
              Review
            </span>
          </span>
          <span className="mt-3 block rounded-md border border-red-300/20 bg-red-300/[0.08] px-2 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-red-50/75">
            eBay real bloqueado
          </span>
        </a>

        <a
          href="/admin/ebay-image-generator"
          className="
            block
            rounded-2xl
            border
            border-cyan-300/15
            bg-cyan-300/[0.05]
            px-5
            py-4
            text-left
            transition-all
            duration-300
            hover:border-cyan-300/30
            hover:bg-cyan-300/[0.08]
          "
        >
          <span className="text-[10px] font-black uppercase tracking-[0.28em] text-cyan-100/50">
            Image Dry Run
          </span>
          <span className="mt-2 block text-sm font-black text-white">
            Image Dry Run
          </span>
          <span className="mt-1 block text-xs leading-5 text-white/45">
            PromptPlan + safety check | No image generated
          </span>
        </a>

        <div
          className="
            mt-5
            border-t
            border-white/10
            pt-5
            pb-6
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
            Guia operativa
          </p>

          <h3
            className="
              mt-3
              text-lg
              font-bold
              text-white
            "
          >
            Flujo Admin
          </h3>

          <div
            className="
              mt-5
              space-y-3
              border-t
              border-cyan-100/10
              pt-5
            "
          >
            {[
              "Comunidad",
              "Oportunidades",
              "Productos",
              "Comunicacion",
              "Analytics",
              "Market Radar",
              "eBay Pipeline",
            ].map((step, index) => (
              <div
                key={step}
                className="
                  flex
                  items-center
                  gap-3
                  text-[11px]
                  uppercase
                  tracking-[0.18em]
                  text-cyan-100/55
                "
              >
                <span
                  className="
                    flex
                    h-6
                    w-6
                    items-center
                    justify-center
                    rounded-full
                    border
                    border-cyan-100/15
                    text-[10px]
                    text-cyan-100/70
                  "
                >
                  {index + 1}
                </span>
                {step}
              </div>
            ))}
          </div>
        </div>
      </div>
      </div>
    </aside>
  )
}

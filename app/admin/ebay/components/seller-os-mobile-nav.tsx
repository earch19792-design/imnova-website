"use client"

type SellerOsDestination = "home" | "opportunities" | "in-progress" | "operation"

const destinations: Array<{
  id: SellerOsDestination
  href: string
  icon: string
  label: string
}> = [
  { id: "home", href: "/admin/ebay-seller-os", icon: "⌂", label: "Inicio" },
  { id: "opportunities", href: "/admin/ebay/mobile-review", icon: "⌕", label: "Oportunidades" },
  { id: "in-progress", href: "/admin/ebay/mobile-review?section=in-progress", icon: "◷", label: "En curso" },
  { id: "operation", href: "/admin/ebay-seller-os#operacion", icon: "▦", label: "Operación" },
]

export function SellerOsMobileNav({
  active,
  operationCount = 0,
  onNavigate,
}: {
  active: SellerOsDestination
  operationCount?: number
  onNavigate?: (destination: SellerOsDestination) => boolean | void
}) {
  return (
    <nav
      aria-label="Navegación principal de Seller OS"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-white/15 bg-[#070b12]/95 px-2 pb-[env(safe-area-inset-bottom)] pt-2 backdrop-blur"
    >
      <div className="mx-auto grid max-w-xl grid-cols-4 gap-1">
        {destinations.map((destination) => {
          const selected = active === destination.id
          return (
            <a
              key={destination.id}
              href={destination.href}
              aria-current={selected ? "page" : undefined}
              onClick={(event) => {
                if (!onNavigate) return
                const handled = onNavigate(destination.id)
                if (handled) event.preventDefault()
              }}
              className={`relative flex min-h-14 flex-col items-center justify-center rounded-xl text-[11px] font-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-cyan-200 ${selected ? "bg-white text-black" : "text-white/65"}`}
            >
              <span aria-hidden="true" className="text-lg">{destination.icon}</span>
              {destination.label}
              {destination.id === "operation" && operationCount > 0 && (
                <span className="absolute right-2 top-1 rounded-full bg-rose-500 px-1.5 text-[10px] text-white">
                  {operationCount}
                </span>
              )}
            </a>
          )
        })}
      </div>
    </nav>
  )
}

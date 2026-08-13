import {
  BarChart3,
  FileText,
  FlaskConical,
  LayoutDashboard,
  Lightbulb,
  Package,
  Settings2,
  ShoppingBag,
  Sparkles,
  UsersRound,
  type LucideIcon,
} from "lucide-react"

import {
  SELLER_OS_NAVIGATION,
  SELLER_OS_NAVIGATION_GROUPS,
  type SellerOsAreaId,
  type SellerOsNavigationItem,
} from "@/lib/seller-os/navigation"

const icons: Record<SellerOsNavigationItem["icon"], LucideIcon> = {
  monitor: LayoutDashboard,
  file: FileText,
  sparkles: Sparkles,
  flask: FlaskConical,
  inventory: Package,
  orders: ShoppingBag,
  decisions: BarChart3,
  learning: Lightbulb,
  system: Settings2,
}

export function SellerOsDesktopNavigation({ active }: { active: SellerOsAreaId }) {
  const activeItem = SELLER_OS_NAVIGATION.find((item) => item.id === active) ??
    SELLER_OS_NAVIGATION[0]
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[232px] flex-col border-r border-white/10 bg-[#101b2c] px-3 py-4 text-slate-100 xl:flex">
      <a href="/admin/ebay/monitor" className="flex items-center gap-3 rounded-xl px-2 py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-cyan-300 text-[#101b2c]">
          <BarChart3 size={20} />
        </span>
        <span>
          <span className="block text-base font-black tracking-tight">IMNOVA</span>
          <span className="block text-[13px] font-bold uppercase tracking-[0.16em] text-cyan-200">Seller OS</span>
        </span>
      </a>

      <nav aria-label="Navegación principal de Seller OS" className="mt-3 space-y-1.5">
        {SELLER_OS_NAVIGATION_GROUPS.map((group) => {
          const entries = SELLER_OS_NAVIGATION.filter((item) => item.group === group.id)
          return (
            <div key={group.id}>
              <p className="px-3 text-[13px] font-black uppercase tracking-[0.12em] text-slate-500">{group.label}</p>
              <div className="mt-1 space-y-0.5">
                {entries.map((item) => {
                  const Icon = icons[item.icon]
                  const selected = item.id === active
                  return (
                    <a
                      key={item.id}
                      href={item.href}
                      aria-current={selected ? "page" : undefined}
                      title={item.description}
                      className={`flex min-h-8 items-center gap-2.5 rounded-lg px-3 py-1 text-[15px] font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200 ${selected ? "bg-cyan-300 text-[#102033]" : "text-slate-300 hover:bg-white/[0.06] hover:text-white"}`}
                    >
                      <Icon size={17} aria-hidden="true" />
                      <span className="truncate">{item.label}</span>
                    </a>
                  )
                })}
              </div>
            </div>
          )
        })}
      </nav>

      <section aria-label={`Ayuda de ${activeItem.label}`} className="mt-auto rounded-xl border border-cyan-200/15 bg-cyan-200/[0.06] p-3">
        <p className="text-[13px] font-black uppercase tracking-[0.1em] text-cyan-200">Estás en {activeItem.label}</p>
        <p className="mt-1 text-[13px] leading-[18px] text-slate-300">{activeItem.description}</p>
        <p className="mt-1 text-[13px] leading-[18px] text-white"><strong>Objetivo:</strong> {activeItem.objective}</p>
      </section>

      <div className="mt-2 flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.05] p-2.5">
        <span className="grid h-9 w-9 place-items-center rounded-full bg-slate-700"><UsersRound size={16} /></span>
        <span>
          <span className="block text-sm font-bold">Administrador</span>
          <span className="block text-[13px] text-slate-400">Acceso protegido</span>
        </span>
      </div>
    </aside>
  )
}

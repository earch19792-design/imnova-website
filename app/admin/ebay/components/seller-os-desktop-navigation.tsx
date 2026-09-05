import {
  Activity,
  BarChart3,
  Boxes,
  FlaskConical,
  Gauge,
  Home,
  PackageCheck,
  Settings2,
  ShoppingBag,
  Sparkles,
  type LucideIcon,
} from "lucide-react"

import {
  SELLER_OS_PRIMARY_NAVIGATION,
  SELLER_OS_SYSTEM_NAVIGATION,
  type SellerOsAreaId,
  type SellerOsNavigationItem,
} from "@/lib/seller-os/navigation"

const icons: Record<SellerOsNavigationItem["icon"], LucideIcon> = {
  home: Home,
  publish: PackageCheck,
  opportunities: Sparkles,
  live: Activity,
  sales: ShoppingBag,
  "post-sale": Gauge,
  mayel: BarChart3,
  stockguard: Boxes,
  administration: Settings2,
  experiments: FlaskConical,
}

function NavigationGroup({ label, items, active }: {
  label: string
  items: readonly SellerOsNavigationItem[]
  active: SellerOsAreaId
}) {
  return <section className="mt-5">
    <p className="px-3 text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">
      {label}
    </p>
    <div className="mt-1.5 space-y-1">
      {items.map((item) => {
        const Icon = icons[item.icon]
        const selected = item.id === active
        return <div key={item.id}>
          <a href={item.href} aria-current={selected ? "page" : undefined}
            title={item.description}
            className={`flex min-h-11 items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200 ${selected ? "bg-cyan-300 text-[#102033]" : "text-slate-300 hover:bg-white/[0.06] hover:text-white"}`}>
            <Icon size={18} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {item.status === "PAUSED" && <span
              className="text-[9px] font-black uppercase">Pausa</span>}
          </a>
          {selected && item.children.length > 0 && <nav
            aria-label={`Secciones de ${item.label}`}
            className="ml-5 mt-1 space-y-0.5 border-l border-white/10 pl-2">
            {item.children.map((child) => <a key={child.id} href={child.href}
              className="flex min-h-9 items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-[12px] font-semibold text-slate-400 hover:bg-white/[0.05] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200">
              <span>{child.label}</span>
              {child.status === "PAUSED" && <span
                className="text-[9px] uppercase text-amber-200">Pausa</span>}
            </a>)}
          </nav>}
        </div>
      })}
    </div>
  </section>
}

export function SellerOsDesktopNavigation({ active }: {
  active: SellerOsAreaId
}) {
  const activeItem = [...SELLER_OS_PRIMARY_NAVIGATION,
    ...SELLER_OS_SYSTEM_NAVIGATION].find((item) => item.id === active) ??
      SELLER_OS_PRIMARY_NAVIGATION[0]
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[272px] flex-col overflow-y-auto border-r border-white/10 bg-[#101b2c] px-3 py-4 text-slate-100 xl:flex">
      <a href="/admin"
        className="flex items-center gap-3 rounded-xl px-2 py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-cyan-300 text-[#101b2c]">
          <BarChart3 size={20} />
        </span>
        <span>
          <span className="block text-base font-black tracking-tight">IMNOVA</span>
          <span className="block text-[13px] font-bold uppercase tracking-[0.16em] text-cyan-200">Seller OS</span>
        </span>
      </a>

      <NavigationGroup label="Operación" items={SELLER_OS_PRIMARY_NAVIGATION}
        active={active} />
      <NavigationGroup label="Sistema" items={SELLER_OS_SYSTEM_NAVIGATION}
        active={active} />

      <section aria-label={`Ayuda de ${activeItem.label}`}
        className="mt-5 rounded-xl border border-cyan-200/15 bg-cyan-200/[0.06] p-3">
        <p className="text-[11px] font-black uppercase tracking-[0.1em] text-cyan-200">
          Estás en {activeItem.label}
        </p>
        <p className="mt-1 text-[12px] leading-[18px] text-slate-300">
          {activeItem.description}
        </p>
      </section>
    </aside>
  )
}

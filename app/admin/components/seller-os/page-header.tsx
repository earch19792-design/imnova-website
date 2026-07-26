import type { ReactNode } from "react"

export type SellerOsPageBreadcrumb = {
  label: string
  href: string | null
}

export function PageHeader({
  eyebrow,
  title,
  description,
  breadcrumbs = [],
  action,
}: {
  eyebrow?: string
  title: string
  description?: string
  breadcrumbs?: SellerOsPageBreadcrumb[]
  action?: ReactNode
}) {
  return (
    <header className="rounded-3xl border border-white/10 bg-black/25 p-5 text-white sm:p-6">
      {breadcrumbs.length > 0 && (
        <nav aria-label="Migas de pan">
          <ol className="flex flex-wrap items-center gap-2 text-xs text-white/55">
            {breadcrumbs.map((item, index) => (
              <li key={`${item.label}-${index}`} className="flex items-center gap-2">
                {index > 0 && <span aria-hidden="true">/</span>}
                {item.href
                  ? <a href={item.href} className="min-h-11 py-3 font-bold hover:text-white">{item.label}</a>
                  : <span aria-current="page" className="font-bold text-white">{item.label}</span>}
              </li>
            ))}
          </ol>
        </nav>
      )}
      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          {eyebrow && <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-100/60">{eyebrow}</p>}
          <h1 className="mt-1 text-2xl font-black leading-tight sm:text-3xl">{title}</h1>
          {description && <p className="mt-2 text-sm leading-6 text-white/65">{description}</p>}
        </div>
        {action}
      </div>
    </header>
  )
}

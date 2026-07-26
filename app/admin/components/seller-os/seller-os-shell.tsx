"use client"

import { usePathname } from "next/navigation"
import { useEffect, useState, type ReactNode } from "react"

import { resolveSellerOsRoute } from "@/lib/seller-os/route-resolution"
import { GlobalActivityDock } from "./global-activity-dock"
import { PrimaryNavigation } from "./primary-navigation"
import { UtilityNavigation } from "./utility-navigation"
import styles from "./seller-os-shell.module.css"

type BrowserLocation = {
  search: string
  hash: string
}

const EMPTY_LOCATION: BrowserLocation = { search: "", hash: "" }

export function SellerOsShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const [browserLocation, setBrowserLocation] = useState(EMPTY_LOCATION)

  useEffect(() => {
    const synchronizeLocation = () => {
      setBrowserLocation({
        search: window.location.search,
        hash: window.location.hash,
      })
    }
    synchronizeLocation()
    window.addEventListener("hashchange", synchronizeLocation)
    window.addEventListener("popstate", synchronizeLocation)
    return () => {
      window.removeEventListener("hashchange", synchronizeLocation)
      window.removeEventListener("popstate", synchronizeLocation)
    }
  }, [pathname])

  if (pathname === "/admin/login") return children

  const resolved = resolveSellerOsRoute({
    pathname,
    search: browserLocation.search,
    hash: browserLocation.hash,
  })
  const content = (
    <div
      id="seller-os-main-content"
      tabIndex={-1}
      className={styles.pageContent}
    >
      <nav aria-label="Migas de pan" className={styles.breadcrumbs}>
        <ol>
          {resolved.breadcrumbs.map((item, index) => (
            <li key={`${item.label}-${index}`}>
              {index > 0 && <span aria-hidden="true">/</span>}
              {item.href
                ? <a href={item.href}>{item.label}</a>
                : <span aria-current="page">{item.label}</span>}
            </li>
          ))}
        </ol>
      </nav>
      {children}
    </div>
  )

  return (
    <div className={styles.shell}>
      <a href="#seller-os-main-content" className={styles.skipLink}>
        Saltar al contenido principal
      </a>
      <header className={styles.shellHeader}>
        <a href="/admin" className={styles.brand}>
          <span aria-hidden="true" className={styles.brandMark}>I</span>
          <span>
            <strong>IMNOVA</strong>
            <small>Seller OS</small>
          </span>
        </a>
        <UtilityNavigation activeUtility={resolved.utility} />
        <PrimaryNavigation activeArea={resolved.area} />
      </header>

      <div className={styles.workspace}>
        <div className={styles.activityDock}>
          <GlobalActivityDock journeyHref="/admin/ebay-seller-os#operacion" />
        </div>
        {pathname === "/admin"
          ? <main>{content}</main>
          : content}
      </div>
    </div>
  )
}

"use client"

import {
  Activity,
  FileText,
  Home,
  Package,
  Search,
  type LucideIcon,
} from "lucide-react"

import {
  SELLER_OS_NAVIGATION,
  type SellerOsAreaId,
} from "@/lib/seller-os/navigation"
import styles from "./seller-os-shell.module.css"

const icons: Record<SellerOsAreaId, LucideIcon> = {
  home: Home,
  opportunities: Search,
  products: FileText,
  operations: Package,
  monitoring: Activity,
}

export function PrimaryNavigation({ activeArea }: { activeArea: SellerOsAreaId }) {
  return (
    <nav aria-label="Áreas principales de Seller OS" className={styles.primaryNavigation}>
      <ul className={styles.primaryNavigationList}>
        {SELLER_OS_NAVIGATION.map((item) => {
          const Icon = icons[item.id]
          const active = item.id === activeArea
          return (
            <li key={item.id}>
              <a
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`${styles.primaryNavigationLink} ${
                  active ? styles.primaryNavigationLinkActive : ""
                }`}
                title={item.description}
              >
                <Icon aria-hidden="true" size={19} strokeWidth={active ? 2.6 : 2} />
                <span className={styles.desktopLabel}>{item.label}</span>
                <span className={styles.mobileLabel}>{item.mobileLabel}</span>
              </a>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

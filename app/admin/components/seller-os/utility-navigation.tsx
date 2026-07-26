"use client"

import {
  SELLER_OS_UTILITY_NAVIGATION,
  type SellerOsUtilityId,
} from "@/lib/seller-os/navigation"
import styles from "./seller-os-shell.module.css"

export function UtilityNavigation({
  activeUtility,
}: {
  activeUtility: SellerOsUtilityId | null
}) {
  return (
    <nav aria-label="Herramientas de Seller OS" className={styles.utilityNavigation}>
      <ul>
        {SELLER_OS_UTILITY_NAVIGATION.map((item) => (
          <li key={item.id}>
            <a
              href={item.href}
              aria-current={activeUtility === item.id ? "page" : undefined}
              className={activeUtility === item.id ? styles.utilityLinkActive : undefined}
              title={item.description}
            >
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}

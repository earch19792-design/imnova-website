import type { ReactNode } from "react"

import { AdminOwnerRuntimeProvider } from "./admin-owner-runtime-provider"

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminOwnerRuntimeProvider>{children}</AdminOwnerRuntimeProvider>
}

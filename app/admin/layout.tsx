import { SellerOsPilotBanner } from "./components/seller-os-pilot-banner"

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      <SellerOsPilotBanner />
      {children}
    </>
  )
}

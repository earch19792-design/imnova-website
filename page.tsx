import { Navigation } from "@/components/navigation"
import { HeroSection } from "@/components/hero-section"
import { AboutSection } from "@/components/about-section"
import { EcosystemSection } from "@/components/ecosystem-section"
import { InnovationsSection } from "@/components/innovations-section"
import ImnovaLabs from "@/components/imnova-labs"
import { MissionSection } from "@/components/mission-section"
import { TechnologySection } from "@/components/technology-section"
import { FutureSection } from "@/components/future-section"
import { GlobalSection } from "@/components/global-section"
import { PartnersSection } from "@/components/partners-section"
import { ContactSection } from "@/components/contact-section"
import { JoinClubSection } from "@/components/join-club-section"
import { Footer } from "@/components/footer"

export default function IMNOVAPage() {
  return (
    <main className="relative overflow-hidden">
      <Navigation />
      <HeroSection />
      <AboutSection />
      <EcosystemSection />
      <InnovationsSection />
      <MissionSection />
      <TechnologySection />
      <FutureSection />
      <GlobalSection />
      <PartnersSection />
      <ContactSection />
      <Footer />
    </main>
  )
}

import { ResearchWorkerControlOwnerGateV1 } from
  "./research-worker-control-owner-gate-v1"
import NormalResearchPage from "./normal-research-page"

type ResearchPageSearchParams = Promise<Record<string, string | string[] | undefined>>

export default async function MarketResearchRoute({
  searchParams,
}: {
  searchParams: ResearchPageSearchParams
}) {
  const params = await searchParams
  if (params.browserWorkerControl === "1") {
    return <ResearchWorkerControlOwnerGateV1 />
  }
  return <NormalResearchPage />
}

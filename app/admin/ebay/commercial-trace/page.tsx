"use client"

import { Suspense } from "react"
import { useSearchParams } from "next/navigation"

import { Skeleton } from "@/components/ui/skeleton"
import { CommercialTraceWorkspace } from
  "./commercial-trace-workspace"

function CommercialTracePageContent() {
  const search = useSearchParams()
  return <CommercialTraceWorkspace
    requestedTraceId={search.get("traceId")?.trim() ?? ""} />
}

export default function CommercialTracePage() {
  return <Suspense fallback={<main className="min-h-screen bg-[#08111d] p-6 text-white">
    <div className="mx-auto max-w-[1480px] space-y-5">
      <Skeleton className="h-10 w-44 bg-white/[0.06]" />
      <Skeleton className="h-72 rounded-[1.8rem] bg-white/[0.06]" />
      <Skeleton className="h-[30rem] rounded-[1.8rem] bg-white/[0.06]" />
    </div>
  </main>}>
    <CommercialTracePageContent />
  </Suspense>
}

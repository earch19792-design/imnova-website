export function getEbayWinnerAdminDashboard(args?: {
  supabase: any
  filters?: {
    state?: string
    complianceStatus?: string
    draftStatus?: string
    search?: string
  }
  page?: number
  limit?: number
}): Promise<Record<string, any>>

export function getEbayWinnerCandidateDetail(args: {
  supabase: any
  candidateId: string
}): Promise<Record<string, any> | null>

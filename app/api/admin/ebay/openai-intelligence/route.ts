export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"

import {
  getEbayOpenAiIntelligenceRegistryProjection,
} from "@/lib/ebay/ebay-openai-intelligence-registry"
import {
  getEbayOpenAiModelRouterConfiguration,
} from "@/lib/ebay/ebay-openai-intelligence-gateway"
import { getEbaySellerAccountScopeConfiguration } from
  "@/lib/ebay/ebay-seller-account-scope"
import {
  getSupabaseAdminClient,
  validateAdminApiRequest,
} from "@/lib/supabase-admin"

function response(payload: unknown, status = 200) {
  const result = NextResponse.json(payload, { status })
  result.headers.set("Cache-Control", "private, no-store, max-age=0")
  return result
}

export async function GET(req: Request) {
  const auth = await validateAdminApiRequest(req)
  if (!auth.ok || !auth.userId) {
    return response({
      success: false,
      error: auth.error ?? "OPENAI_INTELLIGENCE_HUMAN_ADMIN_REQUIRED",
    }, auth.status || 403)
  }
  const registry = getEbayOpenAiIntelligenceRegistryProjection()
  const router = getEbayOpenAiModelRouterConfiguration()
  const accountKey =
    getEbaySellerAccountScopeConfiguration().accountKey
  const supabase = getSupabaseAdminClient()
  const [configs, metrics, recent] = await Promise.all([
    supabase.from("ebay_openai_use_case_configs")
      .select("use_case_id,version,enabled,mode,kill_switch_engaged,model_tier,prompt_version,schema_version,daily_budget_micros,monthly_budget_micros,per_product_budget_micros,per_invocation_budget_micros,updated_at")
      .order("use_case_id"),
    accountKey
      ? supabase.from("ebay_openai_intelligence_metrics_v1")
        .select("*")
        .eq("marketplace_account_key", accountKey)
        .order("metric_date", { ascending: false })
        .limit(30)
      : Promise.resolve({ data: [], error: null }),
    accountKey
      ? supabase.from("ebay_openai_invocations")
        .select("id,use_case_id,status,mode,model_tier,prompt_version,schema_version,estimated_cost_micros,actual_cost_micros,input_tokens,cached_input_tokens,cache_write_tokens,output_tokens,error_code,created_at,completed_at")
        .eq("marketplace_account_key", accountKey)
        .order("created_at", { ascending: false })
        .limit(20)
      : Promise.resolve({ data: [], error: null }),
  ])
  const migrationError = configs.error ?? metrics.error ?? recent.error
  return response({
    success: true,
    registry,
    migrationReady: !migrationError,
    migrationError: migrationError
      ? "OPENAI_INTELLIGENCE_MIGRATION_NOT_READY" : null,
    configuration: configs.data ?? [],
    metrics: metrics.data ?? [],
    recentInvocations: recent.data ?? [],
    modelRouter: {
      economyConfigured: Boolean(router.ECONOMY),
      balancedConfigured: Boolean(router.BALANCED),
      advancedConfigured: Boolean(router.ADVANCED),
      imageConfigured: Boolean(router.IMAGE),
      embeddingConfigured: Boolean(router.EMBEDDING),
      modelValuesReturned: false,
      existingModelsPreservedPendingEvals: true,
    },
    safety: {
      environment: "PREVIEW_STAGING_ONLY",
      newCallsEnabled: false,
      shadowOnly: true,
      rawPromptsReturned: false,
      rawResponsesReturned: false,
      piiReturned: false,
      secretsReturned: false,
      ebayWrites: 0,
      stateMutations: 0,
    },
  })
}

import type { SupabaseClient } from "@supabase/supabase-js"

// @ts-expect-error Node's native TypeScript runner requires explicit extensions.
import { parseAuthoritativeFactsInputPackage, type AuthoritativeFactsInputPackage } from "./ebay-product-facts-readiness.ts"

const MARKETPLACE = "EBAY_US"

export type AuthoritativeFactPackageBinding = {
  queueRunId: string
  decisionPackageId: string
  decisionPackageHash: string
}

/**
 * Loads only the latest readiness verdict for this queue item. A previous true
 * event can never authorize a newer package or survive a later failed fact run.
 */
export async function loadBoundAuthoritativeFactPackage(input: {
  supabase: SupabaseClient
  accountKey: string
  itemId: string
  binding: AuthoritativeFactPackageBinding
  now?: Date
}): Promise<{ factRunId: string; package: AuthoritativeFactsInputPackage } | null> {
  const now = input.now ?? new Date()
  const { data: event, error: eventError } = await input.supabase
    .from("marketplace_product_fact_readiness_events")
    .select("id,fact_run_id,ready,decision_package_id,decision_package_hash,authoritative_facts_package,authoritative_facts_package_hash,authoritative_facts_expires_at")
    .eq("marketplace_account_key", input.accountKey).eq("marketplace", MARKETPLACE)
    .eq("queue_item_id", input.itemId).eq("gate_name", "OPENAI_INPUT_READY")
    .order("observed_at", { ascending: false }).order("created_at", { ascending: false })
    .limit(1).maybeSingle()
  if (eventError) throw new Error("PRODUCT_FACT_OPENAI_GATE_READ_FAILED")
  if (!event || event.ready !== true || event.decision_package_id !== input.binding.decisionPackageId ||
    event.decision_package_hash !== input.binding.decisionPackageHash ||
    !event.authoritative_facts_expires_at ||
    new Date(event.authoritative_facts_expires_at).getTime() <= now.getTime()) return null
  const parsed = parseAuthoritativeFactsInputPackage(event.authoritative_facts_package)
  if (!parsed || parsed.factPackageHash !== event.authoritative_facts_package_hash) return null

  const { data: run, error: runError } = await input.supabase.from("marketplace_product_fact_runs")
    .select("id,queue_run_id,status,completed_at").eq("id", event.fact_run_id)
    .eq("marketplace_account_key", input.accountKey).eq("marketplace", MARKETPLACE).maybeSingle()
  if (runError) throw new Error("PRODUCT_FACT_OPENAI_RUN_READ_FAILED")
  if (!run || run.queue_run_id !== input.binding.queueRunId ||
    !["COMPLETED", "PARTIAL"].includes(run.status) || !run.completed_at) return null

  const { data: link, error: linkError } = await input.supabase
    .from("marketplace_product_fact_run_evidence_links").select("id")
    .eq("fact_run_id", event.fact_run_id).eq("queue_item_id", input.itemId)
    .eq("marketplace_account_key", input.accountKey).eq("marketplace", MARKETPLACE)
    .eq("artifact_type", "READINESS_EVENT").eq("readiness_event_id", event.id)
    .limit(1).maybeSingle()
  if (linkError) throw new Error("PRODUCT_FACT_OPENAI_EVIDENCE_LINK_READ_FAILED")
  return link ? { factRunId: event.fact_run_id, package: parsed } : null
}

export async function boundAuthoritativeFactPackageReady(input: Parameters<typeof loadBoundAuthoritativeFactPackage>[0]) {
  return Boolean(await loadBoundAuthoritativeFactPackage(input))
}

export async function assertBoundAuthoritativeFactPackage(input: Parameters<typeof loadBoundAuthoritativeFactPackage>[0]) {
  const result = await loadBoundAuthoritativeFactPackage(input)
  if (!result) throw new Error("PRODUCT_FACTS_OPENAI_INPUT_NOT_READY")
  return result
}

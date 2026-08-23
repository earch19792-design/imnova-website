import type {
  SellerOsLunaStockCheckJobV1,
  SellerOsLunaStockObservationV1,
} from "./ebay-luna-stock-observation-v1"

type SupabaseRpcResult = Readonly<{ data: unknown; error: unknown }>
type SupabaseRpcClient = Readonly<{
  rpc: (
    name: string,
    parameters?: Record<string, unknown>,
  ) => PromiseLike<SupabaseRpcResult>
}>

function row(value: unknown) {
  const candidate = Array.isArray(value) ? value[0] : value
  return candidate && typeof candidate === "object" &&
    !Array.isArray(candidate) ? candidate as Record<string, unknown> : null
}

async function rpc(
  client: SupabaseRpcClient,
  name: string,
  parameters: Record<string, unknown>,
) {
  const result = await client.rpc(name, parameters)
  if (result.error) {
    throw new Error("SELLER_OS_LUNA_STOCK_PERSISTENCE_FAILED_CLOSED")
  }
  return result.data
}

/**
 * Durable P2-I02 adapter. The caller must supply the existing server-side
 * service-role client; browser clients have no grants on the backing schema.
 * Constructing this adapter performs no write, polling, or scheduler action.
 */
export function createSellerOsLunaStockObservationRepositoryV1(
  client: SupabaseRpcClient,
) {
  return Object.freeze({
    async ensureJob(input: Readonly<{
      accountKey: string
      job: SellerOsLunaStockCheckJobV1
      dueAt?: string
    }>) {
      const data = await rpc(client,
        "ensure_seller_os_luna_stock_check_job_v1", {
          p_stock_check_job_id: input.job.stockCheckJobId,
          p_linkage_id: input.job.linkageId,
          p_account_key: input.accountKey,
          p_ebay_item_id: input.job.ebayItemId,
          p_observation_window_start: input.job.observationWindow.start,
          p_observation_window_end: input.job.observationWindow.end,
          p_due_at: input.dueAt ?? input.job.observationWindow.start,
          p_contract_version: input.job.contractVersion,
        })
      if (data !== input.job.stockCheckJobId) {
        throw new Error("SELLER_OS_LUNA_STOCK_JOB_IDENTITY_CONFLICT")
      }
      return input.job.stockCheckJobId
    },

    async claimJob(input: Readonly<{
      stockCheckJobId: string
      workerId: string
      now: string
      leaseSeconds?: number
    }>) {
      const data = await rpc(client,
        "claim_seller_os_luna_stock_check_job_v1", {
          p_stock_check_job_id: input.stockCheckJobId,
          p_worker_id: input.workerId,
          p_now: input.now,
          p_lease_seconds: input.leaseSeconds ?? 180,
        })
      const value = row(data)
      if (!value || typeof value.claimed !== "boolean" ||
          typeof value.reason !== "string") {
        throw new Error("SELLER_OS_LUNA_STOCK_CLAIM_RESULT_INVALID")
      }
      return Object.freeze({
        claimed: value.claimed,
        reason: value.reason,
        attemptNumber: typeof value.attempt_number === "number"
          ? value.attempt_number : null,
        leaseExpiresAt: typeof value.lease_expires_at === "string"
          ? value.lease_expires_at : null,
      })
    },

    async verifyLease(input: Readonly<{
      stockCheckJobId: string
      workerId: string
      now: string
    }>) {
      const data = await rpc(client,
        "verify_seller_os_luna_stock_check_lease_v1", {
          p_stock_check_job_id: input.stockCheckJobId,
          p_worker_id: input.workerId,
          p_now: input.now,
        })
      return data === true
    },

    async ensureObservation(input: Readonly<{
      accountKey: string
      observation: SellerOsLunaStockObservationV1
      leaseOwner: string
      now: string
    }>) {
      const observation = input.observation
      const data = await rpc(client,
        "ensure_seller_os_luna_stock_observation_v1", {
          p_observation_id: observation.observationId,
          p_stock_check_job_id: observation.stockCheckJobId,
          p_linkage_id: observation.linkageId,
          p_account_key: input.accountKey,
          p_ebay_item_id: observation.canonicalEbayItemId,
          p_component_identity_id: observation.componentIdentityId,
          p_luna_product_id: observation.lunaProductIdentity,
          p_luna_variant_id: observation.lunaVariantIdentity,
          p_luna_sku: observation.lunaSku,
          p_supplier_quantity_required:
            observation.supplierQuantityRequired,
          p_observation_state: observation.observationState,
          p_source_status: observation.sourceStatus,
          p_observed_availability: observation.observedAvailability,
          p_observed_supplier_quantity:
            observation.observedSupplierQuantity,
          p_evidence_class: observation.evidenceClass,
          p_evidence_digest: observation.evidenceDigest,
          p_acquisition_method: observation.acquisitionMethod,
          p_attempt_number: observation.attemptCorrelation.attemptNumber,
          p_observed_at: observation.observedAt,
          p_maximum_age_seconds:
            observation.freshnessInput.maximumAgeSeconds,
          p_limitations: [...observation.limitations],
          p_lease_owner: input.leaseOwner,
          p_now: input.now,
        })
      if (data !== observation.observationId) {
        throw new Error("SELLER_OS_LUNA_STOCK_OBSERVATION_IDENTITY_CONFLICT")
      }
      return observation.observationId
    },

    async completeJob(input: Readonly<{
      stockCheckJobId: string
      workerId: string
      packageDigest: string
      now: string
    }>) {
      const data = await rpc(client,
        "complete_seller_os_luna_stock_check_job_v1", {
          p_stock_check_job_id: input.stockCheckJobId,
          p_worker_id: input.workerId,
          p_success_receipt_digest: input.packageDigest,
          p_now: input.now,
        })
      if (data !== true) {
        throw new Error("SELLER_OS_LUNA_STOCK_COMPLETION_NOT_CONFIRMED")
      }
      return true
    },
  })
}

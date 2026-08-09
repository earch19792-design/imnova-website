import {
  EBAY_SELLER_OAUTH_REAUTH_FLOW_VERSION,
  EbaySellerOAuthReauthError,
} from "./ebay-seller-oauth-reauth-domain"

export type EbaySellerOAuthReauthStateLedger = {
  createPending(input: {
    stateHash: string
    expiresAt: string
    flowVersion: typeof EBAY_SELLER_OAUTH_REAUTH_FLOW_VERSION
  }): Promise<boolean>
  claimPending(input: {
    stateHash: string
    flowVersion: typeof EBAY_SELLER_OAUTH_REAUTH_FLOW_VERSION
  }): Promise<boolean>
}

type SupabaseRpcResult = {
  data: unknown
  error: unknown
}

type SupabaseRpcClient = {
  rpc(name: string, parameters: Record<string, unknown>): PromiseLike<SupabaseRpcResult>
}

export function createSupabaseEbaySellerOAuthReauthStateLedger(
  client: SupabaseRpcClient,
): EbaySellerOAuthReauthStateLedger {
  return {
    async createPending(input) {
      const { data, error } = await client.rpc(
        "create_ebay_seller_oauth_reauth_state_v1",
        {
          p_state_hash: input.stateHash,
          p_expires_at: input.expiresAt,
          p_flow_version: input.flowVersion,
        },
      )
      if (error) {
        throw new EbaySellerOAuthReauthError(
          "EBAY_SELLER_OAUTH_REAUTH_LEDGER_CREATE_FAILED",
        )
      }
      return data === true
    },

    async claimPending(input) {
      const { data, error } = await client.rpc(
        "claim_ebay_seller_oauth_reauth_state_v1",
        {
          p_state_hash: input.stateHash,
          p_flow_version: input.flowVersion,
        },
      )
      if (error) {
        throw new EbaySellerOAuthReauthError(
          "EBAY_SELLER_OAUTH_REAUTH_LEDGER_CLAIM_FAILED",
        )
      }
      return data === true
    },
  }
}

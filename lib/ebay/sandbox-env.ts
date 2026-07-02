export const EBAY_SANDBOX_REQUIRED_ENV_KEYS = [
  "EBAY_SANDBOX_CLIENT_ID",
  "EBAY_SANDBOX_CLIENT_SECRET",
  "EBAY_SANDBOX_REDIRECT_URI",
  "EBAY_SANDBOX_RU_NAME",
  "EBAY_SANDBOX_OAUTH_STATE_SECRET",
] as const

export const EBAY_SANDBOX_ENV_NOT_CONFIGURED =
  "EBAY_SANDBOX_ENV_NOT_CONFIGURED"

type EbaySandboxEnvKey =
  (typeof EBAY_SANDBOX_REQUIRED_ENV_KEYS)[number]

type EnvRecord =
  Record<string, string | undefined>

function hasConfiguredValue(
  value: string | undefined
) {
  return Boolean(
    value &&
      value.trim().length > 0
  )
}

export function getEbaySandboxEnvConfigurationStatus(
  env: EnvRecord = process.env
) {
  const configuredKeys =
    EBAY_SANDBOX_REQUIRED_ENV_KEYS.map((key) => ({
      key,
      configured:
        hasConfiguredValue(
          env[key]
        ),
      valueExposed:
        false as const,
    }))

  const missingKeys =
    configuredKeys
      .filter((entry) => !entry.configured)
      .map((entry) => entry.key as EbaySandboxEnvKey)

  return {
    allRequiredConfigured:
      missingKeys.length === 0,
    requiredKeys: [
      ...EBAY_SANDBOX_REQUIRED_ENV_KEYS,
    ],
    missingKeys,
    configuredKeys,
  }
}

export function getBlockedEbaySandboxEnvConfigurationResponse(
  env?: EnvRecord
) {
  const status =
    getEbaySandboxEnvConfigurationStatus(env)

  return {
    ok: false,
    blocked: true,
    code:
      EBAY_SANDBOX_ENV_NOT_CONFIGURED,
    allRequiredConfigured:
      status.allRequiredConfigured,
    requiredKeys:
      status.requiredKeys,
    missingKeys:
      status.missingKeys,
    configuredKeys:
      status.configuredKeys,
    valueExposurePolicy:
      "Env status exposes presence only. Values are never returned.",
    oauthStartAllowed:
      false,
    callbackProcessingAllowed:
      false,
    tokenExchangeAllowed:
      false,
    tokenStorageAllowed:
      false,
    ebayApiUsed:
      false,
  }
}

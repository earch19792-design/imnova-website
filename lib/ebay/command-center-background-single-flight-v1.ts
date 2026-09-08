export const COMMAND_CENTER_BACKGROUND_FANOUT_CONTRACT_V1 =
  "COMMAND_CENTER_BACKGROUND_FANOUT_OPTIMIZATION_V1" as const

const inFlightByScope = new Map<string, Promise<unknown>>()

export async function readCommandCenterBackgroundSingleFlightV1<T>(input:
Readonly<{
  scopeKey: string
  load: () => Promise<T>
}>) {
  const existing = inFlightByScope.get(input.scopeKey)
  if (existing) {
    return Object.freeze({
      value: await existing as T,
      source: "SINGLE_FLIGHT_JOIN" as const,
    })
  }

  const inFlight = input.load()
  inFlightByScope.set(input.scopeKey, inFlight)
  try {
    return Object.freeze({
      value: await inFlight,
      source: "DATABASE_READ" as const,
    })
  } finally {
    if (inFlightByScope.get(input.scopeKey) === inFlight) {
      inFlightByScope.delete(input.scopeKey)
    }
  }
}

export function resetCommandCenterBackgroundSingleFlightV1() {
  inFlightByScope.clear()
}

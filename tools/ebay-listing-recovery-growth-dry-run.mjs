import {
  runFiveListingRecoveryDryRun,
} from "../lib/ebay/ebay-listing-recovery-growth-domain.ts"
import {
  fiveListingRecoveryFixtures,
} from "../lib/ebay/ebay-listing-recovery-growth-fixtures.ts"

const report = await runFiveListingRecoveryDryRun(
  fiveListingRecoveryFixtures(),
)

const nonzeroSafetyCounters = Object.entries(report.safety)
  .filter(([, value]) => value !== 0)

if (
  report.listingCount !== 5 ||
  report.diagnosed + report.quarantined !== 5
) {
  throw new Error("RECOVERY_DRY_RUN_DID_NOT_PROCESS_EXACTLY_FIVE_LISTINGS")
}

if (nonzeroSafetyCounters.length > 0) {
  throw new Error(
    `RECOVERY_DRY_RUN_SAFETY_COUNTER_NONZERO:${nonzeroSafetyCounters
      .map(([name, value]) => `${name}=${value}`)
      .join(",")}`,
  )
}

console.log(JSON.stringify({
  mode: "LOCAL_FIXTURE_DRY_RUN",
  engineVersion: report.engineVersion,
  listingCount: report.listingCount,
  diagnosed: report.diagnosed,
  quarantined: report.quarantined,
  outcomes: report.items.map((item) => ({
    position: item.position,
    listingId: item.listingId,
    status: item.status,
    state: item.decision?.state ?? null,
    diagnosis: item.decision?.diagnosis ?? null,
    action: item.decision?.action ?? null,
    errorCode: item.errorCode,
  })),
  safety: report.safety,
}, null, 2))

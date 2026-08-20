import { lstat, readFile, readdir } from "node:fs/promises"
import { resolve } from "node:path"

import {
  SELLER_OS_CANONICAL_REPOSITORY_V1,
} from "./ebay-seller-os-dev-status-v1"
import {
  SELLER_OS_WORKSPACE_FINGERPRINT_VERSION,
  collectSellerOsWorkspaceFingerprintV1,
  type SellerOsWorkspaceFingerprintV1,
} from "./ebay-seller-os-workspace-fingerprint-v1.mjs"
import {
  parseSellerOsTargetedMigrationAttestationV1,
  readSellerOsTargetedMigrationAttestationArtifactV1,
  unavailableSellerOsTargetedMigrationAttestationV1,
  type SellerOsTargetedMigrationAttestationV1,
} from "./ebay-seller-os-targeted-migration-attestation-v1"

export const SELLER_OS_DATA_STATUS_CONTRACT_VERSION = "SELLER_OS_DATA_STATUS_V1"

export const SELLER_OS_DATA_STATUS_TOOL_V1 = Object.freeze({
  name: "seller_os_get_data_status",
  title: "Get Seller OS data and migration status",
  description: "Inspect bounded read-only migration metadata and data-layer availability for the fixed canonical Seller OS repository. This tool accepts no SQL, table, schema, repository, path, or database input and never applies or rolls back migrations.",
  annotations: Object.freeze({
    readOnlyHint: true as const,
    destructiveHint: false as const,
    openWorldHint: false as const,
    idempotentHint: true as const,
  }),
  sideEffects: false as const,
})

export const SELLER_OS_DATA_STATUS_SCOPE_V1 = Object.freeze({
  repositoryId: "SELLER_OS_CANONICAL_REPOSITORY",
  migrationDirectory: "supabase/migrations",
  provider: "SUPABASE",
  appliedMigrationLedger: "supabase_migrations.schema_migrations",
  appliedMigrationReadMethod: "SUPABASE_MANAGEMENT_API_FIXED_READONLY_QUERY",
})

const MIGRATION_DIRECTORY = resolve(
  SELLER_OS_CANONICAL_REPOSITORY_V1.directory,
  SELLER_OS_DATA_STATUS_SCOPE_V1.migrationDirectory,
)
const MAX_MIGRATION_ENTRIES = 100
const MAX_LEDGER_READ_ENTRIES = 1_000
const MAX_LEDGER_RESPONSE_BYTES = 256 * 1024
const MAX_LIMITATIONS = 32
const SUPABASE_ACCESS_TOKEN_FILE = "/home/earch/.supabase/access-token"
const SUPABASE_PROJECT_REF_FILE =
  "/home/earch/Projects/imnova-corporate-website/supabase/.temp/project-ref"
const SUPABASE_MANAGEMENT_API_BASE_URL = "https://api.supabase.com"
const APPLIED_MIGRATION_QUERY =
  "select version from supabase_migrations.schema_migrations order by version"
const MIGRATION_FILE_PATTERN = /^(\d{12,20})_([a-z0-9][a-z0-9_-]{0,180})\.sql$/
const MIGRATION_ID_PATTERN = /^\d{12,20}$/

type SourceStatusV1 = "AVAILABLE" | "UNAVAILABLE" | "UNPROVEN"
type ReconciliationStatusV1 = "NONE" | "PRESENT" | "UNAVAILABLE" | "UNPROVEN"
type SchemaDriftStatusV1 = "MATCHED" | "DRIFT_DETECTED" | "UNAVAILABLE" | "UNPROVEN"

type AppliedLedgerReadV1 = Readonly<{
  ids: readonly unknown[]
  count: unknown
  complete: boolean
}>

type SchemaDriftReadV1 = Readonly<{
  status: SchemaDriftStatusV1
  method: string | null
  checkedAt: string | null
}>

export type SellerOsDataStatusAdapterV1 = Readonly<{
  readCurrentSubject: () => Promise<SellerOsWorkspaceFingerprintV1>
  readLocalMigrationFiles: () => Promise<readonly string[]>
  readAppliedMigrationLedger: () => Promise<AppliedLedgerReadV1>
  readSchemaDrift: () => Promise<SchemaDriftReadV1>
  readTargetedAttestationArtifact?: () => Promise<string>
}>

export type SellerOsDataStatusV1 = Readonly<{
  contractVersion: typeof SELLER_OS_DATA_STATUS_CONTRACT_VERSION
  observedAt: string
  currentSubject: Readonly<{
    headSha: string | null
    workingTreeStatus: "CLEAN" | "DIRTY" | "UNAVAILABLE"
    workspaceFingerprint: string | null
    fingerprintVersion: typeof SELLER_OS_WORKSPACE_FINGERPRINT_VERSION
  }>
  dataLayer: Readonly<{
    status: "AVAILABLE" | "DEGRADED" | "UNAVAILABLE" | "UNPROVEN"
    source: "SUPABASE_AUTHORITATIVE_MIGRATION_LEDGER" | null
    connectivity: "AVAILABLE" | "UNAVAILABLE" | "UNPROVEN"
  }>
  migrations: Readonly<{
    local: Readonly<{
      status: SourceStatusV1
      count: number | null
      entries: readonly Readonly<{ id: string; name: string | null }>[]
      latestId: string | null
      entriesTruncated: boolean
    }>
    applied: Readonly<{
      status: SourceStatusV1
      source: "SUPABASE_MIGRATIONS_LEDGER" | null
      count: number | null
      entries: readonly Readonly<{ id: string }>[]
      entriesTruncated: boolean
    }>
    pending: Readonly<{
      status: ReconciliationStatusV1
      count: number | null
      ids: readonly string[]
      entriesTruncated: boolean
    }>
    remoteOnly: Readonly<{
      status: ReconciliationStatusV1
      count: number | null
      ids: readonly string[]
      entriesTruncated: boolean
    }>
  }>
  schemaDrift: Readonly<{
    status: SchemaDriftStatusV1
    method: string | null
    checkedAt: string | null
  }>
  targetedAttestation: SellerOsTargetedMigrationAttestationV1
  overallStatus: "HEALTHY" | "DEGRADED" | "BLOCKED" | "UNAVAILABLE" | "UNPROVEN"
  evidenceCompleteness: "COMPLETE" | "PARTIAL" | "UNAVAILABLE"
  limitations: readonly string[]
  safety: Readonly<{
    readOnly: true
    arbitrarySqlAllowed: false
    callerControlledSqlAllowed: false
    callerControlledTableAllowed: false
    schemaMutationAllowed: false
    migrationApplyAllowed: false
    migrationRollbackAllowed: false
    databaseWritesAllowed: false
    credentialsIncluded: false
    environmentValuesIncluded: false
    rowDataIncluded: false
    marketplaceWrites: 0
    inventoryWrites: 0
    productCaseMutations: 0
    lunaLinkMutations: 0
    whatsappSends: 0
  }>
}>

const SAFETY = Object.freeze({
  readOnly: true as const,
  arbitrarySqlAllowed: false as const,
  callerControlledSqlAllowed: false as const,
  callerControlledTableAllowed: false as const,
  schemaMutationAllowed: false as const,
  migrationApplyAllowed: false as const,
  migrationRollbackAllowed: false as const,
  databaseWritesAllowed: false as const,
  credentialsIncluded: false as const,
  environmentValuesIncluded: false as const,
  rowDataIncluded: false as const,
  marketplaceWrites: 0 as const,
  inventoryWrites: 0 as const,
  productCaseMutations: 0 as const,
  lunaLinkMutations: 0 as const,
  whatsappSends: 0 as const,
})

type DataReadFailureCodeV1 =
  | "CONFIGURATION_NOT_AVAILABLE"
  | "AUTHENTICATION_NOT_AVAILABLE"
  | "AUTHORITATIVE_LEDGER_PERMISSION_DENIED"
  | "NETWORK_OR_ENDPOINT_UNAVAILABLE"
  | "MIGRATION_LEDGER_NOT_FOUND"
  | "AUTHORITATIVE_LEDGER_READ_FAILED"

export class SellerOsDataStatusReadErrorV1 extends Error {
  readonly code: DataReadFailureCodeV1

  constructor(code: DataReadFailureCodeV1) {
    super("SELLER_OS_AUTHORITATIVE_DATA_READ_FAILED")
    this.name = "SellerOsDataStatusReadErrorV1"
    this.code = code
  }
}

async function readFixedCredentialFile(path: string, kind: "TOKEN" | "PROJECT_REF") {
  let stat
  try {
    stat = await lstat(path)
  } catch {
    throw new SellerOsDataStatusReadErrorV1("CONFIGURATION_NOT_AVAILABLE")
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > 4_096 ||
      (kind === "TOKEN" && (stat.mode & 0o077) !== 0)) {
    throw new SellerOsDataStatusReadErrorV1("CONFIGURATION_NOT_AVAILABLE")
  }
  const value = (await readFile(path, "utf8")).trim()
  const safe = kind === "TOKEN"
    ? value.length >= 20 && value.length <= 512 && !/\s/.test(value)
    : /^[a-z0-9]{20}$/.test(value)
  if (!safe) throw new SellerOsDataStatusReadErrorV1("CONFIGURATION_NOT_AVAILABLE")
  return value
}

async function readBoundedResponse(response: Response) {
  const declaredLength = Number(response.headers.get("content-length"))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_LEDGER_RESPONSE_BYTES) {
    throw new SellerOsDataStatusReadErrorV1("AUTHORITATIVE_LEDGER_READ_FAILED")
  }
  if (!response.body) return ""
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const next = await reader.read()
    if (next.done) break
    total += next.value.byteLength
    if (total > MAX_LEDGER_RESPONSE_BYTES) {
      await reader.cancel()
      throw new SellerOsDataStatusReadErrorV1("AUTHORITATIVE_LEDGER_READ_FAILED")
    }
    chunks.push(next.value)
  }
  const output = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(output)
}

async function readAuthoritativeSupabaseMigrationLedgerV1(): Promise<AppliedLedgerReadV1> {
  const [token, projectRef] = await Promise.all([
    readFixedCredentialFile(SUPABASE_ACCESS_TOKEN_FILE, "TOKEN"),
    readFixedCredentialFile(SUPABASE_PROJECT_REF_FILE, "PROJECT_REF"),
  ])
  let response: Response
  try {
    response = await fetch(
      `${SUPABASE_MANAGEMENT_API_BASE_URL}/v1/projects/${projectRef}/database/query`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: APPLIED_MIGRATION_QUERY }),
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      },
    )
  } catch {
    throw new SellerOsDataStatusReadErrorV1("NETWORK_OR_ENDPOINT_UNAVAILABLE")
  }
  if (response.status === 401) {
    throw new SellerOsDataStatusReadErrorV1("AUTHENTICATION_NOT_AVAILABLE")
  }
  if (response.status === 403) {
    throw new SellerOsDataStatusReadErrorV1("AUTHORITATIVE_LEDGER_PERMISSION_DENIED")
  }
  if (response.status === 404) {
    throw new SellerOsDataStatusReadErrorV1("MIGRATION_LEDGER_NOT_FOUND")
  }
  if (!response.ok) {
    throw new SellerOsDataStatusReadErrorV1(response.status >= 500
      ? "NETWORK_OR_ENDPOINT_UNAVAILABLE" : "AUTHORITATIVE_LEDGER_READ_FAILED")
  }
  let payload: unknown
  try {
    payload = JSON.parse(await readBoundedResponse(response))
  } catch (error) {
    if (error instanceof SellerOsDataStatusReadErrorV1) throw error
    throw new SellerOsDataStatusReadErrorV1("AUTHORITATIVE_LEDGER_READ_FAILED")
  }
  if (!Array.isArray(payload) || payload.length > MAX_LEDGER_READ_ENTRIES) {
    throw new SellerOsDataStatusReadErrorV1("AUTHORITATIVE_LEDGER_READ_FAILED")
  }
  return Object.freeze({
    ids: Object.freeze(payload.map((entry) => entry && typeof entry === "object" &&
      "version" in entry ? (entry as { version?: unknown }).version : null)),
    count: payload.length,
    complete: true,
  })
}

const DEFAULT_ADAPTER: SellerOsDataStatusAdapterV1 = Object.freeze({
  readCurrentSubject: collectSellerOsWorkspaceFingerprintV1,
  readLocalMigrationFiles: async () => {
    const entries = await readdir(MIGRATION_DIRECTORY, { withFileTypes: true })
    return entries.filter((entry) => entry.isFile() && !entry.isSymbolicLink())
      .map((entry) => entry.name)
  },
  readAppliedMigrationLedger: readAuthoritativeSupabaseMigrationLedgerV1,
  readSchemaDrift: async () => Object.freeze({
    status: "UNPROVEN" as const,
    method: null,
    checkedAt: null,
  }),
  readTargetedAttestationArtifact: readSellerOsTargetedMigrationAttestationArtifactV1,
})

function addLimitation(limitations: string[], value: string) {
  if (!limitations.includes(value) && limitations.length < MAX_LIMITATIONS) {
    limitations.push(value)
  }
}

function addAppliedReadFailureLimitation(limitations: string[], reason: unknown) {
  const code = reason instanceof SellerOsDataStatusReadErrorV1
    ? reason.code : "AUTHORITATIVE_LEDGER_READ_FAILED"
  addLimitation(limitations, `APPLIED_MIGRATION_${code}`)
}

function safeTimestamp(value: unknown) {
  if (typeof value !== "string" || value.length > 100) return null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString()
}

function safeMethod(value: unknown) {
  return typeof value === "string" && /^[A-Z0-9_:-]{1,100}$/.test(value)
    ? value : null
}

function sameSubject(
  first: SellerOsWorkspaceFingerprintV1,
  second: SellerOsWorkspaceFingerprintV1,
) {
  return first.status === "AVAILABLE" && second.status === "AVAILABLE" &&
    first.headSha === second.headSha && first.fingerprint === second.fingerprint &&
    first.workingTreeStatus === second.workingTreeStatus
}

function parseLocalMigrations(files: readonly string[]) {
  const entries: Array<{ id: string; name: string }> = []
  const seen = new Set<string>()
  let malformed = false
  for (const filename of files) {
    const match = MIGRATION_FILE_PATTERN.exec(filename)
    if (!match || seen.has(match[1])) {
      malformed = true
      continue
    }
    seen.add(match[1])
    entries.push({ id: match[1], name: match[2] })
  }
  entries.sort((left, right) => left.id.localeCompare(right.id) ||
    left.name.localeCompare(right.name))
  return { entries, malformed }
}

function parseAppliedLedger(read: AppliedLedgerReadV1) {
  const count = typeof read.count === "number" && Number.isSafeInteger(read.count) &&
    read.count >= 0 ? read.count : null
  const ids: string[] = []
  const seen = new Set<string>()
  let malformed = false
  for (const value of read.ids) {
    const id = typeof value === "string" && MIGRATION_ID_PATTERN.test(value.trim())
      ? value.trim() : null
    if (!id || seen.has(id)) {
      malformed = true
      continue
    }
    seen.add(id)
    ids.push(id)
  }
  ids.sort()
  const complete = read.complete === true && count !== null && count === ids.length
  return { ids, count, complete, malformed }
}

function boundedIds(ids: readonly string[]) {
  return Object.freeze(ids.slice(0, MAX_MIGRATION_ENTRIES))
}

function emptyReconciliation(status: "UNAVAILABLE" | "UNPROVEN") {
  return Object.freeze({ status, count: null, ids: Object.freeze([]),
    entriesTruncated: false })
}

export function createUnavailableSellerOsDataStatusV1(
  observedAt = new Date().toISOString(),
): SellerOsDataStatusV1 {
  return Object.freeze({
    contractVersion: SELLER_OS_DATA_STATUS_CONTRACT_VERSION,
    observedAt,
    currentSubject: Object.freeze({ headSha: null,
      workingTreeStatus: "UNAVAILABLE" as const, workspaceFingerprint: null,
      fingerprintVersion: SELLER_OS_WORKSPACE_FINGERPRINT_VERSION }),
    dataLayer: Object.freeze({ status: "UNAVAILABLE" as const, source: null,
      connectivity: "UNAVAILABLE" as const }),
    migrations: Object.freeze({
      local: Object.freeze({ status: "UNAVAILABLE" as const, count: null,
        entries: Object.freeze([]), latestId: null, entriesTruncated: false }),
      applied: Object.freeze({ status: "UNAVAILABLE" as const, source: null,
        count: null, entries: Object.freeze([]), entriesTruncated: false }),
      pending: emptyReconciliation("UNAVAILABLE"),
      remoteOnly: emptyReconciliation("UNAVAILABLE"),
    }),
    schemaDrift: Object.freeze({ status: "UNAVAILABLE" as const,
      method: null, checkedAt: null }),
    targetedAttestation: unavailableSellerOsTargetedMigrationAttestationV1(),
    overallStatus: "UNAVAILABLE",
    evidenceCompleteness: "UNAVAILABLE",
    limitations: Object.freeze(["DATA_STATUS_COLLECTOR_UNAVAILABLE"]),
    safety: SAFETY,
  })
}

export async function collectSellerOsDataStatusV1(options: {
  adapter?: SellerOsDataStatusAdapterV1
  now?: () => Date
} = {}): Promise<SellerOsDataStatusV1> {
  const adapter = options.adapter ?? DEFAULT_ADAPTER
  const observedAt = (options.now ?? (() => new Date()))().toISOString()
  const limitations: string[] = []

  let startSubject: SellerOsWorkspaceFingerprintV1 | null = null
  let endSubject: SellerOsWorkspaceFingerprintV1 | null = null
  let localFiles: readonly string[] | null = null
  let connectivity: "AVAILABLE" | "UNAVAILABLE" | "UNPROVEN" = "UNAVAILABLE"
  let appliedRead: AppliedLedgerReadV1 | null = null
  let driftRead: SchemaDriftReadV1 | null = null
  let targetedAttestationArtifact: string | null = null

  try { startSubject = await adapter.readCurrentSubject() } catch {
    addLimitation(limitations, "WORKSPACE_SUBJECT_UNAVAILABLE")
  }
  const [localResult, appliedResult, driftResult, targetedAttestationResult] =
    await Promise.allSettled([
      adapter.readLocalMigrationFiles(), adapter.readAppliedMigrationLedger(),
      adapter.readSchemaDrift(),
      (adapter.readTargetedAttestationArtifact ?? readSellerOsTargetedMigrationAttestationArtifactV1)(),
    ])
  if (localResult.status === "fulfilled" && Array.isArray(localResult.value)) {
    localFiles = localResult.value
  } else addLimitation(limitations, "LOCAL_MIGRATION_SOURCE_UNAVAILABLE")
  if (appliedResult.status === "fulfilled") {
    appliedRead = appliedResult.value
  } else {
    connectivity = "UNAVAILABLE"
    addLimitation(limitations, "DATA_LAYER_CONNECTIVITY_UNAVAILABLE")
    addAppliedReadFailureLimitation(limitations, appliedResult.reason)
  }
  if (driftResult.status === "fulfilled") driftRead = driftResult.value
  else addLimitation(limitations, "SCHEMA_DRIFT_EVIDENCE_UNAVAILABLE")
  if (targetedAttestationResult.status === "fulfilled") {
    targetedAttestationArtifact = targetedAttestationResult.value
  }
  try { endSubject = await adapter.readCurrentSubject() } catch {
    addLimitation(limitations, "WORKSPACE_SUBJECT_UNAVAILABLE")
  }

  const subjectStable = startSubject !== null && endSubject !== null &&
    sameSubject(startSubject, endSubject)
  if (!subjectStable) addLimitation(limitations,
    "WORKSPACE_CHANGED_OR_UNAVAILABLE_DURING_DATA_STATUS_COLLECTION")
  const subject = subjectStable ? endSubject : null
  let targetedAttestation = unavailableSellerOsTargetedMigrationAttestationV1()
  if (targetedAttestationArtifact !== null) {
    try {
      targetedAttestation = parseSellerOsTargetedMigrationAttestationV1(
        JSON.parse(targetedAttestationArtifact), subject,
      )
    } catch {
      targetedAttestation = unavailableSellerOsTargetedMigrationAttestationV1()
    }
  }
  for (const limitation of targetedAttestation.limitations) {
    addLimitation(limitations, limitation)
  }
  if (targetedAttestation.status === "STALE") {
    addLimitation(limitations, "TARGETED_ATTESTATION_SUBJECT_STALE")
  }

  let localStatus: SourceStatusV1 = "UNAVAILABLE"
  let localCount: number | null = null
  let localIds: string[] = []
  let localEntries: Array<{ id: string; name: string | null }> = []
  if (localFiles) {
    const parsed = parseLocalMigrations(localFiles)
    if (parsed.malformed) {
      addLimitation(limitations, "LOCAL_MIGRATION_EVIDENCE_MALFORMED_OR_DUPLICATE")
    } else {
      localStatus = "AVAILABLE"
      localCount = parsed.entries.length
      localEntries = parsed.entries
      localIds = parsed.entries.map((entry) => entry.id)
    }
  }

  let appliedStatus: SourceStatusV1 = "UNAVAILABLE"
  let appliedCount: number | null = null
  let appliedIds: string[] = []
  let appliedComplete = false
  if (appliedRead) {
    const parsed = parseAppliedLedger(appliedRead)
    appliedCount = parsed.count
    appliedIds = parsed.ids
    appliedComplete = parsed.complete && !parsed.malformed
    if (appliedComplete) {
      appliedStatus = "AVAILABLE"
      connectivity = "AVAILABLE"
    } else {
      connectivity = "UNAVAILABLE"
      addLimitation(limitations, "DATA_LAYER_CONNECTIVITY_UNAVAILABLE")
      addLimitation(limitations, parsed.malformed
        ? "APPLIED_MIGRATION_LEDGER_MALFORMED_OR_DUPLICATE"
        : "APPLIED_MIGRATION_LEDGER_INCOMPLETE")
    }
  }

  let pending: SellerOsDataStatusV1["migrations"]["pending"] =
    emptyReconciliation("UNAVAILABLE")
  let remoteOnly: SellerOsDataStatusV1["migrations"]["remoteOnly"] =
    emptyReconciliation("UNAVAILABLE")
  if (localStatus === "AVAILABLE" && appliedStatus === "AVAILABLE" && appliedComplete) {
    const localSet = new Set(localIds)
    const appliedSet = new Set(appliedIds)
    const pendingIds = localIds.filter((id) => !appliedSet.has(id))
    const remoteOnlyIds = appliedIds.filter((id) => !localSet.has(id))
    pending = Object.freeze({ status: pendingIds.length ? "PRESENT" as const : "NONE" as const,
      count: pendingIds.length, ids: boundedIds(pendingIds),
      entriesTruncated: pendingIds.length > MAX_MIGRATION_ENTRIES })
    remoteOnly = Object.freeze({
      status: remoteOnlyIds.length ? "PRESENT" as const : "NONE" as const,
      count: remoteOnlyIds.length, ids: boundedIds(remoteOnlyIds),
      entriesTruncated: remoteOnlyIds.length > MAX_MIGRATION_ENTRIES })
  }

  let schemaDrift: SellerOsDataStatusV1["schemaDrift"] = Object.freeze({
    status: "UNAVAILABLE", method: null, checkedAt: null,
  })
  if (driftRead && ["MATCHED", "DRIFT_DETECTED", "UNAVAILABLE", "UNPROVEN"]
    .includes(driftRead.status)) {
    const method = safeMethod(driftRead.method)
    const checkedAt = safeTimestamp(driftRead.checkedAt)
    if ((driftRead.status === "MATCHED" || driftRead.status === "DRIFT_DETECTED") &&
        (!method || !checkedAt)) {
      addLimitation(limitations, "SCHEMA_DRIFT_EVIDENCE_MALFORMED")
    } else {
      schemaDrift = Object.freeze({ status: driftRead.status, method, checkedAt })
      if (driftRead.status === "UNPROVEN") addLimitation(limitations,
        "SCHEMA_DRIFT_NOT_PROVEN_BY_AUTHORITATIVE_MECHANISM")
      if (driftRead.status === "UNAVAILABLE") addLimitation(limitations,
        "SCHEMA_DRIFT_EVIDENCE_UNAVAILABLE")
    }
  } else addLimitation(limitations, "SCHEMA_DRIFT_EVIDENCE_MALFORMED")

  const dataLayerStatus = connectivity === "AVAILABLE"
    ? appliedStatus === "AVAILABLE" ? "AVAILABLE" as const : "DEGRADED" as const
    : "UNAVAILABLE" as const
  const blocked = pending.status === "PRESENT" || remoteOnly.status === "PRESENT" ||
    schemaDrift.status === "DRIFT_DETECTED"
  const overallStatus = blocked ? "BLOCKED" as const
    : connectivity === "UNAVAILABLE" ? "UNAVAILABLE" as const
    : !subjectStable || localStatus !== "AVAILABLE" || appliedStatus !== "AVAILABLE" ||
      schemaDrift.status === "UNAVAILABLE" ? "DEGRADED" as const
    : "HEALTHY" as const
  const evidenceCompleteness = connectivity === "UNAVAILABLE" &&
    localStatus === "UNAVAILABLE" && appliedStatus === "UNAVAILABLE" && !subjectStable
    ? "UNAVAILABLE" as const
    : limitations.length === 0 ? "COMPLETE" as const : "PARTIAL" as const

  return Object.freeze({
    contractVersion: SELLER_OS_DATA_STATUS_CONTRACT_VERSION,
    observedAt,
    currentSubject: Object.freeze({
      headSha: subject?.headSha ?? null,
      workingTreeStatus: subject?.workingTreeStatus ?? "UNAVAILABLE",
      workspaceFingerprint: subject?.fingerprint ?? null,
      fingerprintVersion: SELLER_OS_WORKSPACE_FINGERPRINT_VERSION,
    }),
    dataLayer: Object.freeze({ status: dataLayerStatus,
      source: connectivity === "AVAILABLE"
        ? "SUPABASE_AUTHORITATIVE_MIGRATION_LEDGER" : null,
      connectivity }),
    migrations: Object.freeze({
      local: Object.freeze({ status: localStatus, count: localCount,
        entries: Object.freeze(localEntries.slice(0, MAX_MIGRATION_ENTRIES)),
        latestId: localStatus === "AVAILABLE" ? localIds.at(-1) ?? null : null,
        entriesTruncated: localCount !== null && localCount > MAX_MIGRATION_ENTRIES }),
      applied: Object.freeze({ status: appliedStatus,
        source: appliedStatus === "AVAILABLE" ? "SUPABASE_MIGRATIONS_LEDGER" : null,
        count: appliedCount,
        entries: Object.freeze(appliedIds.slice(0, MAX_MIGRATION_ENTRIES)
          .map((id) => Object.freeze({ id }))),
        entriesTruncated: appliedCount !== null && appliedCount > MAX_MIGRATION_ENTRIES }),
      pending,
      remoteOnly,
    }),
    schemaDrift,
    targetedAttestation,
    overallStatus,
    evidenceCompleteness,
    limitations: Object.freeze(limitations),
    safety: SAFETY,
  })
}

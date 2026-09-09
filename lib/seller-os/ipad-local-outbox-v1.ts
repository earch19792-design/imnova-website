import { IPAD_OUTBOX_VERSION, parseOutboxChangesV1, parseOutboxIntentV1, stableOutboxJsonV1,
  type OutboxIntent, type DurableOutboxReceipt, type OutboxKind } from "./ipad-outbox-contract-v1"

export const IPAD_OUTBOX_DATABASE = "seller-os-ipad-outbox-v1"
export type LocalOutboxRecord = { localKey: string; actorId: string; intent: OutboxIntent; receipt: DurableOutboxReceipt | null; lastError: string | null }
export type DraftInput = { kind: OutboxKind; itemId: string; listingTitle: string; generationId: string;
  baseVersionHash: string | null; baseObservedAt: string | null; requestedChanges: unknown }
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(Error("IPAD_LOCAL_STORAGE_UNAVAILABLE"))
    const request = indexedDB.open(IPAD_OUTBOX_DATABASE, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      db.createObjectStore("intents", { keyPath: "localKey" }).createIndex("actorId", "actorId")
      db.createObjectStore("workspace", { keyPath: "actorId" })
      db.createObjectStore("images", { keyPath: "localKey" })
    }
    request.onerror = () => reject(Error("IPAD_LOCAL_STORAGE_OPEN_FAILED"))
    request.onblocked = () => reject(Error("IPAD_LOCAL_STORAGE_UPGRADE_BLOCKED"))
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result) }
  })
}
async function transaction<T>(storeName: string, mode: IDBTransactionMode, action: (store: IDBObjectStore, result: (v: T) => void) => void): Promise<T> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    let value: T
    let tx: IDBTransaction
    try { tx = db.transaction(storeName, mode, { durability: "strict" }) }
    catch { tx = db.transaction(storeName, mode) }
    tx.oncomplete = () => { db.close(); resolve(value) }
    tx.onabort = tx.onerror = () => { db.close(); reject(Error("IPAD_LOCAL_TRANSACTION_FAILED")) }
    try { action(tx.objectStore(storeName), v => { value = v }) }
    catch (error) { tx.abort(); reject(error) }
  })
}
export async function saveLocalOutboxDraftV1(actorId: string, input: DraftInput): Promise<LocalOutboxRecord> {
  if (!/^[a-f0-9-]{36}$/i.test(actorId)) throw Error("OUTBOX_ACTOR_REQUIRED")
  const changes = parseOutboxChangesV1(input.requestedChanges)
  const core = { ...input, requestedChanges: changes }
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stableOutboxJsonV1({ actorId, ...core })))
  const hash = Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, "0")).join("")
  const intent = parseOutboxIntentV1({ version: IPAD_OUTBOX_VERSION, ...core,
    idempotencyKey: `ipados:v1:${hash}`, createdAt: new Date().toISOString() })
  const localKey = `${actorId}:${intent.idempotencyKey}`
  return transaction("intents", "readwrite", (store, result) => {
    const request = store.get(localKey)
    request.onsuccess = () => {
      if (request.result) { result(request.result); return }
      const row: LocalOutboxRecord = { localKey, actorId, intent, receipt: null, lastError: null }
      store.add(row); result(row)
    }
  })
}
export async function readLocalOutboxV1(actorId: string): Promise<LocalOutboxRecord[]> {
  return transaction("intents", "readonly", (store, result) => {
    const request = store.index("actorId").getAll(actorId)
    request.onsuccess = () => result(request.result)
  })
}
export async function saveLocalOutboxReceiptV1(row: LocalOutboxRecord, receipt: DurableOutboxReceipt) {
  if (receipt.idempotencyKey !== row.intent.idempotencyKey || !receipt.id) throw Error("OUTBOX_RECEIPT_BINDING_INVALID")
  return transaction<void>("intents", "readwrite", store => { store.put({ ...row, receipt, lastError: null }) })
}
export async function saveLocalImageBlobV1(actorId: string, assetId: string, blob: Blob) {
  if (!/^[a-f0-9-]{36}$/i.test(actorId) || !/^[a-f0-9-]{36}$/i.test(assetId) ||
      !["image/png", "image/jpeg", "image/webp"].includes(blob.type) || blob.size > 12 * 1024 * 1024) throw Error("OUTBOX_IMAGE_BLOB_INVALID")
  return transaction<void>("images", "readwrite", store => { store.put({ localKey: `${actorId}:${assetId}`, blob }) })
}
export type MayelLocalWorkspace = { actorId: string; menu: number; selected: string[]; metricWindow: string;
  pageCursor: string | null; listings: { itemId: string; title: string; observedAt?: string | null }[];
  policy: NonNullable<ReturnType<typeof parseOutboxChangesV1>["policy"]>; dates: { startsAt: string; endsAt: string } }
export async function saveMayelLocalWorkspaceV1(workspace: MayelLocalWorkspace) {
  if (!/^[a-f0-9-]{36}$/i.test(workspace.actorId) || ![0, 1, 2, 3].includes(workspace.menu) ||
      workspace.selected.length > 20 || workspace.selected.some(id => !/^\d{9,20}$/.test(id)) ||
      !["24H", "7D", "30D"].includes(workspace.metricWindow)) throw Error("OUTBOX_WORKSPACE_INVALID")
  if (workspace.pageCursor !== null && !/^\d{9,20}$/.test(workspace.pageCursor)) throw Error("OUTBOX_CURSOR_INVALID")
  const listings = workspace.listings.slice(0,20).map(l => {
    if (l.observedAt !== undefined && l.observedAt !== null && (l.observedAt.length > 40 || !Number.isFinite(Date.parse(l.observedAt)))) throw Error("OUTBOX_OBSERVATION_INVALID")
    if (!/^\d{9,20}$/.test(l.itemId)) throw Error("OUTBOX_LISTING_INVALID")
    return { itemId: l.itemId, title: parseOutboxChangesV1({ title: l.title }).title!, observedAt: l.observedAt ?? null }
  })
  const policy = parseOutboxChangesV1({ policy: workspace.policy }).policy!
  const dates = { startsAt: String(workspace.dates.startsAt).slice(0, 30), endsAt: String(workspace.dates.endsAt).slice(0, 30) }
  if (Object.values(dates).some(v => v && !/^[0-9T:.-]+$/.test(v))) throw Error("OUTBOX_DATES_INVALID")
  return transaction<void>("workspace", "readwrite", store => { store.put({ actorId: workspace.actorId,
    menu: workspace.menu, selected: [...workspace.selected], pageCursor: workspace.pageCursor, listings, metricWindow: workspace.metricWindow, policy, dates }) })
}
export async function readMayelLocalWorkspaceV1(actorId: string): Promise<MayelLocalWorkspace | null> {
  return transaction("workspace", "readonly", (store, result) => {
    const request = store.get(actorId); request.onsuccess = () => result(request.result ?? null)
  })
}
// Transport credentials exist only in the caller's in-memory request. Neither
// the intent nor its receipt contains headers, sessions, tokens or signed URLs.
export async function flushLocalOutboxV1(actorId: string, send: (intent: OutboxIntent) => Promise<DurableOutboxReceipt>) {
  const rows = await readLocalOutboxV1(actorId)
  for (const row of rows.filter(r => !r.receipt)) {
    try {
      const receipt = await send(row.intent)
      await saveLocalOutboxReceiptV1(row, receipt)
    } catch (error) {
      const value = error instanceof Error ? error.message : ""
      const lastError = /^[A-Z0-9_]{3,120}$/.test(value) ? value : "OUTBOX_SERVER_UNREACHABLE"
      await transaction<void>("intents", "readwrite", store => { store.put({ ...row, lastError }) })
    }
  }
  return readLocalOutboxV1(actorId)
}

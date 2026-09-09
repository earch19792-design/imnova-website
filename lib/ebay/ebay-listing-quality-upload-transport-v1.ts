export const QUALITY_UPLOAD_MAX_FILE_BYTES = 3_000_000
export const QUALITY_UPLOAD_ENDPOINT = "/api/admin/ebay/listing-quality-report"
export const QUALITY_UPLOAD_STAGES = ["UPLOAD_BUTTON", "FILE_INPUT", "BROWSER_VALIDATION",
  "REQUEST_CONSTRUCTION", "AUTH", "ROUTE", "FILE_TRANSPORT", "UPLOAD_ATTEMPT_LEDGER",
  "WORKBOOK_PARSER", "IMPORT_VALIDATION", "IMPORTS", "SIGNALS", "STATUS_READBACK", "ASSISTANT_QUALITY_CONTEXT"] as const
export type QualityUploadStage = typeof QUALITY_UPLOAD_STAGES[number]
export type QualityUploadTrace = { TRACE_ID: string; FAILURE_STAGE: QualityUploadStage | null;
  HTTP_STATUS: number | null; ERROR_CODE: string | null;
  UPLOAD_ATTEMPT_ROW_CREATED: boolean;
  stages: Record<QualityUploadStage, { REACHED: boolean; HTTP_STATUS: number | null;
    ERROR_CODE: string | null; TRACE_ID: string }> }

export function createQualityUploadTraceV1(seed?: string | null): QualityUploadTrace {
  const TRACE_ID = seed && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(seed)
    ? seed : crypto.randomUUID()
  return { TRACE_ID, FAILURE_STAGE: null, HTTP_STATUS: null, ERROR_CODE: null,
    UPLOAD_ATTEMPT_ROW_CREATED: false,
    stages: Object.fromEntries(QUALITY_UPLOAD_STAGES.map(stage => [stage,
      { REACHED: false, HTTP_STATUS: null, ERROR_CODE: null, TRACE_ID }])) as QualityUploadTrace["stages"] }
}

export function qualityUploadCodeV1(value: unknown, fallback: string) {
  return typeof value === "string" && /^QUALITY_REPORT_[A-Z0-9_]{3,140}$/.test(value)
    ? value : fallback
}

export function qualityUploadFailureMessageV1(code: string) {
  if (code === "QUALITY_REPORT_OWNER_AUTH_REQUIRED") return "La carga requiere una sesión OWNER_ADMIN vigente. Inicia sesión como owner."
  if (code === "QUALITY_REPORT_DEDICATED_PREPROD_ONLY") return "Esta pantalla no pertenece al preprod dedicado habilitado para importar reportes. Abre imnova-seller-os-preprod.vercel.app."
  if (code === "QUALITY_REPORT_FILE_TOO_LARGE" || code === "QUALITY_REPORT_HTTP_413") return "El archivo supera el límite de carga de 3 MB. No llegó al parser."
  if (code === "QUALITY_REPORT_CONTENT_TYPE_INVALID") return "El transporte del reporte no coincide con el contrato JSON/base64 de esta pantalla."
  if (code === "QUALITY_REPORT_INPUT_INVALID") return "La solicitud no contiene el archivo y formato requeridos. No llegó al parser."
  if (code === "QUALITY_REPORT_NETWORK_FAILED" || code === "QUALITY_REPORT_REQUEST_TIMEOUT") return "No se confirmó el resultado de la solicitud. Comprueba el último intento antes de volver a subir el archivo."
  if (code === "QUALITY_REPORT_UNSUPPORTED_FILE_TYPE") return "Formato no compatible. Usa CSV, XLSX o JSON."
  if (code === "QUALITY_REPORT_NO_VALID_SHEET") return "No se encontró una hoja válida del reporte. Consulta el código y la etapa del intento."
  if (code === "QUALITY_REPORT_FILE_READ_FAILED") return "El navegador no pudo leer el archivo seleccionado."
  return "No se completó la importación. Consulta el código y la etapa de esta solicitud."
}

export class QualityUploadErrorV1 extends Error {
  readonly trace: QualityUploadTrace
  readonly payload: Record<string, unknown> | null
  constructor(trace: QualityUploadTrace, payload: Record<string, unknown> | null = null) {
    super(qualityUploadFailureMessageV1(trace.ERROR_CODE ?? "QUALITY_REPORT_IMPORT_FAILED"))
    this.trace = trace; this.payload = payload
  }
}

export async function submitQualityUploadV1(input: {
  file: Pick<File, "name" | "type" | "size">;
  read: (format: "CSV" | "XLSX" | "JSON") => Promise<string>;
  ownerToken: () => Promise<string | null>;
  request: typeof fetch;
}) {
  const trace = createQualityUploadTraceV1()
  let stage: QualityUploadStage = "FILE_INPUT"
  const reach = (next: QualityUploadStage) => { stage = next; trace.stages[next].REACHED = true }
  const fail = (code: string, payload: Record<string, unknown> | null = null): never => {
    trace.ERROR_CODE = code; trace.FAILURE_STAGE = stage
    trace.stages[stage].ERROR_CODE = code
    throw new QualityUploadErrorV1(trace, payload)
  }
  reach("UPLOAD_BUTTON"); reach("FILE_INPUT"); reach("BROWSER_VALIDATION")
  const extension = input.file.name.toLowerCase().split(".").pop()
  const format = extension === "xlsx" ? "XLSX" : extension === "csv" ? "CSV" : extension === "json" ? "JSON" : null
  if (!format) fail("QUALITY_REPORT_UNSUPPORTED_FILE_TYPE")
  if (input.file.size > QUALITY_UPLOAD_MAX_FILE_BYTES) fail("QUALITY_REPORT_FILE_TOO_LARGE")
  if (input.file.size <= 0) fail("QUALITY_REPORT_INPUT_INVALID")
  // MIME is advisory: eBay XLSX may be octet-stream or have an empty MIME.
  reach("REQUEST_CONSTRUCTION")
  let content: string
  try { content = await input.read(format!) } catch { return fail("QUALITY_REPORT_FILE_READ_FAILED") }
  if (!content) fail("QUALITY_REPORT_INPUT_INVALID")
  reach("AUTH")
  let token: string | null
  try { token = await input.ownerToken() } catch { return fail("QUALITY_REPORT_OWNER_AUTH_REQUIRED") }
  if (!token) fail("QUALITY_REPORT_OWNER_AUTH_REQUIRED")
  const body = JSON.stringify({ format, fileName: input.file.name, mimeType: input.file.type, content })
  reach("FILE_TRANSPORT")
  let response: Response
  try {
    // Native window.fetch rejects an arbitrary object as its receiver.
    const request = input.request
    response = await request(QUALITY_UPLOAD_ENDPOINT, { method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json",
        "x-seller-os-trace-id": trace.TRACE_ID }, body,
      signal: AbortSignal.timeout(75_000) })
  } catch (error) {
    return fail(error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)
      ? "QUALITY_REPORT_REQUEST_TIMEOUT" : "QUALITY_REPORT_NETWORK_FAILED")
  }
  trace.HTTP_STATUS = response.status
  trace.stages.FILE_TRANSPORT.HTTP_STATUS = response.status
  let payload: Record<string, unknown>
  try { payload = await response.json() } catch { return fail(`QUALITY_REPORT_HTTP_${response.status}`) }
  const server = payload.uploadTrace as QualityUploadTrace | undefined
  if (server?.TRACE_ID === trace.TRACE_ID && server.stages) {
    trace.UPLOAD_ATTEMPT_ROW_CREATED = server.UPLOAD_ATTEMPT_ROW_CREATED === true
    for (const key of QUALITY_UPLOAD_STAGES) {
      const observed = server.stages[key]
      if (observed?.REACHED === true) trace.stages[key] = observed
    }
    if (server.FAILURE_STAGE && QUALITY_UPLOAD_STAGES.includes(server.FAILURE_STAGE)) stage = server.FAILURE_STAGE
  }
  if (!response.ok || payload.success !== true || !payload.status) {
    return fail(qualityUploadCodeV1(payload.ERROR_CODE ?? payload.error,
      `QUALITY_REPORT_HTTP_${response.status}`), payload)
  }
  return { payload, trace }
}

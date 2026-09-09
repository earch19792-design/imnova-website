# ASSISTANT_LISTING_OPTIMIZATION_AND_QUALITY_ATTRIBUTION_V1

Fecha: 2026-09-09. Modo: READ-ONLY/local. Estado: atribución parcial con defectos P0 probados; intento histórico exacto de imágenes todavía UNPROVEN.

Phase A y Block G permanecen certificados por el cierre previo. No se ejecutó Research, Shipping, generación de imágenes, publicación, migración, deploy, reinicio ni cambio de configuración. Sólo consultas, lecturas del conector, pruebas locales y estos archivos de evidencia. No se abrió Command Center, Research normal o StockGuard.

Código auditado: `7ad1d263c25dd53f60307b17ede992c79069f7b1` (incluye implementación preprod `91468d144b43508bcb38cce3ee8b64a6a218ed6a`). Ningún fix implementado en esta fase de diagnóstico.

## Resultado principal

El reporte sí existe y el listing sí se puede leer. La Asistente utiliza un relay antiguo, la proyección comercial no incorpora los imports durables y el resolver E2E por Item ID omite el vínculo exacto ya verificado. El contrato de conversación ofrece lecturas, no una operación integrada de optimización hasta Preview. No hay evidencia para atribuir el intento actual de imágenes a un fallo del proveedor.

Lecturas reproducidas por el conector real: [readback acotado](./assistant-listing-quality-attribution-v1-readback.json).

## 1. Listing Quality: import, señal, backend, Assistant y UI

Supabase preprod `vsfthqydfrdzulldbfbe`: ocho imports, todos del mismo account. Los intentos recientes están IMPORTED, con `failed_stage=NONE`, códigos de fallo null y `valid_import_id` resuelto.

| Criterio | Import ID | Report date | Imported at UTC | Señales |
|---|---|---|---|---|
| Mayor fecha de reporte válida | a7ffd59f-b8e4-4a77-8eb3-78c195362311 | 2026-09-04 | 2026-09-04 21:53:11.343024 | 1 |
| Último archivo subido, elegido actualmente | 24f1746e-6298-47b5-89f3-0c03348e0fd7 | 2026-09-03 | 2026-09-05 02:56:13.422916 | 1 |

Ambos tienen account match y exact Item ID match. Ambos cubrieron 12 de los 17 listings del scope de importación; ese 17 es histórico, no el tamaño del cohort actual. Hoy ambos reportes son STALE. La única señal de ambos corresponde al Item `366643122092`, tipo `VISUAL_COVERAGE_REVIEW`, con product truth soportada. El del 4 almacenó ENRICH/actionable=true; eso no autoriza tratarlo como actionable hoy.

Defectos probados:

1. `readOwnerListingQualityReportStatusV1` y `readRemoteListingQualitySignalsV1`, en `lib/ebay/ebay-listing-quality-report-owner-import-v1.ts:739` y `:829`, ordenan únicamente por `imported_at DESC`. Subir un reporte anterior desplaza uno más reciente. Falta desempate estable y un único resolver por account/marketplace/report date.
2. El lector de estado recalcula CURRENT/STALE por fecha UTC, pero conserva `signals_actionable` histórico. Reproducción local: estado STALE con `signalsActionable=1`. El lector remoto sí degrada a WAIT y desactiva acciones: hay semánticas divergentes entre consumidores.
3. `commercial-monitor-readonly-repository.ts` no lee las dos tablas de Quality. `commercial-monitor-readonly-service.ts:3842` llama a `buildCommercialMonitorBackendV1` sin `listingQualityReportArtifact`.
4. `normalizeEbayListingQualityReport`, `ebay-commercial-monitor-intelligence-v1.ts:106`, devuelve `UNAVAILABLE_NO_CURRENT_REPORT / LISTING_QUALITY_REPORT_NOT_PROVIDED` si no recibe artifact. También convierte un artifact válido con cero recomendaciones en MISSING; existencia y cantidad de señales están indebidamente acopladas.
5. El contrato in-memory antiguo no representa import ID, report date, freshness y estado de acción como ejes separados. Puede asociar por SKU único; la integración durable debe preservar el Item ID exacto, no degradarse a una asociación menos fuerte.
6. `seller_os_get_quality_guidance` proyecta ese estado incompleto, y la lectura individual devuelve `ebayGuidanceStatus=MISSING / GUIDANCE_NOT_AVAILABLE`. Confirmado en el conector, no sólo inferido del código.
7. El control owner sí consulta el import durable y muestra fecha/conteos, mientras Assistant y revisión estratégica dependen del monitor desconectado. Por eso pueden discrepar aunque el import esté intacto. El control owner también distingue último intento de último reporte, pero su resolver actual usa el orden incorrecto.

Contrato propuesto, aún no implementado:

- `reportExists`, `importId`, `reportDate`, `importedAt`, cobertura y limitaciones visibles siempre que se encuentre un import válido.
- Freshness: CURRENT o STALE. Mantener la política actual de fecha UTC hasta que se cambie explícitamente; no inventar un periodo de vigencia diferente.
- Estado de acción separado: ACTIONABLE sólo con vigencia y evidencia suficiente; WAIT cuando la señal no justifique una acción actual; NEEDS_EVIDENCE cuando falte verdad de producto o evidencia requerida. STALE nunca debe convertirse en «no existe».
- Un import válido con cero señales sigue existiendo. Un upload fallido posterior no reemplaza la autoridad válida. Un read fallido devuelve UNAVAILABLE, no MISSING ni un cero fabricado.

## 2. Runtime y destino efectivos de la Asistente

El tool `seller_os_get_dev_status` declaró SHA `5c6a3c21b88daff6e59fcf7aeecfcf099fc40e5a`, detached y clean. Es el runtime local del túnel, no el SHA del backend cloud.

Se verificaron los drop-ins efectivos del servicio y, sin imprimir secretos, el hostname en el entorno del proceso activo PID 2514:

`imnova-website-z1qh-ddm5prha7-earch19792-6888s-projects.vercel.app/api/seller-os/assistant/cloud-read-relay`

Vercel confirma deployment `dpl_8DBtEfz8hYZP8SpFS9Fahiu9V9MR`, proyecto `imnova-website-z1qh`, SHA `8005cb69a1738d267698db2d1ba18b17e753f5c0`, READY. No es el preprod certificado. La lectura por package efectivamente carece de `KEYWORD_INTELLIGENCE` y `READ_DIAGNOSTICS`; el source de ese SHA tampoco los contiene. No se cambió el binding ni se reinició el servicio.

Los logs de ese deployment contienen estas cuatro peticiones de nuestra comprobación, todas HTTP 200 y `traceId` vacío:

- `qwd97-1788957127211-b347c1e5845b`
- `vg2qj-1788957138443-26ac688c2bbd`
- `gqqvc-1788957147537-495582f39844`
- `262l7-1788957219958-afc53de23514`

Son IDs de petición del servidor. Sin body/tool-name en esos registros no hay join explícito que permita etiquetar cada uno como un tool concreto; su coincidencia temporal no sustituye un TRACE_ID E2E. No son los IDs del fallo histórico del usuario.

## 3. Identidad exacta: lectura LIVE pasa, resolución E2E falla

Se eligió un listing real por la señal del reporte, no se asumió que fuera el listing del intento fallido del usuario:

- Item ID: `366643122092`.
- Título: Car Windshield Phone Holder ABS PVC Black Adjustable Width.
- eBay SKU: `IMNOVAD28114BA01D9413490E4927035E66255`.
- Supplier product/variant: `9220873322720 / 48809689415904`.
- Opportunity: `b7087b76-3c03-4892-b99b-421a6f0c545c`.
- Package: `d28114ba-01d9-4134-90e4-927035e66255`.

`seller_os_get_listing_intelligence` devolvió LIVE_ACTIVE, cantidad 1, precio 22.98 USD y fuente `EBAY_TRADING_GET_MY_EBAY_SELLING`, observada a `2026-09-09T12:32:09.374Z`. Este read PASS es acotado a identidad/hechos LIVE de este Item, no certifica contenido completo ni todos los listings.

`seller_os_get_product_case(EBAY_ITEM_ID)` devolvió a las 12:32:27.600Z `CONTRADICTED / CANONICAL_PRODUCT_IDENTITY_NOT_FOUND`, `NEXT_BLOCKING_STAGE=LUNA_SOURCE`.

Causa en `lib/seller-os/audit-observability-gateway-v1.ts:188`: consulta `ebay_active_listings` por account+Item ID con `limit(1)` sin orden, y exige supplier variant/SKU de esa fila. Existen dos filas de fuentes diferentes para el mismo account/item: la fila LIVE reciente tiene ambos campos null; la fila GetItem anterior sí contiene el vínculo. No consulta `ebay_manual_listing_links` ni la decisión exacta certificada para resolver esta situación.

Además, buscar simplemente por variante tampoco sería una corrección suficiente: hay dos candidate keys para la misma variante. El enlace verificado fija inequívocamente la opportunity y candidate key SHA correctas. Debe reutilizarse esa autoridad, manteniendo por separado la fuente LIVE actual y la procedencia del vínculo.

Control positivo: pedir el mismo expediente por LISTING_PACKAGE_ID sí devuelve la identidad completa, CATEGORY/ASPECTS/LISTING_PACKAGE PROVEN. Por tanto no faltan el producto ni el paquete; falla el recorrido por Item ID. El paquete aprobado contiene título, descripción de 267 caracteres, dos aspects e image manifest. Su existencia histórica no prueba que una optimización nueva haya llegado a Preview.

## 4. Recorrido de optimización y Keyword V2.1

| Etapa solicitada | Evidencia y estado actual |
|---|---|
| Assistant request | MCP y Copilot tienen herramientas read-only; no existe una operación conversacional integrada para preparar la optimización y su Preview. |
| Exact listing identity | Lectura LIVE PASS; resolución E2E por Item ID rota como se describe arriba. |
| Listing Quality | Import durable existe; omitido por el monitor y relay actuales. |
| Keyword Intelligence V2.1 | Autoridad durable y decoder/validator existen en código actual. Relay servido es anterior; Copilot sólo registra las 13 lecturas comerciales y no el tool de expediente. |
| Item Specifics | Existen aspects del package aprobado; no deben inventarse ni confundirse con una nueva validación de requisitos de categoría. |
| Title / description | Motor determinista local acepta un input completo; no hay ensamblador conectado desde Assistant. La lectura LIVE entrega título, no descripción completa ni specifics actuales. |
| Images | Copilot declara `imageGenerationEnabled=false`; MCP no registra un tool de generación. UI y rutas de generación son otra superficie. |
| Sell One Like This | Assistant expone referencia/recommendation como evidencia, no un handoff ejecutable hacia el package. Para el Item auditado, referencia canónica está UNPROVEN. |
| Listing Package / Preview | Hay un package anterior aprobado; no se demuestra un package nuevo producido por Assistant ni Preview de nueva optimización. |
| Publication | No ejecutada; no autorizada por este workstream. |

`POST /api/admin/ebay/listing-optimization` acepta JSON completo, ejecuta el motor puro y devuelve archivos, con `persistenceUsed=false` y `canPublish=false`. La pantalla actual `/admin/ebay/listing-optimization` llama en cambio a `/api/admin/ebay/strategic-review`: la documentación antigua describe una UI de edición/exportación que ya no corresponde a esa página. No se llamó ninguno de estos POST.

Keyword: `readKeywordDecisionHandoffV1` y `consumeListingPackageKeywordHandoffV1` validan versión V2_1, binding, digest y readiness. Sin embargo, los callers de `buildQuickPickMarketTestListingReviewV1` no suministran `keywordDecisionHandoff`, `keywordDecisionBinding` ni `requireKeywordDecisionV2_1`; se mantiene el fallback de keywords antiguo. Incluso al pasar el handoff, el título se calcula antes desde `titleStrategy.primarySearchPhrase`, no desde la clasificación aceptada. Debe conectarse el consumidor, no reprocesar Research.

Para la opportunity de este Item ya existe decisión durable V2_1 en plan `53e15e08-fa8d-44dd-83f3-cfdbb8995c1d`, COMPLETED pero `KEYWORD_DECISION_READY=false`, con:

- INSUFFICIENT_CURRENT_COMPATIBLE_SOLD_ITEMS
- RESEARCH_NOT_COMMERCIALLY_SUFFICIENT
- NO_DEFENSIBLE_PRIMARY_QUERY_CONCEPT

Esto es una limitación comercial existente, no una nueva regresión de Research ni permiso para reabrirlo. Arreglar el consumidor debe hacer visible NEEDS_EVIDENCE; no puede convertir esa decisión en READY o prometer una optimización basada en demanda probada.

## 5. Imágenes y errores sin atribución

Defecto de UI probado: se ofrece Crear variante para cada finding mostrado (`listing-optimization/page.tsx:369`). El analizador puede producir `LOW_SOURCE_RESOLUTION`, pero `strategic-review/route.ts:162` no lo admite y devuelve `VISUAL_VARIANT_CREATE_INVALID` antes de llamar al proveedor. Es un caso reproducible del contrato, no evidencia de que ése fuera el botón pulsado por el usuario.

Otros controles existentes deben conservarse: razón material, fuente full-resolution, enlace exacto/product truth, cantidad de variantes, presupuesto, QA y revisión. No se probaron mediante nuevas generaciones.

La tabla `ebay_openai_image_context_runs` está vacía: eso no demuestra ausencia de llamadas de todas las rutas. La ruta visual registra en `ai_listing_budget_usage`: hay un FAILED del 30 de agosto, receipt `seller-os-visual:cdca4274-19f2-47d0-b163-9dac34b31062`, seguido por un COMPLETED y experimento DRAFT para Item `366582586826`. El receipt FAILED no guarda causa ni provider request ID; no es atribuible al intento actual. Las otras rutas tienen fallos históricos de julio, insuficientes para explicar el fallo descrito hoy.

Consultas de logs de rutas strategic-review e images en las ventanas auditadas no devolvieron entradas relevantes. Esto limita la atribución; no prueba que nunca se haya intentado ni que el proveedor esté sano.

| Fallo/caso | ERROR_CODE existente | DEPENDENCY_STAGE atribuible | TRACE_ID | FAIL_CLOSED_REASON |
|---|---|---|---|---|
| Quality omitido | LISTING_QUALITY_REPORT_NOT_PROVIDED (backend; tool no lo expone) | LISTING_QUALITY_PROJECTION | No expuesto | Artifact no suministrado; no es ausencia durable. |
| Expediente por Item | CANONICAL_PRODUCT_IDENTITY_NOT_FOUND (campo CONTRADICTION) | EXACT_LISTING_IDENTITY | No expuesto | Fila seleccionada sin binding; autoridad verificada omitida. |
| Input motor incompleto, reproducción local | LISTING_OPTIMIZATION_INPUT_INVALID | INPUT_VALIDATION | No generado | ZodError se reduce a código genérico; siete paths de input requeridos se pierden. |
| Finding no admitido, contrato UI/backend | VISUAL_VARIANT_CREATE_INVALID | IMAGE_REQUEST_VALIDATION | No generado | LOW_SOURCE_RESOLUTION no admite variante generativa. |
| Fallo de fetch, reproducción local del mapper | SELLER_OS_VISUAL_VARIANT_FAILED | Etapa original perdida | No generado | El mapper pierde la excepción de transporte y no identifica la dependencia. |
| Intento de imágenes referido por el usuario | UNPROVEN | UNPROVEN | No recuperado | No existe aún correlación con un receipt de ese intento; generación no repetida. |

También borran origen/dependencia los catch de MCP (`SELLER_OS_EVIDENCE_READ_FAILED_CLOSED`, `SELLER_OS_AUDIT_READ_FAILED_CLOSED`), Copilot (`COPILOT_EVIDENCE_READ_FAILED_CLOSED`), tools internos (`SELLER_OS_TOOL_FAILED_CLOSED`) e images (`EBAY_IMAGE_PIPELINE_FAILED`). El relay crea requestId pero no lo conserva en el resultado final consumido por Assistant. No inventar TRACE_ID retrospectivos. En producción futura, devolver el cuarteto obligatorio con códigos por etapa y sanitización; no exponer mensajes crudos, secretos ni payloads.

## 6. Verificación local y límites

11 archivos de tests enfocados pasaron (9 de Quality/monitor/Assistant/motor/visual/keyword/package y 2 de audit gateway/relay), usando `node --import ./tools/seller-os-test-module-resolution-v1.mjs --test`. No es una certificación E2E: las pruebas existentes no prueban el cableado de imports durables, latest-report ordering, parity del relay ni el handoff obligatorio del consumidor.

Reproducciones locales adicionales, sin red: selector usa sólo imported_at; status STALE conserva actionable histórico; artifact ausente produce el código observado; input vacío pierde paths de Zod; `Error("fetch failed")` se convierte en SELLER_OS_VISUAL_VARIANT_FAILED.

No se cambió comportamiento, configuración ni estado remoto. La skill de Supabase se utilizó para inspeccionar primero las autoridades y limitar las consultas a lecturas; no se propusieron cambios de esquema ni permisos para ocultar los fallos.

## 7. P0_FIX_PLAN

1. Unificar el resolver de import válido por account/marketplace y report_date DESC, imported_at DESC, id DESC; integrar imports + signals en monitor, tools, context y UI. Separar existencia, freshness y actionability. Preservar fechas/cobertura ante STALE, cero señales y último upload fallido.
2. Corregir resolución Item ID → enlace verificado → opportunity/candidate/package exactos. Usar fuente LIVE para presencia/precio y autoridad de linkage para identidad proveedor. No elegir una fila arbitraria ni el primer candidate por SKU/variante; conflictos reales siguen fail-closed.
3. Añadir el cuarteto ERROR_CODE / DEPENDENCY_STAGE / TRACE_ID / FAIL_CLOSED_REASON a cada frontera existente y propagar la correlación hasta UI/MCP. Mantener límites de seguridad. Primero atribución de errores, después reintentos autorizados.
4. Conectar Keyword V2.1 validado al consumidor de optimización, clasificación/título y package; suprimir fallback sólo en el flujo sujeto a ese contrato. Exponer NEEDS_EVIDENCE del plan existente, sin captura, recomputación o modificación de Research. Conservar contenido aprobado y cambios owner.
5. Conectar la preparación hasta Preview a los motores/autoridades existentes, con alcance explícito draft-only y autorización separada para persistencia/gasto. No añadir capacidad de escritura encubierta a herramientas read-only. Mantener publicación fuera de este alcance.
6. Corregir affordance de imágenes: sólo habilitar acciones compatibles con la razón y capacidades actuales; para baja resolución solicitar evidencia adecuada. Recuperar el intento exacto antes de elegir cualquier fix específico de proveedor. No regenerar activos válidos para diagnosticar.
7. Probar contratos end-to-end locales y, sólo bajo autorización posterior, alinear el runtime/relay de Assistant con la release validada en preprod. El simple deploy web no actualiza el túnel ni su destino fijo. No reinicio/rebinding/deploy en esta etapa.

Gates mínimos: reporte válido vacío visible; import anterior no desplaza al reciente; STALE no actionable; NEEDS_EVIDENCE sin verdad inventada; account isolation; exact-link vs duplicados; parity de identidad entre tools; Keyword V2.1 no fallback y bloqueo explícito; errores sanitizados con trace; finding unsupported sin provider call; paquete y Preview con binding/digests estables; cero marketplace writes. Suite completa antes de cualquier activación.

SAFE_TO_IMPLEMENT_REVENUE_FIRST_FIXES=true únicamente para los fixes locales probados y esos límites. No significa permiso para activar servicios, gastar en generación o publicar. Causa específica del intento histórico de imágenes sigue pendiente del Item ID, superficie y error/receipt del intento.

# ASSISTANT_LISTING_QUALITY_UPLOAD_E2E_P0_V1

Base: Assistant P0 certificado en `147857f9f3c733b0136c80212cfd6e975b623a88`, cierre documental `82a4d202a15ec5e24d73e6ff4d17f20a4af245f3`. Fecha 2026-09-09.

**STATUS=PASS.** Un único upload físico por Chrome, usando la misma UI y una sesión OWNER_ADMIN iniciada por el usuario, respondió HTTP 200. Se crearon un intento IMPORTED y un nuevo import, con 12 filas procesadas, 12 LIVE vinculadas y una señal. La Asistente localiza ese import por su recibo sin recarga manual. Marketplace writes: 0.

Implementación final: `2dad6a8dddc36710d5df8b3da76f75d6fa3f71c3`. [Readback completo](assistant-listing-quality-upload-e2e-p0-v1-readback.json). [Captura de la UI física](artifacts/assistant-listing-quality-upload-e2e-p0-v1.png).

La evidencia de staging confirma que no hay un upload attempt posterior a `33e7b196-6aaf-4e9e-9883-afddbcf1bd3e` (2026-09-05T02:56:05.028Z). Los cinco últimos intentos fueron IMPORTED. Esto mantiene PRE_INGESTION_UPLOAD_FAILURE como hipótesis inicial; no demuestra un fallo del parser.

La sesión OWNER_ADMIN real consulta `/api/admin/ebay/listing-quality-report` con HTTP 200 en el proyecto dedicado. Botón e input habilitados. La UI y el backend comparten JSON/base64; multipart no es su contrato. El XLSX cuyo nombre indica 4 de septiembre tiene 164730 bytes y el parser existente reconoce 12 filas.

## Corrección acotada

La UI anterior enviaba cualquier rechazo desconocido a `humanUploadFailure`, que afirmaba que el archivo no pasó validación incluso para un 403 de entorno o auth. La ruta retornaba sin intento para esos rechazos y para un cuerpo inválido. Los errores posteriores de persistencia del ledger podían escapar como un 500 genérico.

La corrección conserva parser, tablas, import RPC, idempotencia, aislamiento dedicado, OWNER_ADMIN y protección de origen. Añade correlación UUID desde el navegador, etapas y códigos seguros en todas las respuestas POST, errores de transporte explícitos, guard de 3 MB antes de leer/enviar, y comprobación owner en cliente. MIME vacío u octet-stream no rechaza un XLSX válido. El input también se deshabilita durante una carga; se restablece tras finalizar. La UI deja de llamar «actualizado hoy» a un reporte STALE.

No se abre la ruta a Preview genérico, producción, service-role ni operador remoto. No se añade multipart ni se reimplementa el parser. La consulta de estado fallida se presenta como fallo de consulta, sin inventar ausencia de reporte.

## Semántica de trazabilidad

Cada etapa tiene REACHED, HTTP_STATUS, ERROR_CODE y TRACE_ID. HTTP_STATUS es la respuesta HTTP de la solicitud, no una llamada HTTP separada por etapa. Las etapas previas a enviar tienen HTTP_STATUS null. El backend sólo afirma etapas observadas en servidor; el cliente agrega las etapas que ejecutó.

El ledger existente es append-only de resultados terminales (IMPORTED/FAILED_VALIDATION); no admite RECEIVED. Por ello su escritura se confirma después del parser/validación o de su fallo, no antes. REACHED indica que se llegó a la etapa; UPLOAD_ATTEMPT_ROW_CREATED sólo es true después de confirmar persistencia. Una solicitud sin auth o con cuerpo inválido devuelve ledger REACHED=false. No se fabrica un intento IMPORTED ni se escribe un fallo anticipado para alterar ese orden.

La etapa ASSISTANT_QUALITY_CONTEXT sólo se certifica mediante una lectura posterior de la Asistente, separada del POST. Los imports repetidos del mismo archivo reutilizan el ID válido por diseño y crean un nuevo upload attempt; un canario no fuerza duplicados ni cambia la fecha del reporte.

La causa del intento histórico concreto permanece no atribuida sin una solicitud/trace de ese intento. La regresión demostrada es la clasificación incorrecta y falta de trazabilidad de los rechazos previos a la ingestión.

## Evidencia física y autoridad de fecha

- TRACE_ID del upload: `4af522c0-59e4-4923-bfc0-acd1bdb1f908`.
- UPLOAD_ATTEMPT_ID: `bd302fca-233b-4cda-8ec7-123d99c41205`.
- VALID_IMPORT_ID nuevo: `edb9403f-7577-4b7a-b8ab-37665b7dbc44`; idempotent=false.
- El ledger correlaciona el mismo TRACE_ID mediante `qlr_attempt_abe7c91f2b8f8b237a21a5e46dcc08c6`.
- Se ejecutó exactamente un POST físico de upload. Las pruebas negativas de Chrome interceptaron la respuesta con mocks y no llegaron al backend.

El workbook no incluye una fecha etiquetada de reporte. El parser existente deriva `2026-08-27` de `workbookCreatedAt=2026-08-27T14:38:27.000Z`; el nombre del archivo no constituye autoridad. Este fallback se conserva y se registra como limitación, sin presentar la fecha de creación como fecha de generación demostrada.

Por ello, el selector P0 conserva `a7ffd59f-b8e4-4a77-8eb3-78c195362311`, report_date=2026-09-04, STALE/WAIT, como reporte más vigente. La lectura agrega `latestUploadAttempt`: identifica el nuevo intento/import, su fecha persistida, vigencia, filas y señales, con `selectedAsLatestValidReport=false`. La consulta está acotada al account y marketplace y no expone el archivo ni celdas crudas. Un fallo del recibo devuelve UNAVAILABLE sin ocultar el reporte válido.

La Asistente confirma `latestUploadAttempt.validImportId=edb9403f-7577-4b7a-b8ab-37665b7dbc44` y el attempt ID exacto. El nuevo upload no se confunde con la autoridad del reporte más vigente.

## Release y límites

Certificación final: 374/374 archivos de pruebas PASS, TypeScript, lint, build, seguridad de runtime y CI audit PASS. Las pruebas del transporte incluyen la semántica nativa de fetch en Chrome; la prueba de lectura verifica que un upload anterior sea visible sin reemplazar el reporte más vigente ni cruzar accounts. Cero regresiones pendientes.

El canario de upload se ejecutó en `0f250abbed42a33e7ce8e84e121bde67b5d19426`, deployment `dpl_3m6AdeZsCAjukvV6iQva2WfPq1KL`. La UI, ruta y transporte de upload son idénticos en el commit final; los cambios posteriores agregan la lectura del recibo. No se repitió la carga.

Deployment final: `dpl_4gLkbtnGEvdsciscBaY82ZcYexjv`, dedicado preprod, READY. El relay apunta a ese deployment. El checkout y build local certificado permanecen en `147857f9`; sólo se reiniciaron los servicios existentes para cargar la nueva URL, con rollback conservado. No se modificaron bindings OpenAI, parser, schema, listings ni autorizaciones de publicación.

SAFE_FOR_ASSISTANT_FULL_LISTING_PREVIEW_CANARY=true exclusivamente para el canario DRAFT/read-only. Quality sigue STALE/WAIT y Keyword puede seguir NEEDS_EVIDENCE. Esta certificación no acredita calidad vigente ni readiness comercial para publicar.

Referencia de autenticación: [Supabase getUser](https://supabase.com/docs/reference/javascript/auth-getuser). La autorización del servidor existente no se sustituye por claims editables del usuario.

## Matriz de etapas observadas

El orden mostrado sigue el flujo solicitado; el ledger terminal se persiste después de procesar el archivo.

| Etapa | REACHED | HTTP_STATUS | ERROR_CODE | TRACE_ID |
|---|---|---|---|---|
| UPLOAD_BUTTON | true | null | NONE | 4af522c0-59e4-4923-bfc0-acd1bdb1f908 |
| FILE_INPUT | true | null | NONE | 4af522c0-59e4-4923-bfc0-acd1bdb1f908 |
| BROWSER_VALIDATION | true | null | NONE | 4af522c0-59e4-4923-bfc0-acd1bdb1f908 |
| REQUEST_CONSTRUCTION | true | null | NONE | 4af522c0-59e4-4923-bfc0-acd1bdb1f908 |
| AUTH | true | 200 | NONE | 4af522c0-59e4-4923-bfc0-acd1bdb1f908 |
| ROUTE | true | 200 | NONE | 4af522c0-59e4-4923-bfc0-acd1bdb1f908 |
| FILE_TRANSPORT | true | 200 | NONE | 4af522c0-59e4-4923-bfc0-acd1bdb1f908 |
| UPLOAD_ATTEMPT_LEDGER | true | 200 | NONE | 4af522c0-59e4-4923-bfc0-acd1bdb1f908 |
| WORKBOOK_PARSER | true | 200 | NONE | 4af522c0-59e4-4923-bfc0-acd1bdb1f908 |
| IMPORT_VALIDATION | true | 200 | NONE | 4af522c0-59e4-4923-bfc0-acd1bdb1f908 |
| IMPORTS | true | 200 | NONE | 4af522c0-59e4-4923-bfc0-acd1bdb1f908 |
| SIGNALS | true | 200 | NONE | 4af522c0-59e4-4923-bfc0-acd1bdb1f908 |
| STATUS_READBACK | true | 200 | NONE | 4af522c0-59e4-4923-bfc0-acd1bdb1f908 |
| ASSISTANT_QUALITY_CONTEXT | true | 200 | NONE | 04c9de32-ec91-4950-bcab-3d23486bd73f |

La comprobación final del conector devuelve el mismo nuevo import y attempt ID, trace `90806309-8c10-432d-b0ed-4644feee341b`. Runtime HEALTHY, build local MATCHED y catálogo 29/29. La primera lectura del conector tras reiniciar servicios respondió HTTP 504; un único reintento de lectura pasó. No se repitió el upload ni se recargaron datos manualmente.

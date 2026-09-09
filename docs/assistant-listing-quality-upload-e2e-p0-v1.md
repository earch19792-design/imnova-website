# ASSISTANT_LISTING_QUALITY_UPLOAD_E2E_P0_V1

Base: Assistant P0 certificado en `147857f9f3c733b0136c80212cfd6e975b623a88`, cierre documental `82a4d202a15ec5e24d73e6ff4d17f20a4af245f3`. Fecha 2026-09-09.

La evidencia de staging confirma que no hay un upload attempt posterior a `33e7b196-6aaf-4e9e-9883-afddbcf1bd3e` (2026-09-05T02:56:05.028Z). Los cinco últimos intentos fueron IMPORTED. Esto mantiene PRE_INGESTION_UPLOAD_FAILURE como hipótesis inicial; no demuestra un fallo del parser.

La sesión OWNER_ADMIN real consulta `/api/admin/ebay/listing-quality-report` con HTTP 200 en el proyecto dedicado. Botón e input habilitados. La UI y el backend comparten JSON/base64; multipart no es su contrato. El XLSX real del 4 de septiembre tiene 164730 bytes y el parser existente reconoce 12 filas. Su antigüedad debe permanecer explícita.

## Corrección acotada

La UI anterior enviaba cualquier rechazo desconocido a `humanUploadFailure`, que afirmaba que el archivo no pasó validación incluso para un 403 de entorno o auth. La ruta retornaba sin intento para esos rechazos y para un cuerpo inválido. Los errores posteriores de persistencia del ledger podían escapar como un 500 genérico.

La corrección conserva parser, tablas, import RPC, idempotencia, aislamiento dedicado, OWNER_ADMIN y protección de origen. Añade correlación UUID desde el navegador, etapas y códigos seguros en todas las respuestas POST, errores de transporte explícitos, guard de 3 MB antes de leer/enviar, y comprobación owner en cliente. MIME vacío u octet-stream no rechaza un XLSX válido. El input también se deshabilita durante una carga; se restablece tras finalizar. La UI deja de llamar «actualizado hoy» a un reporte STALE.

No se abre la ruta a Preview genérico, producción, service-role ni operador remoto. No se añade multipart ni se reimplementa el parser. La consulta de estado fallida se presenta como fallo de consulta, sin inventar ausencia de reporte.

## Semántica de trazabilidad

Cada etapa tiene REACHED, HTTP_STATUS, ERROR_CODE y TRACE_ID. HTTP_STATUS es la respuesta HTTP de la solicitud, no una llamada HTTP separada por etapa. Las etapas previas a enviar tienen HTTP_STATUS null. El backend sólo afirma etapas observadas en servidor; el cliente agrega las etapas que ejecutó.

El ledger existente es append-only de resultados terminales (IMPORTED/FAILED_VALIDATION); no admite RECEIVED. Por ello su escritura se confirma después del parser/validación o de su fallo, no antes. Una solicitud sin auth o con cuerpo inválido devuelve ledger REACHED=false. No se fabrica un intento IMPORTED ni se escribe un fallo anticipado para alterar ese orden.

La etapa ASSISTANT_QUALITY_CONTEXT sólo se certifica mediante una lectura posterior de la Asistente, separada del POST. Los imports repetidos del mismo archivo reutilizan el ID válido por diseño y crean un nuevo upload attempt; un canario no fuerza duplicados ni cambia la fecha del reporte.

La causa del intento histórico concreto permanece no atribuida sin una solicitud/trace de ese intento. La regresión demostrada es la clasificación incorrecta y falta de trazabilidad de los rechazos previos a la ingestión.

Referencia de autenticación: [Supabase getUser](https://supabase.com/docs/reference/javascript/auth-getuser). La autorización del servidor existente no se sustituye por claims editables del usuario.

# SELLER_OS_REVENUE_FIRST_ASSISTANT_P0_IMPLEMENTATION_V1

Base preservada: `451c91b523a2b3e6a854c332622ebb22f1fe24ec`. Fecha: 2026-09-09.

La implementación conecta el reporte Quality durable, la identidad por Item ID y Keyword V2.1 con un Preview sin persistencia. El diagnóstico preservado no se repitió.

## Credencial

La consulta de metadatos de Vercel confirmó `PREPROD_OPENAI_KEY_PRESENT=true` en el proyecto dedicado `imnova-seller-os-preprod`, tipo `sensitive`, target Vercel `production`. Este target pertenece al proyecto de preprod. El ledger preservado declara `OPENAI_CREDENTIAL_SOURCE=EXISTING_DEDICATED_PREPROD_SERVER_SIDE_ONLY`.

No se solicitó descifrar ni descargar la credencial OpenAI; no se imprimió, copió ni creó un archivo env. Desarrollo y tests usan mocks. Una llamada física sólo puede ejecutarse dentro del deployment dedicado mediante su binding existente.

## Comportamiento

- El lector de Quality usa account + marketplace, `report_date DESC, imported_at DESC, id DESC`. Importadores y consumidores reutilizan el mismo lector. Su módulo y dependencias no incluyen escrituras. Un upload fallido no sustituye un import válido.
- Un reporte válido vacío permanece AVAILABLE. STALE conserva fecha, import ID y cobertura histórica, con cero acciones actuales. UNAVAILABLE no se transforma en MISSING ni cero. Un conteo incompleto de señales se rechaza.
- El monitor, las lecturas de Assistant, el contexto estratégico y Preview reciben esa proyección durable. La asociación durable requiere Item ID exacto; no usa fallback por SKU.
- El expediente consulta el enlace verificado account + marketplace + Item ID. Dos enlaces provocan bloqueo. La opportunity se consulta por ID y candidate key simultáneamente; una fila LIVE sin identidad proveedor no borra la identidad verificada. La procedencia del vínculo permanece separada de la fila de presencia LIVE.
- Se corrigió la asignación intercambiada de resultados Keyword/Shipping en el expediente. Keyword conserva su contrato, digest, binding y bloqueos reales.
- El consumidor de Preview exige Keyword V2.1, usa la clasificación aceptada para el título cuando corresponde y conserva contenido aprobado/ediciones owner. NEEDS_EVIDENCE no se convierte en READY ni activa el fallback antiguo. Research no se ejecuta ni se recomputa.
- `seller_os_prepare_listing_optimization_preview` está registrado en MCP, relay y Copilot como una operación sin efectos persistentes. Sólo admite Item ID; account y contenido no son entradas del caller. Copilot también recibe el tool de expediente acotado.
- La página `/admin/ebay/listing-optimization/preview?itemId=…` compara paquete existente con Preview y muestra evidencia pendiente. El endpoint existente de optimización prepara el Preview con autenticación Admin. No guarda, publica ni genera imágenes.
- Los límites de imágenes comparten una lista de findings compatibles entre UI/backend. LOW_SOURCE_RESOLUTION pide una fuente adecuada y se rechaza antes del proveedor.
- Los errores incorporan `ERROR_CODE`, `DEPENDENCY_STAGE`, `TRACE_ID`, `FAIL_CLOSED_REASON`. El relay conserva correlación; los fallos nuevos de generación registran etapa, receipt y provider request ID cuando está disponible. Los mensajes crudos se descartan. La correlación futura no atribuye retrospectivamente el intento histórico.

## Validación local

Suite completa: 361 archivos PASS, cero fallos. Nueve pruebas nuevas ejecutadas individualmente verificaron selección/aislamiento de Quality, reporte vacío, STALE, UNAVAILABLE, identidad entre Item/Package, conflictos, Keyword bloqueado, digest estable, contenido aprobado, sanitización y ausencia de llamadas para findings incompatibles. El contrato de transporte de Preview prueba Item ID, correlación y rechazo de account override.

TypeScript global: PASS después de corregir el cruce Keyword/Shipping y el acceso al discriminante opcional. Build Next webpack: PASS. El control de dependencias del monitor sigue verificando ausencia de insert/upsert/delete/fetch en su grafo de lectura. El control de rutas registra explícitamente la nueva página protegida.

Referencias técnicas consultadas: [orden por varias columnas de Supabase](https://supabase.com/docs/reference/javascript/using-modifiers-order) y [correlación de peticiones OpenAI](https://developers.openai.com/api/reference/overview#debugging-requests). No se cambiaron modelo ni precios.

## Límites

La decisión Keyword del listing preservado puede seguir NEEDS_EVIDENCE por insuficiencia comercial. El Preview usa contenido del paquete existente; no certifica una lectura completa de descripción/specifics LIVE. Sell One Like This continúa UNPROVEN cuando no existe handoff verificable. No se inventa verdad de producto, no se regeneran activos válidos para diagnosticar, no se ejecutan marketplace writes.

Estado físico de preprod y SHA de implementación: se registran en el readback de cierre.

## Primera comprobación física

Deployment `dpl_BLJRTwxdDVB2syrhPDnxbXTeor78`, SHA `7b801ca5abfb9ded016feecb6b89214755ee5a71`, proyecto dedicado preprod, READY y alias asignado.

Quality PASS: import `a7ffd59f-b8e4-4a77-8eb3-78c195362311`, report date 2026-09-04, STALE/WAIT, cobertura histórica 12/17. El rechazo LOW_SOURCE_RESOLUTION respondió 400 con el cuarteto de error antes del proveedor.

Image Optimization PASS: Item `366582671136`, finding `EDGE_CROPPING_RISK`, una variante nueva sin variante válida previa. Product Truth preservada; una llamada OpenAI mediante binding preprod; costo registrado USD 0.00638; marketplace writes 0. Trace `6a9b663d-7217-4992-a660-31e0856c848d`, provider request `req_a28ecd621b054bc7a9a69039670fb9d8`, experimento `34078a7e-85cc-4a35-ae26-24e65784e7f3`. No se atribuye este intento al fallo histórico.

El E2E de Preview detectó un guard anterior del relay que sólo admitía VERCEL_ENV=preview. Se corrigió para admitir también la clasificación dedicada existente, que exige simultáneamente proyecto, dominio, runtime y Supabase de staging. Producción compartida permanece bloqueada. Las pruebas positivas y negativas de esa frontera pasan; la segunda lectura física se registra en el readback de cierre.

Verificación durable de imagen PASS: experimento DRAFT, un recibo COMPLETED, hash del archivo descargado igual al hash del activo y de la respuesta, y protectedLayerRoundtripExact=true. La suite ampliada de release pasa 373/373 archivos (incluye todo lib/seller-os), TypeScript, lint y CI audit PASS. El binding HMAC del relay faltaba en preprod; se agregó como sensitive reutilizando el secreto existente del túnel, sin cambiar el binding OpenAI ni escribir secretos locales.

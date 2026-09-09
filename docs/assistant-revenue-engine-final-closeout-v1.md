# Mayel Revenue Engine V1: implementación y cierre pendiente

ASSISTANT_CLOSEOUT=false. El motor, el guard económico y la UI están implementados y el canary físico de Preview/simulación/receipt/medición pasó. Faltan fuentes comerciales y Keyword V2.1 válidas para autorizar tratamientos positivos y demostrar la economía completa. Las pruebas de contratos no sustituyen evidencia de una ejecución física.

## Comportamiento implementado

Mayel empieza con las métricas del ItemID exacto. Sólo una comparación con muestra, ventana, procedencia y regla contractual demostradas permite diagnosticar tráfico, CTR o conversión y escoger SCALE u OPTIMIZE. Sin esa autoridad devuelve TEST; stock bajo demostrado conduce a RESTOCK, margen insuficiente demostrado a PROFIT_PROTECT y protección existente a HOLD. No se introdujeron umbrales universales de CTR.

La proyección preserva observaciones originales y sus fechas. Las ventanas 24H, 7D y 30D permanecen vacías cuando la fuente no acredita su duración exacta. La UI muestra las observaciones de otros periodos sin cambiarlas de ventana. No inventa ventas, clics, inventario, tendencias ni métricas Ads ausentes.

El guard exige precio, producto, envío, comisiones, otros costes materiales y base de cargo Ads demostrados. Calcula el techo que respeta ambos mínimos del operador y limita la tasa a ese techo. Redondea el techo hacia abajo y el coste hacia arriba, y vuelve a comprobar los límites. Una simulación corresponde a una venta atribuida por listing elegible; no presenta previsiones de ingresos de fin de semana sin evidencia.

La navegación principal tiene cuatro acciones. El operador confirmó que el iPad entra por `https://imnova-seller-os-preprod.vercel.app/admin`. Esa ruta todavía montaba la estación antigua, aunque `/admin/ebay/mayel` ya tenía el motor nuevo. Se corrigió la entrada remota usando una capacidad devuelta por la sesión verificada exclusivamente en dedicated-preprod. No se amplió el acceso a otras rutas admin, no se concedieron permisos de OWNER_ADMIN y la superficie anterior sólo se monta al abrir Ver detalles. Producción conserva su comportamiento. La selección está acotada a 20 listings por página; la paginación utiliza ItemID. Las políticas tienen modo, tasas, beneficio, margen, horario y fechas explícitos. Los presets sólo rellenan parámetros. El Preview reutiliza P0 y conserva el original cuando las métricas no autorizan optimización. Las imágenes usan fuentes ya autorizadas mediante el pipeline certificado, con reserva idempotente previa; no requieren otra conversación ni una carga manual en ChatGPT.

Las simulaciones pueden guardar receipts inmutables por cuenta/ItemID/intención. La medición compara periodos no solapados del mismo listing y duración, con procedencia diferente, sin atribuir causalidad. La tabla staging fuerza RLS; service_role conserva únicamente SELECT e INSERT y el trigger bloquea mutaciones. No se añadieron pollers, workers, barridos globales, exact counts ni select-star.

## Evidencia real preservada y nueva

Se conserva el runtime local P0 certificado `147857f9f3c733b0136c80212cfd6e975b623a88`. No se repitió el E2E físico de imagen ni se descargó, copió o imprimió OPENAI_API_KEY. Sólo existe uso del binding preprod en el código de generación.

El upload físico de Quality ya certificado continúa documentado en `assistant-listing-quality-upload-e2e-p0-v1.md`. El parser y el contrato de transporte existente no se reimplementaron. En este trabajo no se inició otro upload físico.

Durante el trabajo se observó además un nuevo import durable `e40ff605-520b-4592-bec9-c63412ad54ea`, attempt `9c127492-1981-47bc-acf0-499339230b0b`, IMPORTED, 13 filas, 13 matches LIVE y 4 señales; reporte del 2026-09-07, STALE. No se atribuye este upload a la automatización del canary. El conector real de la Asistente lo resolvió con trace `44921d4d-8070-4260-94ac-fb132f9c4a62`. El ItemID `366643122092` conserva su señal ITEM_ID_CERTIFIED y procedencia, aunque esté STALE/WAIT.

El conector real devolvió las métricas del ItemID exacto con trace `58cc035d-124c-4802-868d-7d1dfc49f3ca`, sin recarga manual. Hubo un primer HTTP 504 de transporte tras el cambio de relay; el retry de sólo lectura fue exitoso. No se hicieron retries de writes.

## Límites que impiden declarar cerrado

- El navegador conectado inicialmente redirigió `/admin/ebay/mayel` con HTTP 307 a `/admin/login`, HTTP 200, sin error técnico de auth declarado. Después se observó la sesión abierta en el mismo perfil. Para aislar la prueba de la navegación concurrente de Product Research, la sesión preprod existente se reutilizó únicamente en memoria dentro de un Chrome temporal. No se guardó ni mostró material de autenticación y se cerró ese navegador al terminar. La prueba de UI con backend simulado pasó: selección de dos listings, cálculo y guardado en tres acciones; cuatro acciones principales; detalles cerrados; aceptación de archivo con el contrato JSON existente, sin otro import. El canary real se documenta en el readback.
- La fuente actual aporta 81 impresiones, 14 visitas y tasas crudas eBay para 2026-08-10 a 2026-09-08 UTC. Son 30 días calendario inclusivos según el contrato existente `buildEbaySellerTrafficReportUrl`, que consulta el día final hasta 23:59:59.999Z. Se corrigió la proyección nueva para reconocer 30D y producir un intervalo normalizado con fin exclusivo, conservando las fechas originales en la procedencia. No hay evidencia de 24H/7D ni una comparación con baseline y regla de suficiencia contractual. El runtime deja `comparison=null` explícitamente; es una integración pendiente, no un diagnóstico comercial fuerte.
- Coste del producto: USD 5 con evidencia vigente al readback. Envío: USD 6.99 histórico, vencido desde 2026-09-09T05:03:34.880Z. El precio USD 22.98 volvió a estar vigente durante el canary mediante la fuente existente. Las comisiones eBay y otros costes están SOURCE_UNAVAILABLE; no se presume que sean cero. Beneficio y margen permanecen sin demostrar.
- La base total de cargo porcentual Ads todavía no tiene fuente integrada; el runtime no la sustituye por el precio. La simulación positiva queda certificada por contratos sintéticos, pendiente de un listing real con economía completa.
- Keyword V2.1 se consume sin fallback; la decisión preservada es NEEDS_EVIDENCE. No se utilizan keywords no demostradas.
- Se creó exactamente un receipt físico de simulación y se leyó de nuevo desde staging. La medición está implementada y devuelve INSUFFICIENT_EVIDENCE porque todavía no existe un periodo posterior comparable; no afirma una mejora comercial ni atribuye causalidad.

La documentación oficial Ads está en `assistant-revenue-engine-ads-contract-v1.md`. EBAY_ADS_OFFICIAL_CONTRACT_CERTIFIED=false y EBAY_ADS_WRITE_ENABLED=false. Esta investigación externa no impide construir Preview/simulación, pero no autoriza un canary de writes.

## Siguiente ejecución

Aportar/recuperar por los paths existentes las ventanas y baselines contractuales, shipping vigente, autoridad de fees y otros costes, y la base económica Ads. Después completar el canary positivo y los receipts. No repetir el upload o la generación de imagen ya certificados sin una regresión demostrada. No publicar listings ni escribir Ads.

## Validación y canary final

IMPLEMENTATION_SHA=`29d9ee6f59d9e0fc92dcf5bfa2fe4840c1aa6ae6`. Deployment READY `dpl_5KL6KckwUWmRdSVQTvg6MvaBnhmX`, proyecto dedicado imnova-seller-os-preprod. Suite completa: **376 PASS, 0 FAIL**. Typecheck, lint, build, audit Seller OS y seguridad dirigida: PASS. La validación está ligada al SHA limpio y al digest del build en el readback. No se cambió producción.

| Operación por la UI real | HTTP | Trace |
| --- | --- | --- |
| PREVIEW | 200 | f63bf560-9e9a-4ede-8038-67da2c9b82fb |
| SIMULATE | 200 | 9fc274f6-8fac-49b5-b97f-db5f0a467b15 |
| RECEIPT | 200 | c86bc7bf-be43-4410-a6c4-5ed14926db49 |
| MEASURE | 200 | a1e08f08-f1bd-4264-8fc7-5eac28aae41b |

ItemID `366643122092`; package `d28114ba-01d9-4134-90e4-927035e66255`; Preview visible y original conservado. Receipt `sha256:0594fb2dc52fd2036a488f30b00919c52a62de1f738c3a491a66e3d9ce2adfdd`, creado `2026-09-09T16:31:13.783551+00:00`, confirmado por lectura SQL exacta. Tratamiento TEST; promoción BLOCKED_EVIDENCE; todos los resultados de medición INSUFFICIENT_EVIDENCE. MARKETPLACE_WRITE_COUNT=0; EBAY_ADS_WRITE_COUNT=0; llamadas de imagen nuevas=0; uploads físicos repetidos=0.

La fuente Keyword respondió BLOCKED con KEYWORD_AUTHORITY_READ_UNAVAILABLE y sin decisión V2.1 verificable. Las validaciones no aceptaron versiones, identidad, digest, fingerprint o esquema ausentes; no hubo fallback. La protección del consumidor pasa, pero **KEYWORD_V2_1_CONSUMER_PASS=false** para el cierre positivo.

La entrada real `/admin` devolvió HTTP 200 y la capacidad revenueEngineAvailable=true. Una prueba aislada con rol de operadora simulado y viewport táctil 820×1180 mostró cuatro acciones, cero details abiertos y cero montajes del menú anterior; no falsifica una prueba de autenticación real de la operadora ni una prueba física en Safari. El canary de listing sí utilizó la sesión OWNER_ADMIN real y el backend real.

[Readback completo](assistant-revenue-engine-final-closeout-v1-readback.json) · [Canary físico](assistant-revenue-engine-physical-canary.png) · [Prueba visual de operadora con datos simulados](assistant-revenue-engine-operator-ipad-mock.png)

El operador confirmó desde esta conversación que, tras recargar la misma dirección, los cuatro botones ya aparecen en el iPad de Mayel: «si ya codex». Esta confirmación acredita la visibilidad del menú en el dispositivo real; no convierte la evidencia económica pendiente en válida.

## Manual para entregar a Mayel

[Manual en PDF](manual-mayel-menu-v1.pdf) · [Versión de texto](manual-mayel-menu-v1.md). Describe únicamente las acciones y permisos disponibles en su menú actual.

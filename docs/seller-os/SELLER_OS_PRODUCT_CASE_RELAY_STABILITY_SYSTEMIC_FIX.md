# Product Case relay stability — PASS

El Preview corregido pasa nueve canaries secuenciales del Golden: **9/9, cero HTTP 502 y cero timeouts MCP**. Cada respuesta conserva Product Truth **PARTIAL** y **25/25** campos materiales iguales. El relay conectado no fue alineado.

## Resultado

- Código desplegado: `c5d4ae2ae440f8ad8c0718500545031f684e7ceb`.
- Deployment: `dpl_rhnJUx3ucMRDL2rTEXoGS7PaVL6E`, Preview protegido del proyecto existente.
- Presupuesto interno: 18.000 ms; identidad crítica: 7.000 ms compartidos; cada lectura: hasta 4.000 ms. Reserva de proyección: 1.000 ms. Deadline MCP: 30.000 ms, sin cambios.
- P50: 1869 ms; P95/máximo: 3117 ms, método nearest-rank.
- Dependencia más lenta observada: PACKAGE / ebay_listing_packages, 875 ms.
- Catálogo: 28/28. Herramientas compartidas: 21/21 sin excepciones.
- Commercial Context: 3/3 dentro de 30 s, cero timeouts; máximo 6811 ms.
- Runtime conectado: HEALTHY, catálogo 28, workspace MATCHED; mismos PIDs, sin reinicios.
- `SAFE_TO_ALIGN_RELAY_NEXT=true`. La alineación sigue siendo una acción separada: no se ejecutó.
- E2E_CERTIFIED=false. No se avanzó Keyword Intelligence.

## Causa comprobada y límite de la atribución histórica

Product Case no invocaba eBay, Luna, Orders ni Mayel en vivo. Usaba nueve lecturas DB en el Golden. El resolver esperaba en serie queue, package y active listing; luego cualquier error de una proyección opcional terminaba en `assertRead`. El catch global del relay convertía esa excepción en 502. No había deadline global, cancelación de esas lecturas ni desactivación de retries del SDK.

Ésta es la ruta causal sistémica comprobada por inspección y regresión controlada; no se asumió que fuera el mismo problema de Commercial Context. Las dos mediciones basales sanas tardaron 2.704 y 2.183 ms, con nueve lecturas y cero llamadas externas por caso. Queue y Package transferían aproximadamente 465 KB y 638 KB respectivamente.

Durante un preflight diagnóstico separado, el Data API existente devolvió HTTP 521. El código y los diagnósticos nuevos distinguen HTTP/SQL/timeout sin volcar payloads. El trigger exacto de **cada** 502/timeout histórico sigue sin poder recuperarse de los logs anteriores saneados; no se atribuye ficticiamente a un índice, PostgreSQL o Vercel específico.

## Corrección

- Identidad y Product Truth son críticas; un fallo crítico devuelve una identidad explícitamente UNAVAILABLE, sin construir un caso ficticio.
- Package y active listing son enriquecimientos opcionales e independientes tras resolver el candidato.
- Research, Shipping, autorización, Publisher y economics fallan de forma aislada: UNAVAILABLE y failure code en sus campos/etapas/diagnósticos, preservando autoridades independientes.
- Las lecturas siguen filtradas por identidad/candidato/package/item y mantienen sus límites originales. No hay scan de portafolio, paginación nueva ni adquisición de evidencia.
- SUMMARY incluye los 25 campos Luna, igual que EVIDENCE y TRACE. El proyector durable de Product Truth no se modificó; FACT, CLAIM, MISSING y CONTRADICTED conservan su contrato.
- Errores de programación siguen propagándose y devuelven HTTP 500 con una clasificación segura; no se disfrazan de MISSING.
- La guía Supabase orientó el uso de [abortSignal](https://supabase.com/docs/reference/javascript/using-modifiers-abortsignal) y la desactivación por consulta de [retries automáticos](https://supabase.com/changelog/45071-automatic-postgrest-retries-for-transient-errors), sin cambios de auth, RLS o schema.

Las brechas conocidas Research/Shipping permanecen; no se fabricó evidencia para cerrarlas.

## Canary físico

Las solicitudes fueron secuenciales, con pausas de 20 s, usando el factory MCP y executor del relay existentes, con sólo un override de destino en memoria. No se creó servicio, listener, runtime persistente, catálogo ni authority. El comparador usa el receipt inmutable previo del endpoint corregido, no observaciones manuales. Los nueve hashes del conjunto de 25 campos coinciden.

| Run | Modo | Latencia ms | Product Truth | Paridad | HTTP 502 | MCP timeout |
| --- | --- | ---: | --- | --- | ---: | ---: |
| 1 | SUMMARY | 3117 | PARTIAL | 25/25 | 0 | 0 |
| 2 | EVIDENCE | 1873 | PARTIAL | 25/25 | 0 | 0 |
| 3 | TRACE | 1869 | PARTIAL | 25/25 | 0 | 0 |
| 4 | SUMMARY | 2706 | PARTIAL | 25/25 | 0 | 0 |
| 5 | EVIDENCE | 1817 | PARTIAL | 25/25 | 0 | 0 |
| 6 | TRACE | 1835 | PARTIAL | 25/25 | 0 | 0 |
| 7 | SUMMARY | 1910 | PARTIAL | 25/25 | 0 | 0 |
| 8 | EVIDENCE | 1803 | PARTIAL | 25/25 | 0 | 0 |
| 9 | TRACE | 1848 | PARTIAL | 25/25 | 0 | 0 |

Cada request inició nueve lecturas DB, cero llamadas externas y cero retries. No hubo errores opcionales en las nueve respuestas Product Case. El sweep compartido posterior también completó Product Case correctamente.

## Árbol de autoridades y budgets

```text
Identidad crítica / queue durable
├─ Product Truth y Luna/stock: reutilizan la misma evidencia
├─ Package ──────┐
├─ Active item ──┴─ proyecciones dependientes y opcionales acotadas
│                 ├─ autorización / Publisher
│                 ├─ research / shipping
│                 └─ pricing/economics si hay identidad item demostrada
└─ proyección del caso: no borra Luna por fallo opcional
```

Los tiempos siguientes son máximos observados de lectura, no sumas de ramas concurrentes. Cero significa **sin I/O adicional**, no medición de CPU igual a cero. Para Analytics/Orders/Mayel no se ejecutó lector: siguen UNPROVEN. Pricing/Economics no se consultó en este Golden porque no tenía item activo resuelto.

| DEPENDENCY | AUTHORITY | LATENCY_MS | DB_READ_COUNT | EXTERNAL_CALL_COUNT | RETRY_COUNT | TIMEOUT_BUDGET_MS |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| IDENTITY_RESOLUTION | ebay_luna_opportunity_queue | 716 | 1 | 0 | 0 | 4000 |
| LUNA_SOURCE | ebay_luna_opportunity_queue | 0 | 0 | 0 | 0 | 0 |
| PRODUCT_TRUTH | ebay_luna_opportunity_queue.assessment.productTruth | 0 | 0 | 0 | 0 | 0 |
| MARKET_RESEARCH_PROJECTION | marketplace_product_research_capture_observations | 579 | 1 | 0 | 0 | 4000 |
| SHIPPING_PROJECTION | seller_os_luna_shipping_job_claims | 297 | 1 | 0 | 0 | 4000 |
| PRICING_ECONOMICS | seller_os_live_economics_readbacks_v1 | 0 | 0 | 0 | 0 | 0 |
| PACKAGE | ebay_listing_packages | 875 | 1 | 0 | 0 | 4000 |
| AUTHORIZATION | ebay_draft_only_approvals | 578 | 1 | 0 | 0 | 4000 |
| PUBLISHER | ebay_draft_only_execution_ledger + ebay_authorized_listing_publications + seller_os_publisher_batch_children_v1 | 585 | 3 | 0 | 0 | 4000 |
| OFFICIAL_EBAY_READBACK | ebay_active_listings | 417 | 1 | 0 | 0 | 4000 |
| STOCK | ebay_luna_opportunity_queue | 0 | 0 | 0 | 0 | 0 |
| ANALYTICS | ebay_listing_performance_snapshots | 0 | 0 | 0 | 0 | 0 |
| ORDERS | marketplace_order_snapshots | 0 | 0 | 0 | 0 | 0 |
| MAYEL | ebay_mayel_visual_phase_b_executions_v1 | 0 | 0 | 0 | 0 | 0 |

No hubo fallos observados en estas lecturas Product Case. La matriz por request incluye STATUS, FAILURE_MODE, HTTP_STATUS y DATABASE_ERROR_CODE. La tabla basal y los tiempos originales están en el JSON.

## Regresión, seguridad y límites

Pasan las once regresiones exigidas, cuatro guardas adicionales, ocho suites enfocadas y TypeScript. Las pruebas incluyen timeout opcional real con abort, identidad crítica no disponible, deadline compartido, no retry/portfolio scan, preservación de fallback independiente, los tres modos con 25 campos, CONTRADICTED y excepciones de programación visibles.

La autenticación mantiene dos barreras: 401 sin protección o sin HMAC, y 400 para una operación firmada fuera de allowlist. No hubo cambios de credenciales, protección, configuración MCP/Tunnel ni migraciones. El hash del archivo de relay se mantuvo idéntico.

Commercial Context conservó su deadline y retornó limitaciones DB explícitas en la adquisición fría. **Compatibilidad de herramienta no significa disponibilidad total de sus fuentes**. No se presentaron esos errores como cero ni se ocultaron. Sus archivos de implementación no cambiaron en este commit.

La muestra finita demuestra estabilidad observada, no inmunidad a cualquier fallo futuro de red/plataforma. Las solicitudes fallidas anteriores siguen registradas como historia basal; no se borraron ni se incluyeron engañosamente entre los canaries posteriores exitosos.

[JSON completo con matriz de herramientas, diagnósticos y paridad de campos](./SELLER_OS_PRODUCT_CASE_RELAY_STABILITY_SYSTEMIC_FIX_RESULT.json).

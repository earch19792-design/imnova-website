# Auditoría de aprovechamiento eBay y automatización V1

Fecha de baseline: 2026-07-26  
Entorno auditado: IMNOVA Seller OS, `imnova-staging`, Preview  
Rama: `feature/centralize-ebay-mobile-center`  
Contrato: `EBAY_COMMUNICATION_UTILIZATION_V1`

## 1. Método y límites

Esta auditoría cuenta una capacidad como real solamente cuando existe un caller runtime, autenticación aplicable, normalización o persistencia y un consumidor identificable. Un diseño, fixture, preflight o dry-run se clasifica por separado.

La cobertura de capacidades usa esta ponderación:

| Estado | Peso |
| --- | ---: |
| `REAL_USED` | 1.00 |
| `REAL_PARTIAL` | 0.50 |
| `PREFLIGHT_ONLY` | 0.25 |
| `FIXTURE_OR_DRY_RUN` | 0.00 |
| `NOT_IMPLEMENTED` | 0.00 |

Baseline de capacidades conectadas: 13 capacidades `REAL_USED`, 3 `REAL_PARTIAL` y 1 `PREFLIGHT_ONLY`. El aprovechamiento ponderado es `(13 + 3×0.5 + 1×0.25) / 17 = 86.8%`.

Notifications/webhooks eBay no entra en el denominador de capacidades ya conectadas porque no está implementado ni autorizado de forma verificable. Se mantiene como gap explícito.

La utilización de información usa campos o señales importantes recibidos:

| Clasificación | Campos/señales baseline |
| --- | ---: |
| `COLLECTED_AND_USED` | 22 |
| `COLLECTED_BUT_UNUSED` | 5 |
| `USED_WITHOUT_PROVENANCE` | 2 |
| `STALE` | 1 |
| `DUPLICATED` | 1 |
| `MISSING` | 1 |

La información recibida y aprovechada con procedencia suficiente es `22 / 31 = 71.0%`. `MISSING` no se incluye en el denominador porque todavía no se recibe.

Estos porcentajes son una línea base versionada, no un objetivo comercial definitivo. El registro Admin y las vistas de observabilidad deben recalcularlos cuando cambie el contrato.

## 2. Matriz de comunicaciones eBay

| Comunicación o capacidad | Lectura/escritura | Scope requerido | Implementada realmente | Datos recibidos | Estado que los produce | Lugar donde se guardan | Estados que los consumen | Decisión que mejoran | Información desperdiciada | Riesgo o bloqueo | Acción recomendada |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| OAuth application token | Lectura | Client credentials de Buy/Commerce | `REAL_USED` | Token, expiración y resultado sanitizado | Investigación | Memoria y health audit, nunca token claro | Research, Taxonomy, Catalog, Browse | Permite fuentes oficiales | Metadatos de health dispersos | Drift entre lanes | Registro canónico de capacidades y health |
| OAuth seller refresh token | Lectura/escritura según consentimiento | Scopes seller por lane | `REAL_USED` | Resultado de refresh, scopes confirmados y fingerprint | Account/Orders/Publication/Fulfillment | Handoffs cifrados y estados de readiness | Account, Inventory, Orders, Analytics, writers | Cuenta correcta y permisos | URI exactos no siempre persistidos | Cinco lanes y callback multiplexado | Registro único de scopes y callback explícito |
| Browse search/item | Lectura | Buy Browse | `REAL_USED` | Listings activos, precio, shipping, condición, seller, categoría | `MARKET_RESEARCH` | Agregados, observations y hashes | Demand validation, comparability, listing intelligence | Oferta activa y comparables | Parte del payload por listing se descarta | `ACTIVE_ONLY` puede exagerarse | Mantener E1 y persistir sólo campos explicables |
| Marketplace Insights item sales | Lectura | Marketplace Insights autorizado | `PREFLIGHT_ONLY` | Capacidad/HTTP del endpoint; ventas sólo si una ingestión real las obtiene | Preflight | Resultado de preflight | Readiness | Detecta disponibilidad de fuente | No genera historial de evidencia | Confundir preflight con ventas | Ingestor separado y etiquetado; no inferir demanda |
| Buy Marketing best sellers | Lectura | Buy Marketing | `REAL_PARTIAL` | Productos agregados por categoría | Market research | Señal normalizada | Ranking inicial | Descubrimiento de categorías | No se enlaza uniformemente al dossier final | Sesgo agregado | Usar sólo como señal secundaria |
| Catalog | Lectura | Commerce Catalog | `REAL_USED` | GTIN, MPN, marca, producto y categoría sugerida | Identity verification | Facts, snapshots y resolución | Identity, category, listing | Identidad y categoría | Payload oficial no siempre enlazado a cada campo final | Procedencia incompleta | `evidence_used_by_field` con TTL/hash |
| Taxonomy | Lectura | Commerce Taxonomy | `REAL_USED` | Árbol, categoría sugerida y aspectos oficiales | Category/compliance | Cache y paquete normalizado | Category gate, item specifics | Categoría y aspectos correctos | Snapshot bruto no siempre ligado al listing | Cache sin frescura visible | Snapshot/hash + TTL por category tree |
| Account policies | Lectura | `sell.account.readonly` | `REAL_USED` | Programas, privilegios, shipping, payment, returns | Account readiness | `ebay_account_policy_profiles` | Final QA, payload, preflight | Políticas válidas | Duplicación de lecturas si sigue vigente | Drift de política | Reusar perfil fresco y revalidar antes del write |
| Inventory locations | Lectura/escritura controlada | `sell.inventory` o readonly aplicable | `REAL_USED` | Merchant locations y estado | Supply/listing readiness | Perfil de cuenta y handoff | Payload, preflight | Ubicación válida | Poca información comercial | POST real requiere gate | GET reutilizable; POST humano y one-shot |
| Inventory items y offers read | Lectura | `sell.inventory.readonly` | `REAL_PARTIAL` | SKU, inventory item, Offer ID y estado | Active listing sync/reconcile | Generaciones, active listings y mappings | Duplicate gate, monitor, reconcile | Evita duplicados y reconstruye estado | Sync completo depende de acción admin | Información puede quedar stale | Scheduler read-only con lease y backoff |
| Inventory Item y Offer draft | Escritura | `sell.inventory` | `REAL_USED`, gated | HTTP status, Offer ID, request y readback | `PUBLISHING` preparado | Approval, execution ledger, hashes | Reconcile, publication, audit | Draft exacto sin publicación | Ninguna necesaria | Efecto real y timeout | Mantener autorización, idempotencia y reconcile |
| Publish Offer | Escritura | `sell.inventory` | `REAL_USED`, gated | Item ID, Offer ID y estado activo | `PUBLISHING` | Publication ledger, active listing y monitor | Post-publish verification | Activa listing aprobado | Ninguna necesaria | Publicación accidental/duplicada | Kill switch, canario y reconciliación |
| Marketing campaigns/ads | Escritura | `sell.marketing` | `REAL_PARTIAL` | Campaign/ad IDs y estado | Commercial action | Improvement/action ledger | Promotion experiment | Promoción con headroom | Tasa 5% hardcodeada | Viola margen y retry incierto | `min(2%, headroom)`, E4 y reconcile |
| Analytics traffic report | Lectura | `sell.analytics.readonly` | `REAL_USED` | Impresiones, vistas, CTR, transacciones y conversión | Commercial monitoring | Traffic/snapshots | Discovery, conversion, experiments | Diagnóstico post-publicación | Aprendizaje no vuelve formalmente al ranking | Ventanas incompletas/stale | Features versionadas en shadow |
| Orders | Lectura | `sell.fulfillment.readonly` | `REAL_USED` | Orden, line item, estado y fulfillment | Commercial monitoring | Orders, lines y events sin buyer PII | Venta confirmada, fulfillment, margin | Confirma venta propia | Campos PII se descartan correctamente | Polling/latencia | Notification cuando exista; polling de reconcile |
| Shipping fulfillment | Lectura/escritura controlada | `sell.fulfillment` | `REAL_USED`, gated | Fulfillments, tracking y resultado | Fulfillment V1b | Tasks, attempts y reconciliation | Operational closeout | Entrega y cumplimiento | Ninguna necesaria | Escribir tracking erróneo | Flags triples, approval y readback |
| Trading GetUser/GetItem/GetMemberMessages | Lectura | Trading auth autorizado | `REAL_USED` | Seller identity, listing, WatchCount y headers de mensajes | Sync/monitor/manual import | Identity facts, active links, snapshots y hashes | Identity, watchers, support | Identidad exacta y señales operativas | Bodies/PII descartados deliberadamente | XML/legacy y polling | Retención mínima, hashes y backoff |
| Trading revise/end/images | Escritura controlada | Trading auth autorizado | `REAL_USED`, gated | Resultado revise/end/upload/readback | Commercial/manual action | Ledgers y snapshots | Reconcile y monitor | Correcciones autorizadas | Ninguna necesaria | Cambio irreversible o incierto | Una variable, approval, readback y rollback |
| Developer rate limits | Lectura | Developer Analytics | `REAL_USED` | Cuota y reset | Quota coordinator | Quota state | Claims/scheduling | Evita rate-limit | Algunas operaciones carecen de family | Coordinación incompleta | Registrar family/operation en toda llamada |
| Imports Seller Hub/Product Research | Lectura manual/importación | Export autorizado, no llamada runtime | `REAL_USED`, manual | Ventas/evidencia oficial importada | Research capture | Sold evidence, snapshots y reconciliation | Demand validation | Ventas confirmadas cuando el archivo lo prueba | Copiar/pegar y frescura manual | Archivo equivocado o stale | Schema, hash, window y dedupe automáticos |
| eBay Notifications/webhooks | Eventos | No demostrado | `NOT_IMPLEMENTED` | Ninguno | Ninguno | Ninguno | Ninguno | Reducir latencia y polling | Toda oportunidad está ausente | Scopes/subscriptions no validados | Contrato shadow, firma, dedupe y paridad |

## 3. Productor-consumidor del expediente

| Campo o señal | Fuente original | Estado que lo recopila | Estado que lo valida | Decisión que alimenta | Campo del listing afectado | Frescura requerida | Confianza mínima | Utilizado actualmente |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GTIN/UPC | Luna, Catalog, GetItem | Market research | Identity verified | Match exacto/duplicate gate | Product identifiers | 30 días si identidad no cambia | Alta, dos fuentes si conflicto | `COLLECTED_AND_USED` |
| MPN | Luna, Catalog, GetItem | Market research | Identity verified | Match y comparables | MPN/aspects | 30 días | Alta | `COLLECTED_AND_USED` |
| Marca/modelo | Luna, Catalog, GetItem | Market research | Identity verified | Identidad y keywords | Brand/title/aspects | 30 días | Alta | `COLLECTED_AND_USED` |
| Pack/variante/condición | Luna y listing oficial | Market research | Identity verified | Exclusión de comparables | Title/aspects/quantity | Revalidar ante drift | Alta | `COLLECTED_AND_USED` |
| Costo Luna | Proveedor | Supply verified | Economics gate | Piso y publicación | Price | TTL corto; recheck final | Exacta | `COLLECTED_AND_USED` |
| Stock Luna | Proveedor | Supply verified | Final preflight | Cantidad/reposición | Quantity | TTL corto; recheck final | Exacta | `COLLECTED_AND_USED` |
| Peso/dimensiones | Proveedor | Supply verified | Shipping/compliance | Envío y P&L | Package weight/dimensions | Hasta cambio material | Alta | `COLLECTED_AND_USED` |
| Derechos de imágenes | Proveedor/contrato | Supply verified | Visual QA | Uso de assets | Images | Hasta cambio de derecho | Alta | `COLLECTED_AND_USED` |
| Listings activos | Browse | Market research | Evidence classifier | Saturación, no demanda | Diferenciación | 24 h | E1 | `COLLECTED_AND_USED` |
| Ventas confirmadas | Orders/import oficial/Insights ingerido | Demand validation | Evidence resolver | Demanda, precio, timing | Price/quantity | Ventana completa | E3/E4 | `COLLECTED_AND_USED` |
| Watchers | Trading GetItem | Monitoring | Freshness/evidence classifier | Investigar confianza | Ninguno directo | 4 h | E2 | `COLLECTED_AND_USED` |
| Impresiones/vistas/CTR | Analytics | Monitoring | Ventana completa | Discovery/CTR diagnosis | Title/main image/aspects | 6 h, ventana completa | E2 | `COLLECTED_AND_USED` |
| Conversión | Analytics + orders | Monitoring | Window/completeness | Conversion diagnosis | Offer/price/shipping | 6 h, ventana completa | E3/E4 | `COLLECTED_AND_USED` |
| Precio visible | Browse/GetItem | Research/monitor | Comparable gate | Precio relativo | Price | 24 h | Según comparable | `COLLECTED_AND_USED` |
| Shipping obligatorio | Browse/GetItem | Research/monitor | Comparable gate | Landed price | Price/shipping | 24 h | Según comparable | `COLLECTED_AND_USED` |
| Landed price | Normalización | Demand/economics | Deterministic rule | Precio competitivo | Price | Hereda fuentes | Alta | `COLLECTED_AND_USED` |
| Comparable score | Facts + reglas | Demand validation | Threshold config | Incluir/excluir precio | Price | Hereda fuentes | >=85 para precio | `COLLECTED_AND_USED` |
| Category tree | Taxonomy | Category gate | Official response | Categoría | Category ID | TTL versionado | Alta | `COLLECTED_AND_USED` |
| Aspectos requeridos | Taxonomy | Category gate | Official response | Completeness | Item specifics | TTL versionado | Alta | `COLLECTED_AND_USED` |
| Políticas seller | Account API | Account readiness | Account profile | Preflight | Fulfillment/payment/returns | 24 h o drift | Alta | `COLLECTED_AND_USED` |
| Merchant location | Inventory API | Account readiness | Readback | Preflight | Location key | 24 h o drift | Alta | `COLLECTED_AND_USED` |
| Offer/Item/SKU | Inventory/Trading | Draft/reconcile | Readback | Idempotencia/publicación | SKU/Offer | Inmediata | Exacta | `COLLECTED_AND_USED` |
| Payload Taxonomy crudo | Taxonomy | Category gate | Normalizer | Auditoría | Category/aspects | TTL versionado | Alta | `USED_WITHOUT_PROVENANCE` |
| Payload Catalog crudo | Catalog | Identity | Normalizer | Auditoría | Identifiers/title | TTL versionado | Alta | `USED_WITHOUT_PROVENANCE` |
| Best-selling agregado | Buy Marketing | Market research | Evidence classifier | Ranking secundario | Ninguno directo | 24 h | Baja/media | `COLLECTED_BUT_UNUSED` |
| Seller reputation agregada | Browse/Trading | Research | Comparable gate | Confianza/comparable | Offer explanation | 24 h | Media | `COLLECTED_BUT_UNUSED` |
| Return/cancellation patterns | Orders/monitor | Monitoring | Window/completeness | Risk/selection feedback | Claims/quantity | 30 días | E5 para bloqueo | `COLLECTED_BUT_UNUSED` |
| Ganancia real | Orders + fees + fulfillment | Monitoring | Settlement/economics | Selección futura | Price/quantity | 30 días | E5 | `COLLECTED_BUT_UNUSED` |
| Mensajes por objeción | Trading headers/hash | Monitoring | Privacy-safe classifier | Description/FAQ | Description | 30 días | Agregado, sin PII | `COLLECTED_BUT_UNUSED` |
| Active listing raw payload | Inventory/Offer | Sync | Sanitizer | Reconcile/audit | Varios | 24 h | Alta | `DUPLICATED` |
| Active listing generation | Inventory/Offer | Admin sync | Generation commit | Duplicate gate | SKU/Offer | Sin scheduler dedicado | Alta | `STALE` |
| Notifications seller/order | eBay events | No existe | No existe | Fulfillment/monitor | Ninguno | Inmediata | Oficial | `MISSING` |

### Decisión por dato recopilado pero no utilizado

| Dato | Decisión |
| --- | --- |
| Best-selling agregado | Conservar como señal secundaria de categoría; nunca afirmar demanda |
| Seller reputation agregada | Incorporar al score de comparabilidad, no al score de ventas |
| Returns/cancellations | Bloquear escalamiento y retroalimentar selección en shadow |
| Ganancia real | Comparar contra ganancia prevista y calibrar ranking en shadow |
| Mensajes por objeción | Clasificación agregada y privada para descripción/FAQ; no guardar bodies |

## 4. Dimensiones comerciales separadas

El expediente debe producir componentes explicables, no un score opaco:

| Dimensión | Evidencia principal | Uso seguro |
| --- | --- | --- |
| Potencial de demanda | Ventas confirmadas, ventanas completas | Ranking y timing |
| Calidad de evidencia | Clase E0–E5, completitud y frescura | Guardas y confidence |
| Saturación | Listings/vendedores activos | Oferta, no demanda |
| Match exacto | GTIN/MPN/pack/variante/condición | Comparables y duplicate gate |
| Proveedor | Stock, costo, drift y estabilidad | Elegibilidad, cantidad y floor |
| Rentabilidad | Contribución, margen, ROI y floor | Precio/promoción |
| Listing readiness | Categoría, aspectos, políticas y payload | Draft readiness |
| Cumplimiento | Marca, claims, restricciones y derechos | HOLD/rechazo |
| Calidad visual | Fidelidad, hashes, QA y transport | Visual readiness |
| Diferenciación | Patrones agregados y oferta propia | Title/description/images |
| Urgencia | Stock, ventas, freshness y SLA | Prioridad |
| Post-publicación | Traffic, orders, returns y ganancia real | Aprendizaje shadow |

Reglas invariantes:

- `ACTIVE_ONLY` nunca demuestra venta ni autoriza reducción de precio.
- E1/E2 no autorizan promoción ni precio.
- Precio y promoción requieren E4, costos completos y todos los pisos.
- Comparables deben coincidir en pack, tamaño, variante, condición, modelo y marketplace.
- El landed price incluye shipping obligatorio.
- Los patrones agregados pueden orientar; el contenido de competidores no se copia.

## 5. Ciclo cerrado

| Señal post-publicación | Destino shadow | Decisión futura permitida |
| --- | --- | --- |
| Impresiones | Ranking/category readiness | Investigar descubrimiento |
| CTR | Keywords/title/main image | Proponer una variable |
| Vistas | Listing readiness | Diagnosticar oferta |
| Watchers | Confianza/landed price | Investigar, no afirmar demanda |
| Venta confirmada | Demand potential/velocity | Ranking, stock y economics |
| Conversión | Price/offer/content diagnosis | Experimento protegido |
| Devolución | Supplier/compliance risk | Bloquear escalamiento |
| Cancelación | Stock/operation risk | Penalizar readiness |
| Ganancia real | Economics calibration | Ajustar escenarios futuros |
| Cambio competitivo | Saturation/comparability | Revalidar, no copiar |

Toda feature aprendida debe declarar `feature_version`, ventana, fuente, confidence, baseline, resultado y estado `SHADOW_MODE`. Ningún aprendizaje puede editar reglas o listings en producción automáticamente.

## 6. Matriz de procesos manuales

Los tiempos son baseline operativos provisionales para priorización; las vistas deben sustituir estimaciones con datos observados.

| Proceso manual | Estado | Frecuencia | Tiempo consumido | Motivo actual | Datos disponibles | Regla repetible | Riesgo | Nivel de confianza | Automatización recomendada | Humano requerido |
| --- | --- | ---: | ---: | --- | --- | --- | --- | --- | --- | --- |
| Selección Top 5 | Market research | Diario | 10 min | Priorizar oportunidades | Radar, facts, economics | Sí | Medio | Media | `AUTOMATABLE_WITH_POLICY`, shadow primero | Excepciones |
| Candidato de reserva | Queue | Por hold | 2 min | Mantener cinco slots | Ranking y freshness | Sí | Bajo | Alta | `FULLY_AUTOMATABLE` | No |
| Confirmar identidad exacta | Identity | Por producto | 5 min | Ambigüedad | GTIN/MPN/facts | Parcial | Alto | Variable | `HUMAN_EXCEPTION_ONLY` | Sólo conflicto |
| Copiar/pegar evidencia | Research capture | Por producto | 8 min | Fuente manual | Import/capture | Sí | Medio | Media | `AI_ASSISTED_WITH_VALIDATION` | Validación |
| Buscar vendedores | Research | Por producto | 5 min | Competencia | Browse | Sí | Bajo | Alta | `FULLY_AUTOMATABLE` | No |
| Buscar comparables | Demand | Por producto | 10 min | Match | Browse/facts | Sí | Medio | Alta | `AI_ASSISTED_WITH_VALIDATION` | Sólo contradicción |
| Clasificar ventas/ACTIVE_ONLY | Demand | Por señal | 2 min | Evitar inferencia | Evidence class | Sí | Bajo | Alta | `FULLY_AUTOMATABLE` | No |
| Consultar stock | Supply | Varias veces | 2 min | Freshness | Luna | Sí | Bajo | Alta | `FULLY_AUTOMATABLE` con recheck | No |
| Revisar costo | Economics | Varias veces | 2 min | Floor | Luna/costs | Sí | Bajo | Alta | `FULLY_AUTOMATABLE` con recheck | No |
| Calcular economics | Economics | Por escenario | 5 min | Margen/ROI | Costos/fees | Sí | Bajo | Alta | `FULLY_AUTOMATABLE` | No |
| Elegir categoría | Category | Por producto | 5 min | Taxonomy | Official suggestions | Parcial | Medio | Alta | `AI_ASSISTED_WITH_VALIDATION` | Si ambigua |
| Completar aspectos | Category | Por producto | 8 min | Required fields | Taxonomy/facts | Parcial | Medio | Alta | `AI_ASSISTED_WITH_VALIDATION` | Sólo faltantes |
| Elegir keywords | Listing intelligence | Por producto | 10 min | Relevancia | Research/patterns | Parcial | Medio | Media | `AI_ASSISTED_WITH_VALIDATION` | Claims/conflictos |
| Crear título | Listing | Por producto | 8 min | Conversión/verdad | Facts/keywords | Parcial | Medio | Media | `AI_ASSISTED_WITH_VALIDATION` | Excepción |
| Crear descripción | Listing | Por producto | 12 min | Objeciones | Facts/patterns | Parcial | Medio | Media | `AI_ASSISTED_WITH_VALIDATION` | Claims delicados |
| Diseñar estrategia visual | Visual | Por producto | 10 min | Diferenciación | Assets/facts | Parcial | Medio | Media | `AI_ASSISTED_WITH_VALIDATION` | QA |
| Generar imágenes | Visual | Por producto | 20 min | Paquete 1+6 | References/prompts | Parcial | Alto | Media | `AI_ASSISTED_WITH_VALIDATION` | Fidelidad |
| Revisar imágenes | Visual QA | Siete assets | 10 min | Identidad/IP | Hashes/QA | Parcial | Alto | Variable | `HUMAN_EXCEPTION_ONLY` | Ambigüedad |
| Construir payload | Draft ready | Por producto | 3 min | Inventory schema | Dossier completo | Sí | Bajo | Alta | `FULLY_AUTOMATABLE` | No |
| Ejecutar preflight | Final QA | Por producto | 3 min | Guardas | Payload/account/quota | Sí | Bajo | Alta | `FULLY_AUTOMATABLE` | No |
| Autorizar primer canario | Approved to publish | Por canario | 5 min | Efecto real inicial | Preview/hash/gates | No | Alto | Alta | `MUST_REMAIN_HUMAN` | Sí |
| Crear draft/Offer | Publishing | Por producto | 2 min | Efecto externo | Approval/outbox | Sí | Alto | Alta | `AUTOMATABLE_WITH_POLICY` | Canarios iniciales |
| Publicar | Publishing | Por producto | 2 min | Activación pública | Approval/hash | Sí | Alto | Alta | `AUTOMATABLE_WITH_POLICY` | Canarios iniciales |
| Conciliar timeout | Reconcile | Por incidente | 10 min | Resultado incierto | SKU/Offer/readback | Sí | Alto | Alta | `HUMAN_EXCEPTION_ONLY` | Sólo ambiguo |
| Clasificar error conocido | Error handler | Por fallo | 3 min | Retry/hold | Taxonomy/fingerprint | Sí | Bajo | Alta | `FULLY_AUTOMATABLE` | No |
| Clasificar error desconocido | Quarantine | Por fallo | 15 min | Riesgo | Sanitized fingerprint | Parcial | Alto | Baja | `HUMAN_EXCEPTION_ONLY` | Sí |
| Replay cuarentena | Recovery | Por caso | 5 min | Reanudar | Checkpoint/playbook | Sí | Medio | Alta | `AUTOMATABLE_WITH_POLICY` | Excepción |
| Monitorear listing | Monitoring | Cada 5 min | 0 manual recurrente | Señales oficiales | Analytics/orders/Trading | Sí | Bajo | Alta | `FULLY_AUTOMATABLE` | No |
| Revisar mejora comercial | Decision | Diario | 5 min | Margen/riesgo | Evidence/economics | Parcial | Medio | Media | `AI_ASSISTED_WITH_VALIDATION` | Autoriza acción |
| Preparar digest | Digest | Diario | 5 min | Consolidación | Decisions/outbox | Sí | Bajo | Alta | `FULLY_AUTOMATABLE` | No |

## 7. Baseline de automatización

| Métrica | Baseline |
| --- | ---: |
| Same-Day runs observados | 10 |
| Candidatos legacy | 50 |
| Candidatos por run | 5 |
| Jobs | 376 |
| Eventos | 219 |
| Tareas humanas | 195 |
| Tareas humanas brutas por candidato | 3.9 |
| Handoffs | 59 |
| Factory runs materializados | 0 |
| Dossiers factory | 0 |
| Effect outbox factory | 0 |
| Cuarentenas factory | 0 |

La comparación posterior debe usar:

- `ebay_listing_factory_intervention_baseline_v1`.
- `ebay_listing_factory_dossier_utilization_v1`.
- `ebay_listing_factory_shadow_bridge_coverage_v1`.

Una corrida de cinco debe reportar `human_task_count`, `estimated_human_seconds`, `automation_ratio`, `fields_used_count`, `fields_missing_count`, `reader_call_avoided`, `retry_avoided` y `duplicate_effect_prevented`.

## 8. Prioridad de automatización

| Prioridad | Cambio | Modo inicial | Riesgo |
| ---: | --- | --- | --- |
| 1 | Registro canónico de capacidades/scopes/frescura | Observabilidad | Bajo |
| 2 | Baseline de intervención y dossier | View/read-only | Bajo |
| 3 | Bridge legacy→factory | `SHADOW_MODE`, cero effects | Bajo/medio |
| 4 | Bloqueo promoción 5% y headroom | Guard determinista | Bajo |
| 5 | Reuso de evidencia vigente | Shadow por source type | Medio |
| 6 | Active listing sync programado | Read-only + lease | Medio |
| 7 | Aprendizaje post-publicación → ranking | `SHADOW_MODE` | Medio |
| 8 | Notifications eBay | Shadow + paridad | Medio |
| 9 | Publicación por política | Canarios y aprobación separada | Alto |

## 9. Guardas

- Production permanece sin cambios.
- Writes eBay permanecen deshabilitados hasta autorización de canario.
- El bridge shadow exige `DRY_RUN`, kill switch activo, publicación automática false y cero effects.
- Cualquier promoción exige E4, costos completos, stock seguro y `min(2%, headroom)`.
- Un timeout ambiguo queda `UNKNOWN_OUTCOME`; nunca reenvío ciego.
- Tokens, buyer PII, teléfonos y payloads sensibles no se exponen en métricas.
- Notification API no se marca disponible hasta verificar scopes, subscription, firma y tráfico real.
- El scheduler owner debe permanecer único; los YAML no se activan mientras `supabase_pg_cron` sea dueño.

## 10. Respuestas obligatorias

1. Capacidades eBay conectadas aprovechadas: `86.8%` ponderado.
2. Información recibida aprovechada con procedencia suficiente: `71.0%`.
3. Datos sin decisión: best-selling agregado, reputation agregada, return/cancellation learning, ganancia real y mensajes por objeción.
4. Product Opportunity Score: ventas confirmadas, velocidad, returns/cancellations, ganancia real, supplier stability y evidence freshness.
5. Listing: Taxonomy, Catalog, objeciones agregadas, traffic por listing y provenance por campo.
6. Precio/promoción/cantidad/timing: landed price, ventas E4, headroom, stock coverage, conversion y operational risk.
7. Selecciones futuras: contribución real, returns, conversion, category performance y supplier drift.
8. Solicitudes repetidas: Account policies, Taxonomy/Catalog y facts canónicos cuando siguen vigentes.
9. Cache/reuso: source snapshots, observations, resolutions y run evidence links; no crear otra cache.
10. Manuales sustituibles: seller/comparables, stock/costo, category/aspects, payload, preflight, error conocido, digest y reconcile inequívoco.


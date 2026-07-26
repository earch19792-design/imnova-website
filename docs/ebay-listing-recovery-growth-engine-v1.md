# eBay Listing Recovery & Growth Engine V1

## 1. Propósito y alcance

Este documento define el contrato operativo, técnico y de seguridad del motor
`EBAY_LISTING_RECOVERY_AND_GROWTH_ENGINE_V1`.

El motor observa listings ya publicados, diagnostica su embudo comercial,
propone un solo experimento a la vez y aprende únicamente de resultados
confirmados. No vuelve a enviar el producto al pipeline de análisis, sourcing,
creación o publicación.

La identidad durable del caso es:

```text
marketplace_account_key + marketplace + listing_id
```

Por lo tanto, un listing publicado y bajo monitoreo permanece en el dominio
post-publicación. Una nueva observación actualiza su caso de recuperación y
agrega evidencia inmutable; no crea otro producto ni otra publicación.

V1 opera exclusivamente en staging/Preview y en `shadow_mode`. Sus invariantes
son:

- Escrituras automáticas en eBay: `0`.
- Cambios automáticos de precio: `0`.
- Promociones automáticas: `0`.
- Ofertas automáticas a compradores: `0`.
- Mensajes WhatsApp originados por este motor: `0`.
- Llamadas OpenAI originadas por este motor: `0`.
- Copia de contenido creativo de competidores: `0`.
- Uso de `ACTIVE_ONLY` como prueba de venta: `0`.
- Reintentos ciegos después de un resultado ambiguo: `0`.

La configuración persiste `external_writes_enabled=false` y contiene una
restricción que impide activarla. Los diagnósticos persistidos también deben
declarar `safety.ebayWrites=0` y `safety.externalEffects=0`.

## 2. Componentes canónicos reutilizados

El motor no introduce un sistema comercial paralelo. Reutiliza:

| Responsabilidad | Componente canónico |
|---|---|
| Snapshots orgánicos | `listing_commercial_snapshots` |
| Órdenes y ventas confirmadas | `marketplace_order_snapshots` y `marketplace_order_line_items` |
| Configuración comercial general | `commercial_threshold_configs` |
| Diagnóstico post-publicación | `post-publication-optimization-domain.ts` |
| Economía unitaria y pisos | `ebay-unit-economics.ts` |
| Comparables y landed price | `ebay-market-pricing-strategy.ts` |
| Eventos comerciales | `commercial_alert_events` |
| Acciones de precio/promoción | `ebay_commercial_improvement_executions` |
| Revisión de título | Ledger existente de title revision |
| Revisión de imágenes | Ledger existente de image revision |
| Expediente y source pack | Bindings append-only por dossier y hashes |
| Persistencia/reapertura de riesgo | Active risk events de Seller Command Center |

Las estructuras nuevas sólo conservan estado específico de recuperación,
experimentos, medición y aprendizaje.

## 3. Auditoría de APIs y scopes

### 3.1 Límite de la auditoría

La auditoría confirma endpoints, allowlists y scopes declarados en el código.
No inspecciona ni imprime refresh tokens, access tokens ni secretos. Un scope
declarado en código no equivale a un scope confirmado en el grant vigente.

Antes de habilitar un reader nuevo en staging se debe confirmar, sin exponer el
token:

1. Cuenta e identidad oficial esperadas.
2. Scope efectivo del access token.
3. Endpoint exacto permitido.
4. Marketplace esperado.
5. Frescura, ventana y semántica del dato.
6. Ausencia de buyer PII en la persistencia.

### 3.2 Matriz real

| Fuente | Endpoint o llamada | Scope declarado | Estado real en V1 | Uso permitido |
|---|---|---|---|---|
| OAuth | `POST /identity/v1/oauth2/token` | Scopes seller solicitados por lane | Integrado en gateways existentes | Obtener token en memoria; nunca persistirlo ni imprimirlo |
| Trading API | `GetItem` | `api_scope` | Reader existente | Verificar item, estado y señales como watchers; watchers no son ventas |
| Inventory API | `GET /sell/inventory/v1/inventory_item` | `sell.inventory.readonly` | Reader existente | Verificar SKU, inventario e identidad |
| Inventory API | `GET /sell/inventory/v1/offer` | `sell.inventory.readonly` | Reader existente | Verificar offer, listing ID, estado, marketplace y precio |
| Fulfillment API | `GET /sell/fulfillment/v1/order` | `sell.fulfillment.readonly` | Reader existente | Órdenes con checkout completado y venta propia confirmada |
| Fulfillment API | `GET /sell/fulfillment/v1/order/{orderId}` | `sell.fulfillment.readonly` | Guard reader existente | Revalidación oficial de una orden y sus líneas |
| Analytics API | `GET /sell/analytics/v1/traffic_report` | `sell.analytics.readonly` | Reader existente | Impresiones, vistas, CTR, transacciones reportadas y conversión |
| Browse API | `GET /buy/browse/v1/item_summary/search` | Application token con `api_scope` | Runner read-only existente | Oferta activa y comparables; nunca prueba ventas completadas |
| Marketing API | Report task y ad report | El esquema admite `sell.marketing.readonly` o `sell.marketing` | No conectado al runtime de recuperación | Snapshot pagado sólo después de verificar scope y reconciliación |
| Negotiation API | `GET /sell/negotiation/v1/find_eligible_items` | Por confirmar contra Application Keys | No implementado | Elegibilidad por listing, nunca buyer PII |
| Negotiation API | `POST /sell/negotiation/v1/send_offer_to_interested_buyers` | Scope seller correspondiente | Bloqueado y no implementado | Ningún envío en V1 |
| Writers de listing | Trading/Inventory/Marketing existentes | Write scopes aislados | No llamados por el motor shadow | Sólo futura delegación a ledger existente con autorización humana |

### 3.3 Hallazgos de scopes

`sell.analytics.readonly`, `sell.fulfillment.readonly` y
`sell.inventory.readonly` tienen consumidores read-only concretos en el
repositorio.

La estructura de snapshots pagados admite `sell.marketing.readonly` y
`sell.marketing`. Sin embargo, la documentación oficial consultada para
`ad_report_task` exige `sell.marketing`. V1 no debe afirmar que
`sell.marketing.readonly` funciona para esos reportes hasta verificarlo con la
aplicación y el grant reales.

Crear un `ad_report_task` es una llamada `POST` al proveedor, aunque no modifica
un listing ni una campaña. V1 no la realiza. Si se incorpora posteriormente,
debe tener idempotencia, cuota, polling acotado y conciliación de hasta 72 horas.

Negotiation permanece no implementado. Además, eBay documenta que la
Negotiation API no soporta actualmente listings administrados con Inventory
API. La elegibilidad de una oferta no se debe asumir para listings de ese
origen.

Browse devuelve listings activos. No aporta por sí solo ventas completadas,
demanda ni velocidad. Toda fila Browse se conserva como `ACTIVE_ONLY` o
evidencia E1, salvo que exista otra fuente oficial independiente.

### 3.4 Referencias oficiales de eBay

- [OAuth authorization code grant](https://developer.ebay.com/api-docs/static/oauth-authorization-code-grant.html)
- [OAuth client credentials grant](https://developer.ebay.com/api-docs/static/oauth-client-credentials-grant.html)
- [OAuth scopes](https://developer.ebay.com/api-docs/static/oauth-scopes.html)
- [Analytics API overview](https://developer.ebay.com/api-docs/sell/analytics/overview.html)
- [Analytics getTrafficReport](https://developer.ebay.com/api-docs/sell/analytics/resources/traffic_report/methods/getTrafficReport)
- [Fulfillment API](https://developer.ebay.com/develop/api/sell/fulfillment_api)
- [Fulfillment getOrders](https://developer.ebay.com/api-docs/sell/fulfillment/resources/order/methods/getOrders)
- [Fulfillment getOrder](https://developer.ebay.com/api-docs/sell/fulfillment/resources/order/methods/getOrder)
- [Inventory API overview](https://developer.ebay.com/api-docs/sell/inventory/static/overview.html)
- [Managing inventory items](https://developer.ebay.com/api-docs/sell/static/inventory/managing-inventory-items.html)
- [Inventory getInventoryItems](https://developer.ebay.com/api-docs/sell/inventory/resources/inventory_item/methods/getInventoryItems)
- [Inventory getOffers](https://developer.ebay.com/api-docs/sell/inventory/resources/offer/methods/getOffers)
- [Trading GetItem](https://developer.ebay.com/devzone/xml/docs/reference/ebay/GetItem.html)
- [Browse search](https://developer.ebay.com/api-docs/buy/browse/resources/item_summary/methods/search)
- [Marketing API overview](https://developer.ebay.com/api-docs/sell/marketing/static/overview.html)
- [Marketing createReportTask](https://developer.ebay.com/api-docs/sell/marketing/resources/ad_report_task/methods/createReportTask)
- [Marketing getReportTask](https://developer.ebay.com/api-docs/sell/marketing/resources/ad_report_task/methods/getReportTask)
- [Offers to interested buyers](https://developer.ebay.com/api-docs/sell/static/marketing/offers-to-buyers.html)
- [Negotiation EligibleItem](https://developer.ebay.com/api-docs/sell/negotiation/types/api%3AEligibleItem)

## 4. Flujo anterior

```text
schedulers existentes
→ readers oficiales
→ listing_commercial_snapshots
→ reglas comerciales
→ commercial_alert_events
→ decisión/recomendación embebida en evidencia
→ outbox y notificación
→ acción comercial opcional mediante ledger existente
```

Limitaciones anteriores para recuperación:

- No existía un caso durable de recuperación por listing.
- El experimento era una propuesta embebida, no un ciclo medible completo.
- No existía historial explícito de transiciones de recuperación.
- Orgánico no tenía todos los campos de desglose del Traffic Report.
- Tráfico pagado no tenía un snapshot separado y reconciliable por listing.
- No existía un `Competitive Gap` durable con prohibición verificable de copia.
- El ledger comercial no tenía vínculo al experimento, claim token, lease ni
  campos explícitos de reconciliación y rollback.
- Una recomendación ganadora no tenía un evento de aprendizaje con gate de
  venta y contribución confirmadas.

## 5. Flujo nuevo

```text
monitor comercial existente
→ snapshots oficiales y reconciliados
→ selección del snapshot más reciente por listing
→ claim de shadow run por cuenta + marketplace
→ verificación post-publicación
→ baseline de cohorte o baseline conservador
→ diagnóstico del embudo
→ Competitive Gap
→ caso durable + transición + diagnóstico append-only
→ propuesta de experimento de una variable
→ revisión humana
→ ejecución manual o delegación a ledger existente
→ snapshot before
→ cooldown y ventana de medición
→ snapshot after
→ evaluación WON / NEUTRAL / LOST / INCONCLUSIVE
→ reconciliación oficial
→ aprendizaje reutilizable sólo con venta rentable confirmada
```

El runtime shadow actual empieza en snapshots ya persistidos. No llama eBay,
OpenAI, WhatsApp ni writers. Esto desacopla diagnóstico de adquisición y evita
que una indisponibilidad externa convierta una inferencia en acción.

## 6. Verificación post-publicación

Antes de analizar rendimiento deben comprobarse:

| Verificación | Evidencia esperada | Si falla |
|---|---|---|
| Listing activo | Inventory offer o Trading `GetItem` oficial | `LISTING_TECHNICAL_PROBLEM` |
| Inventory item | SKU exacto y readback oficial | Bloquear optimización |
| Offer | Offer ID, marketplace y listing ID exactos | Bloquear optimización |
| Item ID | Identidad oficial y estable | Bloquear optimización |
| Categoría | Categoría válida para el producto | Nivel 1 técnico |
| Required aspects | Completitud verificada | Nivel 3 antes de keywords |
| Políticas | Payment, fulfillment y return resueltas | Bloquear acciones comerciales |
| Stock | Cantidad positiva y fresca | Bloquear promoción y precio |
| Indexación | Códigos explícitos, nunca inferidos | Resolver antes de escalar |
| Dossier | Hechos, derechos y hashes vigentes | No preparar contenido |

Una falla técnica domina el diagnóstico. No se reduce precio, no se promociona
y no se cambia contenido para encubrir un problema de publicación.

## 7. Estados del caso de recuperación

| Estado | Significado |
|---|---|
| `POST_PUBLISH_VERIFICATION` | Confirmar que la publicación existe, corresponde al SKU y es operable |
| `OBSERVATION_WINDOW` | Recopilar una ventana estable sin intervenir |
| `PERFORMANCE_BASELINE_READY` | Baseline aplicable seleccionado y versionado |
| `PERFORMANCE_DIAGNOSIS` | Clasificar el cuello del embudo |
| `ACTION_PROPOSED` | Existe una recomendación, todavía no una autorización |
| `EXPERIMENT_PREPARED` | Hipótesis, variable, KPI, guardrails y rollback completos |
| `EXPERIMENT_ACTIVE` | Una ejecución humana fue confirmada y empezó la medición |
| `COOLDOWN` | Bloquear cambios adicionales durante siete días por defecto |
| `EXPERIMENT_EVALUATION` | Comparar snapshots before/after reconciliados |
| `PERFORMANCE_RECOVERED` | Venta propia rentable y guardrails protegidos |
| `CONTINUE_MONITORING` | No existe una intervención ventajosa demostrada |
| `NEXT_OPTIMIZATION_LEVEL` | El experimento fue neutral y puede evaluarse el siguiente nivel |
| `WAITING_FOR_SUFFICIENT_SAMPLE` | Evidencia incompleta, vencida, no reconciliada o insuficiente |
| `ROLLBACK_REQUIRED` | Se violó un guardrail o el KPI cayó materialmente |
| `PRICE_TEST_ELIGIBLE` | Un precio limitado sería seguro; no significa autorizado |
| `PAUSE_OR_RETIRE_RECOMMENDED` | Se agotó el presupuesto de pruebas o no existe precio rentable |
| `QUARANTINED_OPTIMIZATION_ERROR` | El listing se aísla sin detener los demás |

Las transiciones se registran de forma append-only con estado anterior, estado
nuevo, causa, hash de evidencia, hash de salida y actor.

## 8. Estados complementarios

### 8.1 Runs

`RUNNING`, `COMPLETED`, `COMPLETED_WITH_QUARANTINE`, `PARTIAL_SUCCESS`,
`FAILED` y `CANCELLED`.

Sólo puede existir un run `RUNNING` por cuenta y marketplace. El lease
predeterminado es de 240 segundos, acotado entre 60 y 900 segundos.

### 8.2 Experimentos

`PROPOSED`, `APPROVED`, `REJECTED`, `EXECUTED_MANUALLY`, `MEASURING`, `WON`,
`NEUTRAL`, `LOST`, `INCONCLUSIVE`, `RESOLVED` y `CANCELLED`.

Una notificación nunca cambia estos estados. La aprobación tampoco ejecuta el
cambio. `EXECUTED_MANUALLY` requiere confirmación humana separada.

### 8.3 Ledger comercial

`preview_ready`, `write_in_flight`, `write_acknowledged`,
`applied_verified`, `outcome_unknown` y `terminal_failure`.

`provider accepted` o un HTTP exitoso no equivalen a `applied_verified`. El
estado final exige readback oficial.

## 9. Snapshots orgánicos y pagados

### 9.1 Orgánico

El snapshot orgánico sigue siendo `listing_commercial_snapshots`. V1 lo amplía
con:

- Search impressions.
- Store impressions.
- Search views.
- Direct views.
- External views.
- Other eBay views.
- Store views.
- `analytics_last_updated_at`.
- `analytics_timezone`.
- `analytics_reconciliation_status`.
- `analytics_scope`.

La fuente exclusiva es `EBAY_SELL_ANALYTICS_TRAFFIC_REPORT`. La ventana, zona
horaria, frescura, completitud y estado de reconciliación forman parte de la
evidencia. Por defecto, un snapshot orgánico tiene una frescura máxima de 48
horas.

`transactions` y `sales_conversion_rate` son métricas del Traffic Report. No
sustituyen órdenes con checkout completado y no se convierten por inferencia en
ventas confirmadas.

### 9.2 Pagado

El tráfico pagado se conserva en `ebay_listing_marketing_snapshots`, separado
del orgánico:

- Funding model `COST_PER_SALE` o `COST_PER_CLICK`.
- Campaign y ad group.
- Impresiones y clicks pagados.
- CTR pagado.
- Ventas atribuidas.
- Conversion rate atribuido.
- Ad fees.
- Cost per click.
- ROAS.
- Ventana y última actualización.
- Completitud y reconciliación.

No se suman impresiones orgánicas y pagadas. No se compara una ventana orgánica
con una ventana pagada sin alineación temporal. El ajuste pagado puede tardar
hasta 72 horas; mientras esté `PENDING` o `UNKNOWN` no dispara acciones.

CPC nunca se activa, incrementa ni automatiza. Si una campaña CPC activa consume
presupuesto sin ventas atribuidas, la única recomendación permitida en V1 es
preparar una pausa para revisión humana.

### 9.3 Ventas

Una venta propia confirmada proviene de Fulfillment orders con checkout
completado y líneas exactas del listing/SKU. Watchers, clicks, transacciones
Analytics, ventas atribuidas pendientes y listings desaparecidos no reemplazan
esa fuente.

## 10. Baseline

El baseline preferido es una cohorte de la propia cuenta:

```text
marketplace
+ categoría
+ condición
+ price band
+ listing age band
+ product type
+ pack
+ organic/promoted
```

La cohorte exige inicialmente diez listings. Si no existe muestra suficiente se
usa `PROVISIONAL_CONSERVATIVE`, claramente identificado y versionado.

Valores provisionales iniciales:

| Política | Valor |
|---|---:|
| Observación mínima | 168 horas |
| Frescura orgánica | 48 horas |
| Reconciliación pagada | 72 horas |
| Impresiones mínimas | 100 |
| Vistas mínimas | 30 |
| CTR provisional | 1% |
| Conversión provisional | 1% |
| Confianza mínima | 0.80 |
| Cooldown | 168 horas |
| Máximo de experimentos | 6 |

Estos valores son configuración provisional, no targets comerciales
definitivos. Deben calibrarse con al menos 30 días de baseline por cohorte.

## 11. Árbol diagnóstico

El orden es vinculante:

```text
1. ¿Evidencia incompleta, vencida, no reconciliada o confianza < 0.80?
   → WAITING_FOR_SUFFICIENT_SAMPLE
   → EVIDENCE_REVALIDATION

2. ¿Listing con menos de 168 horas observables?
   → WAITING_FOR_SUFFICIENT_SAMPLE
   → ningún cambio

3. ¿Falla identidad, offer, item, stock, categoría, políticas o indexación?
   → LISTING_TECHNICAL_PROBLEM
   → TECHNICAL_VERIFICATION

4. ¿Hay experimento activo o cooldown?
   → COOLDOWN
   → no mezclar variables

5. ¿Se alcanzaron seis experimentos sin recuperación?
   → PAUSE_OR_RETIRE_RECOMMENDED

6. ¿Hay venta propia confirmada y rentable?
   → PERFORMANCE_RECOVERED
   → volver a monitoreo

7. ¿Promoción activa con ad fees y cero ventas atribuidas?
   → PROMOTED_NO_RESULT
   → proponer pausa, nunca aumentar CPC

8. ¿Impresiones por debajo del baseline?
   → completar categoría/aspects o discovery/keywords
   → CPS sólo después de niveles orgánicos y economía E4+

9. ¿Impresiones suficientes pero vistas/CTR bajos?
   → MAIN_IMAGE_OR_TITLE
   → una sola variable

10. ¿Vistas suficientes y cero ventas confirmadas?
    → resolver conversión con imágenes secundarias/información
    → oferta sólo si Negotiation confirma elegibilidad y compatibilidad
    → precio sólo tras niveles previos, E4/E5 y economía segura

11. ¿Ninguna intervención adicional está demostrada?
    → CONTINUE_MONITORING
```

## 12. Escalera de acciones

| Nivel | Acción | Condición de avance |
|---:|---|---|
| 1 | `TECHNICAL_VERIFICATION` | Identidad, estado, stock, categoría y políticas resueltos |
| 2 | `EVIDENCE_REVALIDATION` | Fuente fresca, completa y reconciliada |
| 3 | `CATEGORY_AND_ASPECTS` | Categoría y aspectos oficiales completos |
| 4 | `DISCOVERY_AND_KEYWORDS` | Propuesta respaldada por expediente, sin copiar títulos |
| 5 | `MAIN_IMAGE_OR_TITLE` | Una sola variable preparada |
| 6 | `SECONDARY_IMAGES_AND_CONVERSION` | Objeción verificable de pack, dimensiones o compatibilidad |
| 7 | `SHIPPING_RETURNS_COMMERCIAL_INFO` | Información comercial y confianza resueltas |
| 8 | `CPS_PROMOTION` | E4+, economía completa, stock fresco y headroom |
| 9 | `INTERESTED_BUYER_OFFER` | Elegibilidad oficial y soporte API confirmado |
| 10 | `LIMITED_PRICE_TEST` | E4/E5, ventas no `ACTIVE_ONLY`, piso/margen/ROI protegidos |
| 11 | `PAUSE_RETIRE_OR_REPLACE` | Sin ruta rentable o presupuesto de experimentos agotado |

No es obligatorio ejecutar todos los niveles. Sí es obligatorio explicar
`whyNotNextLevel` para demostrar por qué una intervención más agresiva está
bloqueada.

## 13. Competitive Gap

`EBAY_COMPETITIVE_GAP_REPORT_V1` responde:

- Qué hacen mejor los vendedores con ventas confirmadas.
- Qué hace mejor IMNOVA.
- Qué brechas pueden cerrarse con seguridad.
- Qué contenido o claims no se pueden copiar.
- Qué hipótesis siguen sin verificar.
- Cuál es el siguiente experimento de una variable.

Reglas:

1. Sólo entran al conjunto exacto comparables con score `>=85`, misma condición
   y mismo pack.
2. Un ganador requiere `SOLD_CONFIRMED` y unidades confirmadas mayores que cero.
3. `ACTIVE_ONLY` se cuenta por separado y sólo mide oferta.
4. Se agregan tokens y patrones visuales verificables; no se copian títulos,
   fotografías, descripciones, logotipos ni claims.
5. El resultado siempre declara `competitorContentCopied=false`.
6. La recomendación conserva referencias de evidencia y versión del reporte.

Los comparables de score `70–84` permanecen en investigación. Los inferiores a
70 quedan fuera de precio. El landed price es item price más shipping
obligatorio.

## 14. Economía canónica

La economía se calcula exclusivamente con `EBAY_UNIT_ECONOMICS_V1`.

Valores iniciales del motor canónico:

| Componente | Valor inicial |
|---|---:|
| Fee porcentual estimado | 15.3% |
| Fee fijo | USD 0.40 |
| Shipping estimado | USD 6.99 |
| Reserva de devoluciones | 4% |
| Reserva conservadora de promoción | 5% |
| Contribución mínima | USD 5 |
| Margen mínimo | 20% |
| ROI mínimo | 30% |

```text
contribución =
  ingreso reconocido
  - COGS
  - shipping
  - fees
  - reserva de devoluciones
  - reserva/promoción
  - demás costos variables

margen = contribución / ingreso reconocido

ROI = contribución / COGS

precio piso = máximo(
  piso por contribución,
  piso por margen,
  piso por ROI
)
```

### 14.1 Reserva 5% frente a experimento máximo 2%

No existe contradicción matemática:

- El 5% es una reserva conservadora dentro del escenario económico.
- El 2% es el máximo inicial de una tasa CPS propuesta por el experimento.
- La propuesta efectiva debe ser el menor valor entre 2% y el headroom real.
- La reserva de seguridad comercial inicial es 3%.
- Si existen ad fees oficiales, deben incluirse en el snapshot after y
  reconciliarse antes de declarar resultado.

No se debe sustituir silenciosamente la reserva del 5% por 2%. Primero se
versiona la política y se demuestra con datos que el tratamiento contable
correcto cambió.

### 14.2 Precio y ofertas

Un precio público puede bajar como máximo 3% por experimento. Una oferta a
interesados también tiene un descuento provisional máximo de 3%.

Todo escenario debe demostrar:

- Costos completos.
- Stock positivo y fresco.
- Precio propuesto por encima del piso.
- Contribución proyectada de al menos USD 5.
- Margen proyectado de al menos 20%.
- ROI proyectado de al menos 30%.
- Acción reversible.
- Aprobación humana.

Si no existe escenario seguro, la salida es `PAUSE_OR_RETIRE_RECOMMENDED`, no
una venta con pérdida.

## 15. Experimentos

Cada propuesta usa
`EBAY_RECOVERY_SINGLE_VARIABLE_EXPERIMENT_V1`.

Contrato mínimo:

- Idempotency key estable.
- Una variable.
- Un solo campo de mutación.
- Hipótesis.
- KPI principal.
- Baseline.
- Valor anterior.
- Valor propuesto.
- Ventana inicial de siete días.
- Muestra mínima.
- Guardrails.
- Rollback con valor anterior.
- Mecanismo de ejecución.
- `automaticExecutionAllowed=false`.
- `ebayWriteAllowed=false`.
- `requiresHumanApproval=true`.

Mecanismos permitidos:

| Cambio | Ledger o mecanismo |
|---|---|
| Título | `EXISTING_TITLE_REVISION_LEDGER` |
| Imágenes | `EXISTING_IMAGE_REVISION_LEDGER` |
| Precio o CPS | `EXISTING_COMMERCIAL_IMPROVEMENT_LEDGER` |
| Oferta a interesados | `NEGOTIATION_NOT_IMPLEMENTED` |
| Categoría, aspects u otra preparación | `MANUAL_ONLY` |

La idempotency key incorpora cuenta, marketplace, listing, SKU, acción,
variable, valor propuesto, referencias de evidencia, hash económico y versión
de política.

Una restricción impide dos experimentos activos para la misma cuenta,
marketplace, listing y variable.

## 16. Ledger, claim y reconciliación

El ledger comercial existente se amplía con:

- `experiment_id`.
- `claim_token`.
- `lease_expires_at`.
- `reconciled`.
- `reconciled_at`.
- `reconciliation_code`.
- `rollback_of_execution_id`.

Flujo futuro de una acción canario:

```text
PROPOSED
→ APPROVED por humano
→ preview_ready
→ claim atómico con SKIP LOCKED
→ write_in_flight
→ write_acknowledged
→ readback oficial
→ applied_verified
```

El claim sólo acepta:

- Fase `preview_ready`.
- `ebay_write_dispatched=false`.
- Experimento sin vínculo o en estado `APPROVED`.
- Lease ausente o vencido.

El lease se limita a 30–300 segundos. El `claim_token` es la capacidad necesaria
para marcar un resultado ambiguo.

### 16.1 Resultado ambiguo

```text
timeout, 5xx, pérdida de conexión o respuesta no concluyente
→ outcome_unknown
→ borrar lease
→ no reintentar
→ leer estado oficial
→ reconciliar contra expected payload hash
```

Sólo un fallo seguro y demostrado antes del dispatch permite reintento. Si el
readback coincide, se registra `applied_verified`. Si no coincide o no puede
obtenerse, permanece `outcome_unknown`.

V1 shadow no utiliza estos RPCs de escritura. Antes de un canario real se debe
demostrar la recuperación de un `write_in_flight` cuyo worker murió y confirmar
el modelo de ownership, ya que el claim actual usa `claim_token` como capacidad
exclusiva.

## 17. Before/after

### 17.1 Arquitectura

| Antes | Después |
|---|---|
| Recomendación embebida en evento | Caso durable y transición auditable |
| Métricas orgánicas agregadas | Desglose oficial de Traffic Report |
| Pagado mezclable conceptualmente | Snapshot pagado físicamente separado |
| Experimento sin lifecycle durable | Control `PROPOSED` a `RESOLVED` |
| Sin membership de medición | Snapshots `BASELINE`, `MEASUREMENT`, `ROLLBACK` |
| Ledger sin vínculo a experimento | `experiment_id` y rollback enlazado |
| Resultado ambiguo difícil de recuperar | `outcome_unknown` y readback |
| Éxito potencial por métricas blandas | Aprendizaje sólo por venta rentable |

### 17.2 Snapshot experimental

Antes de ejecutar:

```json
{
  "role": "BASELINE",
  "window": "completa y reconciliada",
  "organic": {
    "impressions": 500,
    "views": 2,
    "ctrPercent": 0.4
  },
  "confirmedUnitsSold": 0,
  "contribution": 8.2,
  "marginPercent": 27.34,
  "roiPercent": 45
}
```

Después del cooldown y la ventana:

```json
{
  "role": "MEASUREMENT",
  "window": "equivalente, completa y reconciliada",
  "organic": {
    "impressions": 520,
    "views": 18,
    "ctrPercent": 3.46
  },
  "confirmedUnitsSold": 1,
  "contribution": 7.6,
  "marginPercent": 25.5,
  "roiPercent": 40
}
```

Este ejemplo es conceptual, no un resultado real. Sólo sería `WON` si alcanza
la muestra mínima, el KPI mejora más de 5%, existe venta confirmada y todos los
guardrails permanecen protegidos.

Evaluación:

| Condición | Resultado |
|---|---|
| Muestra insuficiente o KPI ausente | `INCONCLUSIVE` |
| Guardrail económico violado | `LOST` y `ROLLBACK_REQUIRED` |
| KPI after menor al 90% de before | `LOST` y `ROLLBACK_REQUIRED` |
| KPI after mayor al 105% de before | `WON` |
| Cambio entre 90% y 105% | `NEUTRAL` |

## 18. Rollback

El rollback nunca es automático.

1. Conservar el snapshot before y el valor anterior.
2. Marcar el experimento `LOST` y el caso `ROLLBACK_REQUIRED`.
3. Preparar una nueva acción con aprobación humana.
4. Enlazarla mediante `rollback_of_execution_id`.
5. Reclamarla atómicamente en el ledger existente.
6. Ejecutar una sola vez.
7. Realizar readback oficial.
8. Persistir snapshot con rol `ROLLBACK`.
9. Entrar en `COOLDOWN`.

Un rollback no borra diagnóstico, transición, ejecución ni aprendizaje. Si su
resultado es ambiguo, permanece `outcome_unknown` y no se vuelve a enviar.

Rollback operativo del motor shadow:

1. Deshabilitar `scheduler_enabled` en configuración de staging.
2. Mantener `shadow_mode=true`.
3. Mantener `external_writes_enabled=false`.
4. No eliminar casos, diagnósticos ni memberships.
5. Reanudar sólo después de corregir y versionar la política.

## 19. Aprendizaje

Un aprendizaje sólo es comercialmente reutilizable cuando:

```text
result = WON
and confirmed_units_sold > 0
and net_contribution >= USD 5
```

Impresiones, CTR, watchers o ventas atribuidas sin reconciliar nunca bastan.

Un aprendizaje elegible puede alimentar:

- Product opportunity score.
- Top 5 ranking.
- Listing readiness.
- Keywords.
- Visual strategy.
- Pricing.
- Promotion.

Los demás resultados alimentan únicamente auditoría. El evento de aprendizaje
es append-only y tiene hash único.

## 20. Tareas humanas

| Momento | Responsabilidad humana |
|---|---|
| OAuth | Confirmar cuenta, scopes efectivos y RuName sin exponer secretos |
| Verificación | Resolver identidad, categoría, aspects, políticas y stock |
| Propuesta | Revisar evidencia, hipótesis, KPI, riesgo y datos faltantes |
| Aprobación | Aprobar o rechazar; nunca se interpreta silencio como aprobación |
| Ejecución | Ejecutar manualmente o autorizar el ledger específico |
| Medición | Confirmar ventanas comparables y reconciliadas |
| Ambigüedad | Revisar estado oficial antes de considerar otra acción |
| Rollback | Autorizar una nueva ejecución que restaure el valor anterior |
| Aprendizaje | Validar venta, contribución y aplicabilidad a otra cohorte |

El motor puede completar diagnóstico y preparación sin intervención humana.
Ninguna modificación real de eBay puede omitir estas tareas.

## 21. Dry-run determinista de cinco listings

`runFiveListingRecoveryDryRun` exige exactamente cinco entradas. Procesa cada
listing de forma aislada y pone cualquier excepción en
`QUARANTINED_OPTIMIZATION_ERROR`.

Fixtures:

| Listing | Evidencia | Diagnóstico esperado | Acción esperada |
|---|---|---|---|
| `100000000001` | 0 impresiones, 0 vistas | `NO_IMPRESSIONS` | Nivel 4 `DISCOVERY_AND_KEYWORDS` |
| `100000000002` | 500 impresiones, 2 vistas, CTR 0.4% | `IMPRESSIONS_NO_CLICKS` | Nivel 5 `MAIN_IMAGE_OR_TITLE` |
| `100000000003` | `ACTIVE_ONLY`, cero ventas | `CLICKS_NO_CONVERSION` | Nivel 6 `SECONDARY_IMAGES_AND_CONVERSION`; precio y promoción bloqueados |
| `100000000004` | CPC activo, USD 18, cero ventas atribuidas | `PROMOTED_NO_RESULT` | Preparar `promotion_status=PAUSE_RECOMMENDED` |
| `100000000005` | 2 ventas propias rentables confirmadas | Recuperación | `PERFORMANCE_RECOVERED` |

Salida de seguridad esperada:

```json
{
  "listingCount": 5,
  "realEbayReads": 0,
  "realEbayWrites": 0,
  "openAiCalls": 0,
  "whatsappMessages": 0,
  "stateMutations": 0
}
```

Este dry-run puro no persiste nada. El shadow run persistido es otro modo y sólo
lee snapshots, órdenes y marketing ya almacenados.

## 22. Plan de canarios en staging

### Canario 0: contrato puro

Ejecutar los cinco fixtures. Exigir decisiones deterministas, aislamiento de
errores y todos los contadores de efectos externos en cero.

### Canario 1: shadow persistido de cinco

Usar `manual_shadow`, límite cinco, una cuenta y `EBAY_US`. Confirmar un solo run,
cinco run items como máximo, casos únicos y transiciones append-only.

### Canario 2: repetición idempotente

Repetir con los mismos snapshots. Confirmar que no se dupliquen diagnóstico,
Competitive Gap ni experimento por los mismos hashes e idempotency key.

### Canario 3: scheduler shadow

Habilitar exclusivamente `scheduler_enabled` en staging. Mantener
`external_writes_enabled=false`. Observar siete días:

- Runs concurrentes: cero.
- Leases expirados recuperados y auditados.
- Quarantines aislados.
- Casos agresivos por `ACTIVE_ONLY`: cero.
- Experimentos duplicados por variable: cero.
- Listings devueltos al pipeline de producto: cero.

### Canario 4: ventanas y reconciliación

Usar cinco listings con Traffic Report fresco y órdenes oficiales. Incorporar
pagado sólo después de confirmar scope real. Exigir ventanas orgánicas/pagadas
separadas y bloquear toda fila `PENDING`, `UNKNOWN`, `INCOMPLETE` o vencida.

### Canario 5: revisión humana sin ejecución

Mostrar las propuestas en Admin. Revisar explicación, evidencia, baseline,
economía, guardrails, rollback y datos faltantes. No crear cambios eBay.

### Canario 6: una acción humana de bajo riesgo

Sólo después de aprobar los canarios anteriores, delegar una acción reversible
de una variable al ledger de título o imagen existente. El recovery engine
permanece en shadow. Exigir preflight, claim, readback y snapshot after.

### Canario 7: acción comercial

Precio o CPS requieren aprobación específica adicional, E4/E5, costos completos,
stock fresco y piso/margen/ROI protegidos. CPC y Negotiation permanecen
bloqueados.

## 23. Criterios de parada

Detener el canario si ocurre cualquiera:

- Una escritura no autorizada.
- Un WhatsApp emitido por recovery.
- Un scope efectivo no coincide con el contrato.
- Buyer PII en snapshots, logs o errores.
- `ACTIVE_ONLY` habilita precio, oferta o promoción.
- Orgánico y pagado se mezclan.
- Una ventana no reconciliada produce acción.
- Dos runs activos para cuenta/marketplace.
- Dos experimentos activos para listing/variable.
- Un price scenario cruza piso, contribución, margen o ROI.
- Un timeout genera reenvío.
- Se copia contenido creativo de un competidor.
- Un listing publicado vuelve al pipeline de análisis/publicación.
- Un aprendizaje se marca reutilizable sin venta rentable confirmada.

## 24. Seguridad de datos

Las tablas nuevas tienen RLS forzada. `public`, `anon` y `authenticated` no
tienen acceso directo. Las operaciones son `service_role`.

Son append-only:

- Transiciones.
- Diagnósticos.
- Baselines.
- Snapshots pagados.
- Elegibilidad Negotiation.
- Competitive Gap.
- Learning events.

Los errores se sanitizan. No se persisten tokens, teléfonos, buyer usernames,
direcciones, mensajes de compradores ni payloads completos de órdenes.

## 25. Resultado operativo esperado

El motor debe responder para cada listing:

1. Qué está técnicamente verificado.
2. Qué ventana y fuente sustentan las métricas.
3. Dónde está el cuello del embudo.
4. Qué evidencia es venta confirmada y qué sólo mide interés u oferta.
5. Qué hacen mejor comparables ganadores verificables.
6. Qué diferencia puede probar IMNOVA sin copiar.
7. Qué única variable conviene medir.
8. Qué piso, margen, ROI y stock protegen la propuesta.
9. Qué aprobación humana falta.
10. Qué resultado produjo el experimento y si puede aprenderse de él.

El objetivo no es aumentar cambios ni alertas. Es recuperar rendimiento con el
menor riesgo, preservar margen y convertir únicamente resultados confirmados en
aprendizaje reutilizable.

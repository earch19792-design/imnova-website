# SELLER_OS_ASSISTANT_FINAL_ACTIVATION_CLOSEOUT_V1

El cierre sigue pendiente. No se modificó producción ni se ejecutaron writes de eBay o Ads. El cambio de aplicación de este turno corrige exclusivamente la navegación automática que impedía al operador permanecer en Mayel: el shell global ya no monta el fallback de adquisición de Research. El worker conserva su ruta dedicada y su autoridad existente. No se cambió el menú ni Phase A.

La observación física del navegador identificó una navegación iniciada por el bundle de Research hacia `/admin`, seguida de la validación de sesión que muestra «Preparando tu espacio». La sesión de Supabase seguía vigente y `/api/admin/session` confirmó OWNER_ADMIN con HTTP 200. Se recuperó la cookie usando ese token existente; no se cambiaron credenciales ni permisos.

La lectura física autenticada del nuevo flujo guardado devolvió HTTP 200, trace `962abd9e-85dc-4e65-afc9-5e0861b2e2e5`, para Item ID `366582671136`. Su propuesta `abbbc8d2-e8fe-4d87-8d28-6c9e419c8bd2`, experimento `34078a7e-85cc-4a35-ae26-24e65784e7f3`, está ligada a la tarea `5161b7d3-37cf-4221-a6d8-2dde6940ef57`. Tiene Preview privado, estado DRAFT, `imported=false` y `editable=false` para la sesión OWNER disponible. Una segunda lectura, posterior al despliegue, confirmó HTTP 200 y ambas propuestas guardadas no editables para esta sesión (trace `f6f36cd9-57b9-4a52-9cfb-9fe520b74cbd`). Por tanto el canary PREPARE_REVIEW aún no se ejecutó: necesita la sesión del operador asignado. No se reasignó la tarea ni se afirmó QA humana. No requiere reupload manual. No se confirmó ninguna cola de aplicación.

La lectura desplegada del sobre económico de `366650054490` devolvió HTTP 200, trace `cce7a3ae-8703-4e37-b96d-ddba76621944`. El Fee Authority vigente conserva `PENDING_ORDER_CONTEXT` y cinco dependencias: base total/impuesto del comprador, service metrics de categoría, internacional, conversión e impuesto sobre comisiones. Su importe sigue null. Precio $18.74 y producto $1.79 conservaron sus vencimientos de 19:23 y 19:37 UTC; no se renovaron al leerlos. Shipping $6.99 permanece vigente hasta 23:40 UTC. La política OWNER de otros costes cero sigue registrada y condicional; no se sustituyeron costes desconocidos por cero.

Las tres solicitudes SIMULATE físicas a la API de Mayel usaron las tasas solicitadas, con los parámetros del canary anterior ($8 y 15% de mínimos). Estos parámetros no constituyen una política OWNER confirmada para gasto. Las tres devolvieron HTTP 400 y `EXACT_CURRENT_LIVE_LISTING_REQUIRED`:

| Tasa | Trace | Profit posterior | Margin posterior | Seguridad probada |
|---|---|---|---|---|
| 3% | e3957318-9203-4d9d-a39b-0d7576e1b36a | null | null | false |
| 4% | e90d8971-3fbb-4615-b299-095213ae1914 | null | null | false |
| 5% | 4d9d3451-0c4c-4ecb-a5d0-b79b370171ec | null | null | false |

El replay local del guard existente, con la evidencia física y sus vencimientos reales, devuelve `BLOCKED_EVIDENCE` para las tres tasas. No es un cálculo económico aprobado ni un resultado del UI. El guard ya calcula el techo a partir de beneficio disponible, mínimos de profit/margin y base oficial del cargo, y usa el mínimo entre ese techo y el máximo del operador. No se introdujo un techo de 3%, 4% o 5%.

Developer Analytics confirmó `Trading BLOCKED`, `GetItem remaining=0`, `GetUser remaining=0`, con reinicio anunciado a las `2026-09-10T07:00:00Z` (01:00 Guatemala). Trace `7b7bbac7-dc2b-4861-ab02-0e3ff55f8db3`. No se hicieron probes Trading adicionales.

Se descargó y examinó el [OpenAPI oficial Marketing v1.23.2](https://www.developer.ebay.com/api-docs/master/sell/marketing/openapi/3/sell_marketing_v1_oas3.json). El modelo porcentual usa `COST_PER_SALE`, campaña por IDs y estrategia `FIXED`. `bidPercentage` es string porcentual con un decimal, rango API 2.0–100.0. Este rango no es un techo económico. Crear: `POST /ad_campaign/{campaign_id}/ad`, respuesta 201 y Location. Actualizar: `POST /ad_campaign/{campaign_id}/ad/{ad_id}/update_bid`, 204. Eliminar: `DELETE /ad_campaign/{campaign_id}/ad/{ad_id}`, 204. `getAd`, `getAds` y `getCampaign` permiten el readback. Eliminar debe verificarse en el anuncio/listing exacto; no se ejecutó. `pauseCampaign` afecta la campaña completa. Los IDs y códigos de error por operación se preservan en el artefacto adjunto. La futura tasa ejecutable debe redondearse hacia abajo al decimal y volver a satisfacer el mínimo OWNER; el serializador/executor no está certificado.

La [autoridad de elegibilidad](https://developer.ebay.com/api-docs/sell/static/marketing/pl-verify-eligibility.html) requiere vendedor y listing elegibles; el contrato Account v1.9.3 ofrece `getAdvertisingEligibility` con marketplace obligatorio. Sus respuestas físicas para esta cuenta y listing siguen pendientes. La [cuota oficial publicada](https://developer.ebay.com/develop/get-started/api-call-limits) de Marketing Ads es 10,000/día; no sustituye la cuota concedida a la aplicación ni certifica límites de ráfaga. La revisión incluye la [taxonomía REST oficial](https://developer.ebay.com/develop/guides-v2/using-ebay-restful-apis#handling-errors): conservar errorId/domain/category, distinguir rechazo de resultado ambiguo, y conciliar antes de repetir cualquier write. No se certificó un ejecutor sobre esta cuenta.

El primer Ads canary queda bloqueado antes del Preview de gasto. No hay un candidato SCALE probado con economía completa y estado LIVE vigente. `ADS_WRITE_COUNT=0`, `DUPLICATE_AD_ACTION_COUNT=0`, sin readback posterior a write. ONE/MULTIPLE/ALL_ELIGIBLE siguen siendo preparación/simulación. La habilitación de writes múltiples sigue condicionada al éxito físico del canary individual. La autorización OWNER explícita se solicitará sólo con un Preview completo y revisable.

El SHA de implementación `f4b5cca12b5717558ec13d897100ea9bce629b91` pasó 386/386 tests, typecheck, lint, build, auditoría Seller OS y seguridad runtime. La validación fue sobre un commit limpio y estable. Vercel confirmó READY en el proyecto dedicado `imnova-seller-os-preprod`, deployment `dpl_HcedBxjv4xe6pk5oKzVFkb14xQS1`, con el alias de preproducción. No se desplegó el proyecto de producción.

La comprobación física posterior mantuvo seleccionado `366582671136` en Mayel durante 75 segundos, con **0 navegaciones automáticas**, después de una única navegación inicial deliberada. Esta prueba verifica la sesión OWNER observada; falta la confirmación de la asistente en su navegador remoto. La apertura de la mejora guardada no ejecutó PREPARE_REVIEW ni QA.

Los flags de seguridad false significan que la seguridad no quedó probada; no afirman rentabilidad negativa calculada. Los valores económicos null se conservan como desconocidos. Reiniciar cuota no resuelve por sí solo los componentes pendientes del Fee Authority.

El primer canary de Ads necesita una campaña CPS/FIXED ya existente y RUNNING: crear campaña más anuncio excedería una única mutación. El estado actual del anuncio, elegibilidad y cuota Marketing deben leerse oficialmente antes del Preview. El camino de eliminación está documentado, sin ejecución.

```json
{
  "STATUS": "BLOCKED_CANARIES_NAVIGATION_FIXED_PREPROD",
  "IMPLEMENTATION_SHA": "f4b5cca12b5717558ec13d897100ea9bce629b91",
  "SAVED_IMAGE_PHYSICAL_CANARY_PASS": false,
  "MANUAL_IMAGE_REUPLOAD_REQUIRED": false,
  "ECONOMICS_PROVEN": false,
  "PROFIT_BEFORE_ADS": null,
  "MARGIN_BEFORE_ADS": null,
  "MAX_SAFE_AD_RATE_PCT": null,
  "AD_3_PERCENT_SAFE": false,
  "AD_4_PERCENT_SAFE": false,
  "AD_5_PERCENT_SAFE": false,
  "EBAY_ADS_OFFICIAL_CONTRACT_CERTIFIED": false,
  "EBAY_ADS_WRITE_ENABLED": false,
  "SINGLE_LISTING_ADS_CANARY_READY": false,
  "SINGLE_LISTING_ADS_CANARY_PASS": false,
  "OFFICIAL_AD_READBACK_PASS": false,
  "MULTI_LISTING_ADS_WRITE_ENABLED": false,
  "FULL_SUITE_RESULT": "386/386 PASS",
  "NEW_REGRESSION_COUNT": 0,
  "ASSISTANT_OPERATIONAL_CLOSEOUT": false,
  "REVENUE_PROMOTION_ACTIVATION_READY": false,
  "NEXT_ACTION": "Usar la sesión del operador asignado para un único PREPARE_REVIEW; resolver evidencias económicas y elegibilidad/cuota Ads; presentar Preview completo antes de pedir autorización OWNER de gasto."
}
```

Evidencia: [recibo completo](assistant-final-activation-closeout-evidence-v1.json) y [contrato oficial revisado](assistant-final-activation-ads-official-contract-v1.json).

# Contrato Ads porcentual: preparación, sin habilitación de writes

Revisión documental: 2026-09-09. EBAY_ADS_OFFICIAL_CONTRACT_CERTIFIED=false. EBAY_ADS_WRITE_ENABLED=false.

La promoción porcentual corresponde a campañas generales del Sell Marketing API, con fundingModel COST_PER_SALE y bidPercentage. No se ha certificado la elegibilidad ni la semántica ejecutable sobre esta cuenta. [Overview oficial](https://developer.ebay.com/api-docs/sell/marketing/static/overview.html).

| Aspecto | Evidencia y límite |
| --- | --- |
| Cuenta | El contrato remite a getAdvertisingEligibility; faltan readback y permisos de esta cuenta. [Elegibilidad](https://www.developer.ebay.com/api-docs/sell/static/marketing/pl-verify-eligibility.html). |
| Listing | País, moneda, categoría y tipo deben ser elegibles; no se infiere elegibilidad por estar LIVE. Misma referencia oficial de elegibilidad. |
| Modelo | Campaña general CPS; no confundir con CPC/priority ni descuentos. [Flujo general](https://developer.ebay.com/api-docs/sell/static/marketing/pl-campaign-flow-pls.html). |
| Base económica | La documentación describe un cargo sobre el total vendido, incluido precio, envío, impuestos y otros cargos aplicables. La simulación exige una base demostrada; no sustituye ese total por el precio del producto. [Promoted Listings](https://www.developer.ebay.com/api-docs/sell/static/marketing/pl-overview.html). |
| Representación de tasa | bidPercentage es una tasa porcentual; falta certificar serialización, límites y precisión contra el contrato exacto de creación/actualización de Ads. No se implementó un serializador de write. [CreateAdRequest](https://developer.ebay.com/api-docs/sell/marketing/types/pls%3ACreateAdRequest). |
| Crear/actualizar/eliminar | El flujo oficial documenta campañas y altas de Ads; los contratos concretos de actualización/eliminación, respuestas parciales y errores aún no están certificados para este canary. [Guía](https://developer.ebay.com/develop/guides/sell/marketing-and-promotions-guide). |
| Idempotencia | Estrategia propuesta, aún sin certificar: intención por cuenta/campaña/ItemID/política, reserva durable antes del write, conciliación con readback ante respuesta ambigua; nunca retry ciego. |
| Readback | Pendiente demostrar la lectura oficial del anuncio/campaña y compararla con la intención exacta. No basta con una respuesta HTTP exitosa al write. |
| Cuotas | La tabla oficial publica 10.000 llamadas/día para Marketing Ads; la cuota concedida a esta aplicación y los límites de ráfaga siguen pendientes. [API Call Limits](https://developer.ebay.com/develop/get-started/api-call-limits). |
| Errores | Pendiente catálogo por endpoint. El futuro executor deberá distinguir autenticación, autorización, elegibilidad, validación, conflicto, cuota, parcial y resultado ambiguo. |

La simulación calcula el coste de **una venta atribuida por listing elegible**, no una previsión de ventas ni un presupuesto garantizado de fin de semana. El porcentaje permitido es el mínimo entre el máximo del operador y el techo económico. Las tasas se redondean hacia abajo y el coste hacia arriba; se vuelven a comprobar beneficio y margen mínimos.

Ningún botón de esta implementación llama a un write de eBay Ads. El siguiente canary de Ads requiere cerrar los puntos pendientes y autorización específica para su ejecución física.

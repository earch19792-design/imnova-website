# EBAY-RESUME-B2A — Mobile WhatsApp Approval Center V1

## Why

La operación diaria no debe depender de estar frente a una computadora. Después del Top 50 Ranker, el usuario necesita revisar candidatos, confirmar observaciones y aprobar el siguiente preflight desde el teléfono sin abrir accesos de escritura prematuros.

Este centro modela WhatsApp como interfaz móvil lógica. No envía WhatsApp ni SMS reales. Tampoco usa WhatsApp Business API, eBay API, OAuth, bases de datos o servicios externos.

## Connection to the Top 50 Ranker

El Top 50 Ranker produce diez recomendaciones y cinco blueprints principales. El centro móvil consume el Top 5 real integrado:

1. Reusable Hook and Loop Cable Ties 50 Pack.
2. Cord Keeper Appliance Cable Organizer.
3. Clear Acrylic Drawer Organizer Trays Set.
4. Silicone Chair Leg Floor Protectors.
5. Magnetic Cable Holder Desk Set.

El producto anteriormente confirmado conserva rank 7 y sigue siendo válido, pero no sustituye la selección final del Top 5.

## Phone decisions

Desde el modelo móvil el usuario puede mostrar el Top 5, seleccionar un producto, confirmar que es el mismo producto, registrar una cantidad de stock observada, confirmar que la referencia visual sirve para revisión, aprobar B2-RUN Preflight, rechazar todos, solicitar un scan nuevo, poner el flujo en HOLD o pedir ayuda.

## Commands

- `TOP5_SHOW`
- `SELECT_RANK_1` a `SELECT_RANK_5`
- `CONFIRM_SAME_PRODUCT`
- `REJECT_NOT_SAME_PRODUCT`
- `CONFIRM_STOCK_QTY:<number>`
- `CONFIRM_IMAGE_REVIEW_OK`
- `APPROVE_B2_RUN_PREFLIGHT`
- `REJECT_ALL`
- `REQUEST_REFRESH`
- `HOLD_FOR_REVIEW`
- `HELP`

Todos son comandos simulados. El audit trail se construye en memoria y marca que no hubo envío real.

## Modeled cards and prompts

El contrato incluye tarjeta resumen del Top 5, detalle del candidato, confirmación de mismo producto, cantidad observada, revisión visual, aprobación de preflight, rechazo/refresh y ayuda.

Las tarjetas contienen solo datos necesarios para decidir. No incluyen tokens, dirección completa, imágenes descargadas ni catálogo privado.

## Approval gates

Seleccionar un producto no basta. `APPROVE_B2_RUN_PREFLIGHT` solo funciona cuando:

- Hay candidato seleccionado.
- El humano confirmó que es el mismo producto.
- Registró una cantidad observada igual o superior a uno con source `HUMAN_MOBILE_CONFIRMED`.
- Confirmó la referencia visual para revisión.
- El candidato no tiene riesgo alto.
- Emitió la aprobación explícita de preflight.

Esto autoriza únicamente `EBAY-RESUME-B2-RUN-PREFLIGHT`. No crea draft, listing u offer y no publica.

## Stock, product, and image confirmations

La cantidad se registra como observación humana, no como inventario garantizado del proveedor. La confirmación “mismo producto” vincula la opción móvil con el candidato revisado. La aprobación visual solo confirma que la referencia sirve para revisión; una imagen propia o autorizada seguirá siendo obligatoria antes de publicar.

## Routes

- Sin selección: `NEED_HUMAN_TOP_PRODUCT_SELECTION`.
- Seleccionado con gates incompletos: `NEED_MOBILE_CONFIRMATIONS`.
- Todos los gates aprobados: `EBAY-RESUME-B2-RUN-PREFLIGHT`.
- Rechazo o refresh: `NEED_LUNA_SCAN_REFRESH`.
- Duda o pausa: `EBAY-RESUME-HOLD`.

`canPublish` siempre es false.

## Future connections

B2-RUN Preflight consumirá la selección aprobada para preparar el paquete técnico sin write. LOOP 150 seguirá exigiendo aprobación humana independiente para el primer listing real.

LOOP 152 podrá usar el mismo patrón móvil para stock guard, price guard, margin guard y alertas. Una integración futura con WhatsApp Business API requerirá plantillas aprobadas, consentimiento, autenticación, privacidad, rate limits y guardas de envío.

Codex self-improvement futuro deberá proponer mejoras mediante ramas, tests y PRs revisables. Nunca hará cambios directos a Production.

## Safety boundaries

- Sin WhatsApp o SMS real.
- Sin Production, main, Staging DB o Supabase writes.
- Sin eBay API, OAuth o token exchange.
- Sin draft, listing, offer o publicación.
- Sin generación, descarga o copia de imágenes.
- Sin scraper, Amazon u OpenAI/Codex API real.
- Sin secretos, tokens, `.env`, dumps o dirección completa de Luna Portex.
- Sin catálogo real ni consulta al almacén.

## Definition of Done

- Top 5 y detalle móvil construidos.
- Comandos válidos analizados de forma determinística.
- Gates incompletos bloquean el preflight.
- Flujo completo permite solo B2-RUN Preflight.
- Reject, refresh y hold enrutan correctamente.
- Audit trail lógico registra la secuencia.
- Todas las guardas y regresiones pasan.

## Human explanation rule

El reporte debe distinguir selección, confirmación, aprobación de preflight y publicación. Debe explicar que operar desde teléfono reduce dependencia del desktop, pero no reduce las compuertas de seguridad.

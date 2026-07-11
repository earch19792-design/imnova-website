# EBAY-MOBILE-REVIEW-REAL-RADAR-CONNECTOR V1

## Por qué existe ahora

La revisión móvil ya permite evaluar candidatos, pero un Top 5 fijo no refleja
el último scan, stock, snapshots ni readiness. Este loop reemplaza esa fuente
operativa silenciosa por el dashboard existente de Market Radar en modo GET
read-only.

## Top 5 real del Market Radar

“Real” significa que la página solicita el read model interno actual y ordena
sus productos por Supplier Opportunity Score. Cada tarjeta conserva IDs de
producto y snapshot, IDs/SKU del proveedor, títulos, handle/URL, referencia de
imagen existente, timestamps, stock y su fuente/confianza/edad, precios Luna,
descuento, colecciones, readiness, precio eBay observado si existe, Category ID,
pipeline, ruta, faltantes y riesgos.

`MARKET_RADAR_READONLY` identifica datos devueltos por el GET interno existente.
No ejecuta sync ni mutaciones. `DEMO_FIXTURE_ONLY` solo aparece al abrir la ruta
con `?demo=1`; está rotulado como demo y nunca habilita una aprobación real. Si
el GET no devuelve productos, no se usa fixture: la página pide ejecutar o
revisar Market Radar.

## Decisiones desde teléfono

Los botones siguen siendo grandes y permiten seleccionar, marcar no disponible,
confirmar producto/stock/imagen, pedir refresh, poner hold y evaluar preflight.
Se usan desde el teléfono igual que antes, pero la fuente y el último scan son
visibles. `decisionPersistence: BROWSER_STATE_ONLY` significa que recargar borra
la decisión. `officialApprovalRecord: false` evita confundirla con autorización
persistida. Este loop no escribe en Supabase.

## Guardas de B2-RUN

- Out of stock o ausencia del último scan: `STOCK_HOLD`.
- Stock stale o confirmación mayor a 24 horas: `NEED_STOCK_RECONFIRMATION`.
- Fuente `availability_only`: `NEED_STOCK_CONFIRMATION`.
- Sin precio eBay observado: `NEED_EBAY_MARKET_PRICE`.
- Sin margen preliminar aprobado: `NEED_MARGIN_REVIEW`.
- Con cinco candidatos reales: `NEED_MOBILE_REVIEW_OF_REAL_TOP5`.

En todos los casos `canProceedToB2RunPreflight` y `canPublish` permanecen false
en el reporte del conector. Una acción local no es una aprobación oficial.

## Conexión con los loops

`EBAY-FIRST-SELLABLE-CANDIDATE-REFRESH` define cómo retirar candidatos y pedir
un Top 5 nuevo. Este conector entrega ese Top 5 desde Radar, no desde fixture. El
listing package asistido podrá consumir una decisión oficial futura, pero no se
crea draft, offer, listing ni publicación aquí.

## Safety boundaries

Sin Production/main writes, Staging DB writes, Supabase writes, eBay API/write,
WhatsApp real, tokens persistidos o impresos, secretos, `.env`, imágenes nuevas,
scraper, Amazon, OpenAI/Codex API, draft, offer, listing o publicación.

## Definition of Done

- GET read-only carga y muestra cinco candidatos reales con trazabilidad.
- Ausencia de datos no activa fixture silenciosamente.
- Demo es explícito y queda bloqueado.
- Guardas de stock, precio y margen generan rutas verificables.
- Acciones y resumen declaran persistencia solo en navegador.
- Tests y regresiones pasan con `canPublish: false`.

## Human explanation rule

La interfaz debe explicar en lenguaje directo de dónde viene cada dato, qué está
pendiente y por qué un producto está bloqueado. Nunca debe presentar una señal
modelada o browser-only como hecho operativo persistido.

## Siguiente paso

Persistir decisiones en un registro oficial separado y auditado, después de
definir permisos y writes explícitos; no forma parte de este loop.

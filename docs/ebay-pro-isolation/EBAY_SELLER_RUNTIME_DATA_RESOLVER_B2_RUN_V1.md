# EBAY-RESUME-B2-RUN — Seller Runtime Data Resolver V1

## Why this resolver is inserted

El Controlled Write Draft-Only RUN ya define gates y payloads, pero todavía no debe habilitarse manualmente sin datos seller confirmados en runtime. Este resolver convierte esos faltantes en una checklist local y verificable antes de cualquier contacto de write con eBay.

El resolver no crea recursos, no intercambia tokens y no ejecuta API eBay. Su salida es readiness, no ejecución.

## Runtime data still required

1. Category ID real para `EBAY_US`.
2. Fulfillment policy aplicable.
3. Return policy aplicable.
4. Payment policy aplicable.
5. Stock final positivo.
6. Precio final positivo.
7. Imagen autorizada o bypass explícito limitado a unpublished-only.
8. Entorno objetivo SANDBOX o Production.

La presencia del token se valida como gate booleano adicional. Por eso `runtimeDataRequiredCount` es ocho, mientras `controlledWriteRunReady` exige 8/8 más token presente.

## Category runtime confirmation

La señal de categoría observada no equivale a un category ID real. El RUN debe usar un ID válido para marketplace y producto, resuelto antes del write. Este loop solo modela su confirmación.

## Seller policies

Fulfillment, return y payment policies pertenecen a la cuenta seller. Cada una debe estar confirmada; una sola ausente deriva a `NEED_SELLER_POLICY_RUNTIME_CONFIRMATION`.

## Final stock and price reviews

El stock observado de 20 unidades y el precio USD 12.99 son entradas previas. El resolver exige reconfirmar stock positivo y precio positivo. Stock cero o precio inválido bloquean readiness.

## Final image asset review

La imagen debe ser propia o autorizada. El bypass solo puede representar preparación unpublished-only y no concede permiso de publicación. No se genera, descarga ni copia ninguna imagen en este loop.

## Token presence boolean only

El runner opcional comprueba únicamente si una variable de token existe y no está vacía. No registra su valor, no lo incluye en salida, no lo guarda y no lo imprime. El modo default ni siquiera realiza esa lectura.

La comprobación opcional exige `READ_ONLY_RUNTIME_CHECK_APPROVED_NO_WRITE`. Sigue sin llamar eBay y no valida el contenido o alcance del token.

## Environment target

SANDBOX es el entorno preferido antes de Production. Seleccionar Production no ejecuta deployment ni API; cualquier uso real requerirá una autorización separada.

## READY_FOR_CONTROLLED_DRAFT_ONLY_REAL_RUN

Este estado significa que ocho datos operativos están resueltos, el token está presente como booleano y las guardas no-write permanecen activas. No significa que el write haya comenzado. `canExecuteEbayWrite` y `canPublish` continúan false.

## Connection to later loops

El resultado alimenta el Controlled Write Draft-Only RUN. Si en un futuro autorizado se crea un inventory item y offer no publicado, LOOP 150 realizará la revisión humana previa a cualquier publicación. LOOP 152 solo operará después de existir un listing activo autorizado, aplicando stock, price y margin guards.

## Safety boundaries

- Sin writes en Production, main, Staging DB o Supabase.
- Sin eBay write, OAuth o token exchange.
- Sin impresión o persistencia de tokens.
- Sin draft, inventory item, offer, listing o publicación.
- `publishOffer` y todas las acciones write están en la lista prohibida.
- Sin generación, descarga o copia de imágenes.
- Sin scraper, Amazon, eBay LOOP 149 antiguo, OpenAI/Codex API real, WhatsApp o SMS real.
- Sin secretos, `.env`, dumps, imágenes nuevas o dirección completa de Luna Portex.

## Definition of Done

- Checklist de ocho datos construida.
- Default resuelve 0/8 y bloquea categoría.
- Simulación completa resuelve 8/8 más token booleano.
- Missing policy e imagen generan rutas específicas.
- Token-only no imprime ni guarda el valor.
- Runner default usa `SAFE_NO_RUNTIME_READ`.
- Write y publicación permanecen imposibles.
- Tests, regresión y auditoría pasan.

## Human explanation rule

El reporte debe explicar que resolver datos runtime reduce incertidumbre pero no autoriza write. Debe diferenciar token presente de token válido, y readiness de ejecución real.

# eBay Offer API unpublished-only V2

## Objetivo

Crear, después de aprobación humana explícita, un `Inventory Item` y un
`Offer` con estado verificado `UNPUBLISHED` en eBay Sandbox o Production. No
contiene ni permite `publishOffer`. Un Offer API `UNPUBLISHED` no se presenta
como un draft editable de Seller Hub; se revisa desde este workspace.

## Flujo móvil

1. Abrir una oportunidad en Seller Command Center y preparar el workspace.
2. Ejecutar el preflight móvil. Funciona con los flags de escritura apagados y
   sólo usa GET sobre recursos eBay (el canje OAuth usa el POST obligatorio).
   Consulta Identity, privilegios, policies y locations sin devolver userId,
   token, secretos ni direcciones.
3. Elegir únicamente policies aptas y una location habilitada. Si existe una
   sola opción apta, se selecciona automáticamente; con varias, exige elección.
4. Completar y guardar la evidencia del producto. El SKU es reservado y
   determinista (`IMNOVA-<package-id>`), no editable.
5. Ejecutar la validación server-side. Requiere un snapshot HMAC del preflight,
   ligado a cuenta, target, `EBAY_US`, policies y location, con máximo 5 minutos.
6. Escribir la frase exacta mostrada (`CREAR DRAFT NO PUBLICADO EN PRODUCCIÓN`
   en la cuenta real) y aceptar las confirmaciones. La
   aprobación dura 15 minutos, es de un solo uso y queda ligada al hash exacto
   del payload.
7. Ejecutar. El servidor vuelve a validar Luna, economía, identidad, evidencia,
   colisiones locales y ausencia del SKU en eBay antes del primer `PUT`.

La aprobación se puede cancelar desde el teléfono antes de ejecutar.

## Barreras de seguridad

- Target por defecto: `SANDBOX`. `PRODUCTION` requiere doble feature flag.
- Operaciones permitidas: `createOrReplaceInventoryItem` y `createOffer`.
- Operaciones prohibidas: `publishOffer`, bulk publish y publish por grupo.
- Credenciales draft-only totalmente separadas por target; Production nunca
  reutiliza credenciales genéricas, Sandbox ni el token read-only existente.
- Identity debe responder `status=CONFIRMED`. El binding compara el fingerprint
  real con el esperado; el userId nunca se expone al navegador. Target y
  fingerprint forman parte del snapshot, hash, aprobación y ledger.
- El bootstrap seguro permite ejecutar el preflight como `IDENTITY_UNBOUND`,
  copiar sólo el fingerprint mostrado y configurarlo en servidor. Hasta entonces
  no se puede emitir snapshot, aprobar ni escribir.
- Las policies deben incluir `ALL_EXCLUDING_MOTORS_VEHICLES`; Payment también
  requiere `immediatePay=true`. Se revalidan en vivo justo antes del PUT.
- Una location sólo es apta con clave válida y estado `ENABLED`.
- `sellingLimit` puede faltar. Si eBay lo informa en cero se muestra warning y
  se bloquea una publicación futura, pero no la preparación UNPUBLISHED.
- Aprobación Admin humana, corta, idempotente y ligada al payload.
- Un SKU no se reutiliza dentro del ledger.
- Un resultado incierto de `createOffer` se pone en cuarentena y no se reintenta
  automáticamente. Sólo se reconcilia con GET si existe exactamente un Offer
  que coincide y sigue `UNPUBLISHED`, sin `listing`/`listingId`.
- En Production el `PUT` se intenta una sola vez. Un resultado incierto se
  compara con hasta tres GET acotados y, incluso ante un 404 inmediato, queda en
  cuarentena si no se puede probar el payload exacto.
- Production fuerza cantidad `1`. El lease de ejecución dura 5 minutos y cada
  transición posterior al claim exige el token exacto para evitar dos workers.
- `UNPUBLISHED` se presenta como verificación puntual al momento de crear; no se
  afirma como estado actual permanente sin volver a consultar eBay.
- Ninguna imagen se autoriza por inferencia: el Admin debe confirmar derechos.
- Categoría e item specifics se vuelven a validar con Taxonomy oficial. El hash
  conserva versión del árbol, restricciones y dependencias de valores; metadata
  ausente, truncada o con formato no soportado bloquea el readiness.

## Configuración de Preview

- `EBAY_DRAFT_ONLY_TARGET=SANDBOX` (valor por defecto)
- `EBAY_DRAFT_ONLY_WRITES_ENABLED=false` por defecto
- Sandbox usa exclusivamente:
  - `EBAY_DRAFT_ONLY_SANDBOX_CLIENT_ID`
  - `EBAY_DRAFT_ONLY_SANDBOX_CLIENT_SECRET`
  - `EBAY_DRAFT_ONLY_SANDBOX_REFRESH_TOKEN`
  - `EBAY_DRAFT_ONLY_SANDBOX_PREFLIGHT_SNAPSHOT_SECRET` (mínimo 32 caracteres)
  - uno de:
    - `EBAY_DRAFT_ONLY_SANDBOX_EXPECTED_ACCOUNT_FINGERPRINT` (recomendado)
    - `EBAY_DRAFT_ONLY_SANDBOX_EXPECTED_USER_ID`
- Production usa exclusivamente:
  - `EBAY_DRAFT_ONLY_PRODUCTION_CLIENT_ID`
  - `EBAY_DRAFT_ONLY_PRODUCTION_CLIENT_SECRET`
  - `EBAY_DRAFT_ONLY_PRODUCTION_REFRESH_TOKEN`
  - `EBAY_DRAFT_ONLY_PRODUCTION_PREFLIGHT_SNAPSHOT_SECRET` (mínimo 32 caracteres)
  - uno de:
    - `EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_ACCOUNT_FINGERPRINT` (recomendado)
    - `EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_USER_ID`
  - `EBAY_DRAFT_ONLY_PRODUCTION_WRITES_ENABLED=false` por defecto
  - `EBAY_DRAFT_ONLY_PRODUCTION_ALLOWED_GIT_BRANCH` igual a la rama Preview
- Production draft-only sólo se habilita cuando `VERCEL_ENV=preview` y
  `VERCEL_GIT_COMMIT_REF` coincide exactamente con la rama permitida. Un deploy
  de Vercel Production queda bloqueado aunque heredara los demás valores.
- El refresh token requiere `sell.inventory`, `sell.account.readonly` y
  `commerce.identity.readonly`.
- La economía se recalcula en el servidor cada vez que cambia el precio. Valores
  configurables (los valores indicados son los defaults):
  - `EBAY_DRAFT_ONLY_ESTIMATED_EBAY_FEE_RATE=0.15`
  - `EBAY_DRAFT_ONLY_FIXED_ORDER_FEE=0.40` (el cálculo aplica $0.30 automáticamente cuando el total de la orden no supera $10)
  - `EBAY_DRAFT_ONLY_ESTIMATED_OUTBOUND_SHIPPING=6.99`
  - `EBAY_DRAFT_ONLY_RETURNS_RESERVE_RATE=0.04`
  - `EBAY_DRAFT_ONLY_PROMOTED_LISTINGS_RESERVE_RATE=0.05`
  - `EBAY_DRAFT_ONLY_MIN_NET_PROFIT=5`
  - `EBAY_DRAFT_ONLY_MIN_MARGIN_PERCENT=20`
  - `EBAY_DRAFT_ONLY_MIN_ROI_PERCENT=30`

`estimatedNetProfit` recibido desde el navegador nunca decide la aprobación; el
hash aprobado contiene la economía canónica calculada por el servidor.

El preflight read-only permanece disponible con ambos flags de escritura en
`false`. El botón de ejecución sí permanece bloqueado mientras falten
credenciales/binding/snapshot o el feature flag esté desactivado. Activarlo sólo
autoriza Inventory Item + Offer API `UNPUBLISHED`; no autoriza publicar.

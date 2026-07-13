# eBay draft-only Sandbox V1

## Objetivo

Crear, después de aprobación humana explícita, un `Inventory Item` y un
`Offer` con estado `UNPUBLISHED` en eBay Sandbox. Esta versión no contiene ni
permite `publishOffer`.

## Flujo móvil

1. Abrir una oportunidad en Seller Command Center y preparar el workspace.
2. Completar título, categoría, aspectos, descripción, imágenes autorizadas,
   precio, SKU, cantidad, condición, peso, dimensiones, location y policies.
3. Guardar y ejecutar la validación server-side.
4. Escribir `CREAR DRAFT NO PUBLICADO` y aceptar las confirmaciones. La
   aprobación dura 15 minutos, es de un solo uso y queda ligada al hash exacto
   del payload.
5. Ejecutar. El servidor vuelve a validar Luna, economía, identidad, evidencia,
   colisiones locales y ausencia del SKU en eBay antes del primer `PUT`.

La aprobación se puede cancelar desde el teléfono antes de ejecutar.

## Barreras de seguridad

- Target fijo: `SANDBOX`.
- Operaciones permitidas: `createOrReplaceInventoryItem` y `createOffer`.
- Operación prohibida: `publishOffer`.
- Credenciales de escritura separadas de las credenciales read-only.
- Aprobación Admin humana, corta, idempotente y ligada al payload.
- Un SKU no se reutiliza dentro del ledger.
- Un resultado incierto de `createOffer` se pone en cuarentena y no se reintenta
  automáticamente.
- Ninguna imagen se autoriza por inferencia: el Admin debe confirmar derechos.

## Configuración de Preview

- `EBAY_DRAFT_ONLY_TARGET=SANDBOX`
- `EBAY_DRAFT_ONLY_WRITES_ENABLED=false` por defecto
- `EBAY_DRAFT_ONLY_CLIENT_ID`
- `EBAY_DRAFT_ONLY_CLIENT_SECRET`
- `EBAY_DRAFT_ONLY_REFRESH_TOKEN` con scope `sell.inventory`
- Opcional: `EBAY_DRAFT_ONLY_MIN_MARGIN_PERCENT=15`

El botón de ejecución permanece bloqueado mientras falten credenciales o el
feature flag esté desactivado. Activarlo autoriza únicamente la creación del
draft no publicado en Sandbox; no autoriza publicar.

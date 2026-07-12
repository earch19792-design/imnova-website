# EBAY-MARKET-VALIDATION-WITH-RESTRICTION-GUARDS-V1

## Objetivo

Agregar una barrera read-only entre la confirmación humana móvil y la preparación de un listing. La barrera identifica señales textuales de posibles restricciones de envío, hazmat, categoría, salud, bebé, baterías, químicos, marca o compatibilidad.

Este loop no determina si un producto está permitido. Únicamente exige una revisión humana especializada antes de preparar cualquier listing package o intentar B2-RUN.

## Entradas inspeccionadas

El detector combina texto ya disponible en el candidato:

- `title` y `productName`
- categoría textual
- `handle`
- `productType`
- `description`
- texto alternativo o referencia de imagen

La referencia de imagen se trata como texto. No se descarga, copia ni analiza el contenido de la imagen.

## Guardas

- `NEED_SHIPPING_RESTRICTION_REVIEW`
- `NEED_HAZMAT_OR_AEROSOL_REVIEW`
- `NEED_BRAND_REVIEW`
- `NEED_HEALTH_CLAIMS_REVIEW`
- `NEED_BABY_PRODUCT_REVIEW`
- `NEED_BATTERY_OR_LITHIUM_REVIEW`
- `NEED_CHEMICAL_PRODUCT_REVIEW`

Las confirmaciones humanas de identidad, stock, precio Luna e imagen no eliminan estas guardas. Para un candidato restringido, la ruta se mantiene en validación de mercado como `NEED_EBAY_MARKET_VALIDATION_WITH_RESTRICTION_REVIEW`.

## Casos de aceptación

| Producto | Resultado principal |
| --- | --- |
| IT Mega Frizz Hair Spray Bonus, 10 oz. | `AEROSOL_OR_SPRAY`; requiere shipping y hazmat review |
| Blue Rust-Oleum Striping Paint Spray | `PAINT_SPRAY_OR_FLAMMABLE`; requiere shipping y hazmat review |
| Glisten Dishwasher Detergent | `CHEMICAL_PRODUCT_REVIEW` |
| Healthy Origins Vitamin D3 | `HEALTH_CLAIMS_REVIEW` |
| Baby Brezza Sterilizer | `BABY_PRODUCT_REVIEW` |
| RAM Holder | revisión de marca/compatibilidad; no hazmat |
| Paper towel holder | sin guardas de restricción |

## Invariantes de seguridad

- `canProceedToB2RunPreflight` permanece `false`.
- `canPublish` permanece `false`.
- Un riesgo pendiente mantiene `canProceedToListingPackage` en `false`.
- No hay eBay API/write, Supabase write, draft, offer, listing ni publicación.
- No hay secretos, tokens, `.env`, scraper, descarga de imágenes ni integraciones externas.
- La UI solo muestra el resultado calculado localmente y continúa siendo read-only.

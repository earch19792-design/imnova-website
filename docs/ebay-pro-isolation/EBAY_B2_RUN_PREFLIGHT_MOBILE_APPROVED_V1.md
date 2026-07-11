# EBAY-RESUME-B2-RUN-PREFLIGHT — Mobile Approved Listing Package V1

## Why

El Top 50 Ranker recomendó `Reusable Hook and Loop Cable Ties 50 Pack`. El Mobile WhatsApp Approval Center modeló la selección completa: mismo producto confirmado, 20 unidades observadas, referencia visual aceptada y aprobación explícita para preparar B2-RUN Preflight.

Consumir esta aprobación significa convertir esas decisiones humanas en un paquete técnico revisable. No significa autorización para escribir en eBay ni publicar.

## What the mobile approval unlocks

La aprobación móvil completa desbloquea la construcción local de tres previews y sus guardas. Si falta selección, mismo producto, cantidad positiva, revisión visual, aprobación de preflight o el gate móvil, el proceso se bloquea.

## Listing package preview

El listing package preview reúne título, condición, categoría sugerida, precio, rango, quantity solo para preview, stock observado, specifics, pack, descripción, política visual, campos operativos y alias seguro del warehouse. Es una representación técnica para revisión; no es un listing eBay.

## Inventory item payload preview

El inventory item preview modela SKU runtime, condición, producto, aspects, referencia visual no utilizable para write, disponibilidad de preview y peso/dimensiones pendientes. `publish` y `writeExecutionEnabled` son false.

## Offer payload preview

El offer preview modela marketplace, formato fixed price, precio, quantity de preview y dependencias runtime: categoryId, merchant location y business policies. Tampoco ejecuta endpoints ni crea un offer.

## Field sources

- `EBAY_MARKET_OBSERVED`: título, categoría, specifics, descripción, precio y pack.
- `HUMAN_MOBILE_CONFIRMED`: selección, mismo producto, 20 unidades observadas y revisión visual.
- `LUNA_SCAN_OBSERVED_IF_PRESENT`: SKU del proveedor si está disponible.
- `UNKNOWN_FROM_SUPPLIER`: costo no confirmado.
- `TOP50_EBAY_DEMAND_RANKER`: producto y score seleccionados.

## Supplier and stock guards

El costo no se inventa: queda `UNKNOWN_FROM_SUPPLIER` con `LOW_CONFIDENCE_GUARD`. Las 20 unidades son una observación humana y no inventario garantizado; por eso conservan `FINAL_STOCK_REVIEW_REQUIRED_BEFORE_WRITE`.

La quantity `1` existe únicamente en el preview. No define cantidad activa ni autoriza publicación.

## Image review guard

La confirmación móvil indica que la referencia visual sirve para revisión. No autoriza copiar o descargar imágenes y no reemplaza la aprobación final de una imagen propia o autorizada. Generación, descarga y copia permanecen false.

## Runtime checks

Antes de cualquier write futuro todavía faltan:

- categoryId final.
- fulfillment policy.
- return policy.
- payment policy.
- revisión final de stock.
- revisión final de precio.
- aprobación final de imagen.
- aprobación humana final de write.

Por eso la ruta es `READY_FOR_B2_RUN_WRITE_APPROVAL_WITH_RUNTIME_CHECKS`.

## Final write approval gate

El gate queda construido pero cerrado. `canExecuteEbayWrite` y `canPublish` son siempre false en este loop. Una futura aprobación de write deberá validar nuevamente todas las dependencias runtime y usar un runner separado y controlado.

## Connection to the official route

El próximo paso puede diseñar la aprobación final de B2-RUN con sus compuertas, sin asumir que el preflight autoriza ejecución. LOOP 150 seguirá siendo la primera publicación humana aprobada. LOOP 152 reutilizará stock guard, price guard, margin guard y refresh del scan después de listar.

## Safety boundaries

- Sin Production, main, Staging DB o Supabase writes.
- Sin eBay API, OAuth, tokens o endpoints de write.
- Sin draft, listing, offer o publicación real.
- Sin generación, descarga o copia de imágenes.
- Sin WhatsApp/SMS real, scraper, Amazon o OpenAI/Codex API real.
- Sin secretos, `.env`, dumps, imágenes nuevas o dirección completa del warehouse.
- Sin catálogo real ni consulta al almacén.

## Definition of Done

- Aprobación móvil completa consumida.
- Listing, inventory item y offer previews construidos.
- Mapa de procedencia explícito.
- Costo desconocido y stock observado correctamente protegidos.
- Políticas y revisiones runtime declaradas.
- Gate final construido y cerrado.
- Todas las validaciones y regresiones pasan.

## Human explanation rule

El reporte debe explicar que el preflight prepara el paquete, pero no ejecuta ninguna operación en eBay. Debe distinguir datos observados, confirmaciones humanas, datos desconocidos y aprobación futura de write.

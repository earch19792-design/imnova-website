# eBay Runtime Read-only Check RUN V1

Este RUN se inserta antes del primer controlled draft-only write para resolver categoría, policies y merchant location sin modificar eBay. Su modo por defecto es `SAFE_NO_READ`.

El modo real exige aprobación exacta, entorno, marketplace, run ID, presencia booleana del token y confirmación interactiva. Solo usa endpoints `GET`: Taxonomy para categoría, Account para fulfillment/return/payment policies e Inventory para locations. El token vive únicamente en memoria, no se imprime ni se guarda.

La confirmación exacta funciona tanto desde TTY como mediante stdin/pipe. Con el gate aprobado, el runner intenta los GET; una respuesta rechazada se reporta como `READ_ONLY_GET_FAILED_<status>` y nunca como gate ausente.

No inventa valores. Categoría ausente produce `NEED_CATEGORY_RUNTIME_CONFIRMATION`; policies ausentes, `NEED_SELLER_POLICY_RUNTIME_CONFIRMATION`; location ausente, `NEED_INVENTORY_LOCATION_RUNTIME_CONFIRMATION`. `READY_FOR_CONTROLLED_DRAFT_ONLY_REAL_RUN` significa datos resueltos, no autorización de write.

Todas las acciones write, incluido `publishOffer`, están prohibidas. `canExecuteEbayWrite` y `canPublish` permanecen false. No hay OAuth exchange, draft, inventory item, offer, listing, publicación, imágenes, scraper ni integraciones externas adicionales.

Definition of Done: default sin lectura; hard gate exacto; resultados sanitizados; blockers explícitos; tests, TypeScript, regresión y auditoría verdes. LOOP 150 revisará un eventual draft futuro; LOOP 152 solo aplica después de una publicación activa autorizada por otro flujo.

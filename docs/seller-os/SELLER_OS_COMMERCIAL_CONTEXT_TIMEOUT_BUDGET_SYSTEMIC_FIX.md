# Commercial Context: timeout budget fix

Resultado global: **PARTIAL**. El fix de Commercial Context pasa código y canary físico; la estabilidad de Product Case mantiene bloqueada la alineación. El relay conectado no cambió.

## Resultado verificable

- Commit desplegado: `9bb108f434fcb3b42b61cceabdefaecab8ba1c6f`.
- Preview: `dpl_CuzihvPHJPDBgXYhWL4qoA7JWM8W`.
- Presupuesto interno: 18.000 ms; eBay: 12.000 ms; DB: 6.000 ms concurrentes; MCP: 30.000 ms sin cambios.
- Canary predefinido: 8/8 dentro de 30 s, 0 timeouts; P50 715 ms, P95/máximo 7.374 ms (nearest-rank).
- Dos adquisiciones sin reutilizar snapshot, seis respuestas reutilizadas. La ventana supera seis minutos; no se afirma que cada instancia haya agotado su TTL.
- Catálogo: 28/28. Matriz compartida: 21/21. Golden: PARTIAL, 25/25 campos materiales iguales en dos comparaciones posteriores.
- Runtime conectado: HEALTHY, catálogo 28, binding MATCHED; mismos PIDs, cero reinicios.
- Autenticación, Deployment Protection, límites de sólo lectura y Product Truth: sin cambios.
- `SAFE_TO_ALIGN_RELAY_NEXT=false`.

## Causa y corrección

La ruta anterior esperaba primero hasta 24 s por eBay y luego iniciaba lecturas DB sin deadline global. Las olas secuenciales y el backoff del SDK podían superar el límite MCP. El tiempo exacto y los contadores internos del fallo original no se capturaron: sólo está demostrado que agotó los 30 s; no se inventaron métricas retrospectivas.

Ahora:

```text
Commercial Context / snapshot existente
├─ eBay ≤12 s: órdenes e inventario independientes de discovery
├─ DB ≤6 s: autoridades independientes concurrentes
│  ├─ supplies espera sólo identidad registry/linkage
│  └─ order lines espera sólo orders
└─ proyección existente de la evidencia capturada → MCP <30 s
```

Se reutilizan autoridades y snapshots existentes. La guía Supabase orientó el transporte cancelable de sólo lectura, sin cambiar autenticación: aborta también transferencia del cuerpo y suprime retries automáticos 520/network en esta ruta acotada. Las limitaciones permanecen explícitas y no se convierten en cero.

En la corrida 5, `listing_commercial_snapshots` y `market_radar_latest_variants` alcanzaron su deadline; la respuesta llegó en 7.374 ms y mantuvo órdenes, experimentos y observaciones stock independientes. La dependencia más lenta observada fue `listing_commercial_snapshots`, 5995 ms. Las adquisiciones registraron 11 llamadas externas cada una y 18/17 lecturas DB completadas al emitir el snapshot, sin retries de account traffic. Los aborts que terminan después de la emisión no están incluidos en ese contador.

## Bloqueo restante, sin ocultar intentos fallidos

Product Case devolvió un HTTP 502 (`SELLER_OS_CLOUD_READ_RELAY_SOURCE_READ_FAILED`) y agotó un deadline MCP de 30 s en otra comparación. Después pasó en la matriz completa y en dos comparaciones pareadas: 3.626 ms y 1.496 ms, ambas 25/25. El Preview corregido anterior pasó las dos lecturas de control en 3.683 ms y 2.246 ms. El informe de recuperación previo ya mencionaba un fallo Golden inicial.

Esto no demuestra la causa exacta ni elimina la intermitencia. La atribución a una nueva regresión es UNPROVEN. El log existente sanea el error interno; no se modificó Product Truth ni se ampliaron permisos para investigarlo. El resultado global queda PARTIAL y la alineación sigue bloqueada hasta certificar la estabilidad de esa lectura.

El chequeo inicial del watchdog coincidió con su ejecución y devolvió DEGRADED; las dos lecturas posteriores fueron HEALTHY sin reinicios. Ambas observaciones se preservan en el JSON.

## Regresión y seguridad

Las nueve guardas solicitadas pasan, además de TypeScript, 99 pruebas del coordinador, suites runtime/gateway/relay/transporte, enlace Luna, audit-observability y guardas de sólo lectura. El catálogo coincide por nombres, schemas y anotaciones. Las pruebas de auth devuelven 401 sin protección o sin HMAC y 400 para una operación firmada fuera de allowlist.

No hubo migraciones, escrituras de negocio, cambios de configuración MCP/Tunnel, credenciales o protección. Sólo se creó un Preview protegido del mismo proyecto y entorno; no se promovió Production. Los archivos ajenos ya modificados en el workspace se preservaron.

## Paridad Golden

Comparación endpoint certificado vs relay candidato: FIELD, VALUE, SEMANTIC_CLASS, EVIDENCE_STATUS y SOURCE_AUTHORITY. Las 25 filas coinciden; los valores proceden de la lectura normal, no de introducción manual.

| FIELD | VALUE | SEMANTIC_CLASS | EVIDENCE_STATUS | SOURCE_AUTHORITY | Paridad |
| --- | --- | --- | --- | --- | --- |
| LUNA_PRODUCT_ID | "9266387058912" | FACT | PROVEN | SUPPLIER | MATCH |
| LUNA_VARIANT_ID | "48907793826016" | FACT | PROVEN | SUPPLIER | MATCH |
| SUPPLIER_SKU | "ITEM1046" | FACT | PROVEN | SUPPLIER | MATCH |
| TITLE | "U.S. Kitchen 4 Piece Set - Stainless Steel Round Mesh Strainers With Wide Ears" | FACT | PROVEN | SUPPLIER | MATCH |
| BRAND | null | MISSING | MISSING | SUPPLIER | MATCH |
| MODEL | null | MISSING | MISSING | SUPPLIER | MATCH |
| MATERIAL | "Stainless Steel" | FACT | PROVEN | SUPPLIER | MATCH |
| COLOR | "Silver" | FACT | PROVEN | SUPPLIER | MATCH |
| DIMENSIONS | null | MISSING | MISSING | SUPPLIER | MATCH |
| SIZE_SET | [{"UNIT":"in","RAW_VALUE":"3\"","SOURCE_EVIDENCE":["sha256:52bf10b6a4bae810f27e71a9594c436b98011aa6493b4d8e6f0bf4337f77becb"],"NORMALIZED_VALUE":3,"ORDINAL_OR_SET_MEMBERSHIP":1},{"UNIT":"in","RAW_VALUE":"4\"","SOURCE_EVIDENCE":["sha256:52bf10b6a4bae810f27e71a9594c436b98011aa6493b4d8e6f0bf4337f77becb"],"NORMALIZED_VALUE":4,"ORDINAL_OR_SET_MEMBERSHIP":2},{"UNIT":"in","RAW_VALUE":"5.5\"","SOURCE_EVIDENCE":["sha256:52bf10b6a4bae810f27e71a9594c436b98011aa6493b4d8e6f0bf4337f77becb"],"NORMALIZED_VALUE":5.5,"ORDINAL_OR_SET_MEMBERSHIP":3},{"UNIT":"in","RAW_VALUE":"8\"","SOURCE_EVIDENCE":["sha256:52bf10b6a4bae810f27e71a9594c436b98011aa6493b4d8e6f0bf4337f77becb"],"NORMALIZED_VALUE":8,"ORDINAL_OR_SET_MEMBERSHIP":4}] | FACT | PROVEN | SUPPLIER | MATCH |
| WEIGHT | {"UNIT":"g","NORMALIZED_VALUE":363} | FACT | PROVEN | SUPPLIER | MATCH |
| PACKAGE_CONTENTS | [{"UNIT":null,"RAW_VALUE":"4 Piece Set - Stainless Steel Round Mesh Strainers With Wide Ears","SOURCE_EVIDENCE":["sha256:6ea640a1e15f458a9afac29462343bbb4e98688c296d96fed95a92e17190eada"],"NORMALIZED_VALUE":"4 Piece Set - Stainless Steel Round Mesh Strainers With Wide Ears","ORDINAL_OR_SET_MEMBERSHIP":1}] | FACT | PROVEN | SUPPLIER | MATCH |
| QUANTITY_OR_SET_COUNT | 4 | FACT | PROVEN | SUPPLIER | MATCH |
| FORM_FACTOR | "Wide ear resting support" | FACT | PROVEN | SUPPLIER | MATCH |
| FEATURES | ["4 Essential Sizes: Includes 3\", 4\", 5.5\", and 8\" strainers for small to large kitchen tasks.","Dishwasher safe","Durable & Easy to Clean: Dishwasher-safe construction with sealed steel rims to prevent food from getting trapped.","Fine Mesh Stainless Steel: Rust-resistant mesh efficiently strains liquids and sifts dry ingredients.","Multi-Purpose Kitchen Tool: Ideal for sifting flour, straining sauces, rinsing fruits, vegetables, grains, and pasta.","Wide Ear Design: Provides stable resting support on bowls, pots, or sinks for hands-free straining."] | SUPPLIER_CLAIM | UNPROVEN | SUPPLIER | MATCH |
| INTENDED_USES | ["Draining pasta or canned foods","Rinsing rice, quinoa, vegetables, and fruits","Sifting flour, cocoa powder, and powdered sugar","Straining sauces, broths, and juices"] | FACT | PROVEN | SUPPLIER | MATCH |
| GTIN | null | MISSING | MISSING | SUPPLIER | MATCH |
| MPN | null | MISSING | MISSING | SUPPLIER | MATCH |
| SUPPLIER_COST | 4 | FACT | PROVEN | SUPPLIER | MATCH |
| REGULAR_PRICE | 8.39 | FACT | PROVEN | SUPPLIER | MATCH |
| SALE_PRICE | 4 | FACT | PROVEN | SUPPLIER | MATCH |
| SUPPLIER_AVAILABILITY | "AVAILABLE" | FACT | PROVEN | SUPPLIER | MATCH |
| SUPPLIER_STOCK | null | MISSING | MISSING | SUPPLIER | MATCH |
| IMAGES | [{"CAPTURED_AT":"2026-09-07T09:00:22.856+00:00","IMAGE_ORDINAL":1,"SOURCE_IMAGE_URL":"https://cdn.shopify.com/s/files/1/0798/2520/7520/files/Kitchen-Supply-Set-of-4-Fine-Mesh-Stainless-Steel-Strainers-with-Wide-Ear-Design-3-4-5-5-8_e4e78a77-835a-4a76-8673-0facc3e50e8f.8065828387399fa15f2ab5765858026f.avif?v=1772911145","VARIANT_ASSOCIATION_IF_PROVEN":null},{"CAPTURED_AT":"2026-09-07T09:00:22.856+00:00","IMAGE_ORDINAL":2,"SOURCE_IMAGE_URL":"https://cdn.shopify.com/s/files/1/0798/2520/7520/files/8ca7f452-6c4c-466b-91cd-2c1393cb3c5a.4de41ed7466b2a65dfb7ecda0203a6ae.webp?v=1772911145","VARIANT_ASSOCIATION_IF_PROVEN":null},{"CAPTURED_AT":"2026-09-07T09:00:22.856+00:00","IMAGE_ORDINAL":3,"SOURCE_IMAGE_URL":"https://cdn.shopify.com/s/files/1/0798/2520/7520/files/4defcfda-6961-4053-91ed-8c43f56b036e.b8f39a3a1a88ff3adf8d655e377e171a.webp?v=1772911145","VARIANT_ASSOCIATION_IF_PROVEN":null},{"CAPTURED_AT":"2026-09-07T09:00:22.856+00:00","IMAGE_ORDINAL":4,"SOURCE_IMAGE_URL":"https://cdn.shopify.com/s/files/1/0798/2520/7520/files/b86404fb-5838-43e0-b023-cd80602bcdaf.72d5c29810d362ad9484001e0ddeef91.webp?v=1772911145","VARIANT_ASSOCIATION_IF_PROVEN":null},{"CAPTURED_AT":"2026-09-07T09:00:22.856+00:00","IMAGE_ORDINAL":5,"SOURCE_IMAGE_URL":"https://cdn.shopify.com/s/files/1/0798/2520/7520/files/b37ea7cb-3045-4dd0-94dd-13d85596f8fe.ae193493453d04da15e158727f5c3b50.webp?v=1772911145","VARIANT_ASSOCIATION_IF_PROVEN":null}] | FACT | PROVEN | SUPPLIER | MATCH |
| VARIANT_OPTIONS | [{"RAW_VALUE":"Default Title","SOURCE_FIELD":"option1","NORMALIZED_VALUE":"Default Title","ORDINAL_OR_SET_MEMBERSHIP":1}] | FACT | PROVEN | SUPPLIER | MATCH |

El [JSON completo](./SELLER_OS_COMMERCIAL_CONTEXT_TIMEOUT_BUDGET_SYSTEMIC_FIX_RESULT.json) conserva todos los intentos, presupuestos, contadores, sourceReaders, matriz de herramientas y comparación campo a campo. No se avanzó Keyword Intelligence. E2E_CERTIFIED=false.

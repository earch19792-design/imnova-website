# Mayel — cierre rápido de blockers de evidencia

La corrección del lector Shipping está desplegada en el proyecto dedicado de preprod. El cierre comercial permanece **BLOQUEADO**: la única solicitud de captura pasó el vínculo exacto y devolvió `LUNA_REAUTH_REQUIRED`; el estado sanitizado confirma `SESSION_EXPIRED`. Además, no están demostradas las comisiones completas ni existe un candidato con muestra comercial suficiente en el conjunto LIVE inspeccionado.

Implementación: `40d4ea46007b3d04220a1041756c1308ddbd7e49`. Deployment: `dpl_MHdfK7iCxvDjJy3NpQkbjfEh1e87`, estado `READY`, proyecto `imnova-seller-os-preprod`. No se modificó producción, no se publicaron listings y no se hicieron writes Ads.

## Shipping: causa y corrección

`SHIPPING_DUPLICATE_ROOT_CAUSE=READER_SCOPE_ERROR`. El reader rechazaba dos representaciones del mismo listing en `ebay_active_listings`: la presencia LIVE actual obtenida por GetMyEbaySelling y una lectura GetItem anterior. Las dos cotizaciones históricas de Shipping son registros diferentes: ambas están vencidas y la tabla no tiene un flag `active`. Ya existía un único job de autoridad Shipping con restricción UNIQUE por cuenta, marketplace, item y tipo de evidencia.

La corrección reconoce exclusivamente un par con ambas autoridades conocidas, SKU e item idénticos al vínculo aprobado, fecha LIVE posterior, IDs distintos y correspondencia exacta con producto/variante/SKU Luna. Múltiples presencias actuales, fechas empatadas o futuras, fuentes desconocidas y conflictos de vínculo siguen bloqueados. La selección devuelve un receipt con la fila elegida, la representación histórica excluida y la razón; no inactiva ni elimina historia. El límite del reader es tres filas, suficiente para rechazar más de dos.

Los contadores **no son intercambiables**:

| Medida | Antes | Después |
|---|---:|---:|
| Representaciones físicas de listing marcadas active | 2 | 2 |
| Autoridades LIVE resueltas para capturar Shipping | 0: reader rechazaba el par | 1 |
| Jobs de autoridad Shipping | 1 | 1 |
| Cotizaciones históricas | 2 | 2 |
| Cotizaciones frescas | 0 | 0 |

No se declara `ACTIVE_SHIPPING_ROW_COUNT=1` como prueba de Shipping fresco. El job continúa `STALE`, sin cambiar su generación ni su puntero. La unicidad existente y la nueva validación impiden tratar representaciones ambiguas como autoridades simultáneas.

### Auditoría read-only

Cuenta: `imnova-ebay-us-primary:cd8fd3dc2b4102d4aff320268c647fa895c6416df01013f9bb06b3a587709e12`.
Marketplace: `EBAY_US`. Item: `366650054490`. eBay SKU: `IMNOVAA59C2C921CDD4975ADD29540657D8A60`.
Luna producto/variante: `9220846354656` / `53002142286048`. SKU proveedor: `FL-NHRN1999804-Color-silver-bracelet`.

#### Cotizaciones históricas

```json
[
  {
    "row_id": "live-listing-luna-shipping-v1:sha256:eee1b5039f9f086ac94ed7113f76a2abd0086ff7c16e95188dee5626758abd72",
    "account_key": "imnova-ebay-us-primary:cd8fd3dc2b4102d4aff320268c647fa895c6416df01013f9bb06b3a587709e12",
    "marketplace_id": "EBAY_US",
    "ebay_item_id": "366650054490",
    "linkage_id": "luna-linkage-v1:sha256:dd8b3869347250f18bbcaf11e578e4fb7b4fccbc8aebbf392dc194f4368f040c",
    "luna_product_id": "9220846354656",
    "luna_variant_id": "53002142286048",
    "source_sku": "FL-NHRN1999804-Color-silver-bracelet",
    "job_id": null,
    "generation": null,
    "status": "STALE",
    "shipping_cost": "6.99",
    "captured_at": "2026-09-08 23:02:31.173+00",
    "fresh_until": "2026-09-09 05:02:31.173+00",
    "source_authority": "LUNA_AUTHENTICATED_HTTP_CART_SHIPPING",
    "source_evidence_digest": "sha256:b5bfd49bf934f4b485b95a1c47c4edbd95b1747e1b9e796e8d61e771fa36e736",
    "created_at": "2026-09-08 23:02:31.207884+00",
    "updated_at": null
  },
  {
    "row_id": "live-listing-luna-shipping-v1:sha256:6cd44c477722aa694e2d635df1d3c9fceb4b355669a03ef4b36adaae67d7a2d5",
    "account_key": "imnova-ebay-us-primary:cd8fd3dc2b4102d4aff320268c647fa895c6416df01013f9bb06b3a587709e12",
    "marketplace_id": "EBAY_US",
    "ebay_item_id": "366650054490",
    "linkage_id": "luna-linkage-v1:sha256:dd8b3869347250f18bbcaf11e578e4fb7b4fccbc8aebbf392dc194f4368f040c",
    "luna_product_id": "9220846354656",
    "luna_variant_id": "53002142286048",
    "source_sku": "FL-NHRN1999804-Color-silver-bracelet",
    "job_id": null,
    "generation": null,
    "status": "STALE",
    "shipping_cost": "6.99",
    "captured_at": "2026-09-07 08:23:23.328+00",
    "fresh_until": "2026-09-07 14:23:23.328+00",
    "source_authority": "LUNA_AUTHENTICATED_HTTP_CART_SHIPPING",
    "source_evidence_digest": "sha256:92d3c8f078c7ff85c9bea4561b4eb6f01f96db52f60ff5f2bb347a1b1c7b26d8",
    "created_at": "2026-09-07 08:23:23.600451+00",
    "updated_at": null
  }
]
```

#### Representaciones LIVE

```json
[
  {
    "row_id": "7e1933b1-cbcc-4b7b-903a-04a5448845ac",
    "account_key": "imnova-ebay-us-primary:cd8fd3dc2b4102d4aff320268c647fa895c6416df01013f9bb06b3a587709e12",
    "ebay_item_id": "366650054490",
    "ebay_sku": "IMNOVAA59C2C921CDD4975ADD29540657D8A60",
    "source": "EBAY_TRADING_GET_MY_EBAY_SELLING",
    "listing_status": "active",
    "sync_generation": 0,
    "sync_run_id": "edad2237-80ef-4768-a34c-c79533080f4a",
    "last_ebay_sync_at": "2026-09-09 16:50:02.373+00",
    "created_at": "2026-09-08 23:50:08.592308+00",
    "updated_at": "2026-09-09 16:50:02.373+00",
    "supplier_variant_id": null,
    "supplier_sku": null
  },
  {
    "row_id": "54e498d9-6a04-4714-a058-01cf231b45aa",
    "account_key": "imnova-ebay-us-primary:cd8fd3dc2b4102d4aff320268c647fa895c6416df01013f9bb06b3a587709e12",
    "ebay_item_id": "366650054490",
    "ebay_sku": "IMNOVAA59C2C921CDD4975ADD29540657D8A60",
    "source": "EBAY_TRADING_GET_ITEM_READONLY",
    "listing_status": "active",
    "sync_generation": 0,
    "sync_run_id": null,
    "last_ebay_sync_at": "2026-09-05 03:08:04.862+00",
    "created_at": "2026-09-05 03:08:04.925525+00",
    "updated_at": "2026-09-05 03:08:07.075136+00",
    "supplier_variant_id": "53002142286048",
    "supplier_sku": "FL-NHRN1999804-Color-silver-bracelet"
  }
]
```

#### Job único

```json
[
  {
    "job_id": "9ff772e6-6731-40fd-a323-2b7b4a6296e0",
    "marketplace_account_key": "imnova-ebay-us-primary:cd8fd3dc2b4102d4aff320268c647fa895c6416df01013f9bb06b3a587709e12",
    "marketplace_id": "EBAY_US",
    "ebay_item_id": "366650054490",
    "evidence_type": "LUNA_CURRENT_SHIPPING",
    "status": "STALE",
    "last_evidence_id": "economic-evidence-v1:sha256:ea82372a51f0e2d073dfc2892f0f1bbd3d1f0e9f4b6ef96b40cdab492232e0e5",
    "failure_class": null,
    "source_identity": {
      "sku": "IMNOVAA59C2C921CDD4975ADD29540657D8A60",
      "itemId": "366650054490",
      "currency": "USD",
      "linkageId": "luna-linkage-v1:sha256:dd8b3869347250f18bbcaf11e578e4fb7b4fccbc8aebbf392dc194f4368f040c",
      "livePrice": 18.74,
      "sourceSku": "FL-NHRN1999804-Color-silver-bracelet",
      "productUrl": "https://lunaportex.com/products/bohemian-style-colorful-retro-devil-eyes-necklace-bracelet-anklet-combination-accessories-2",
      "lunaProductId": "9220846354656",
      "lunaVariantId": "53002142286048",
      "liveObservedAt": "2026-09-09T07:37:23.081Z",
      "linkageDecision": "APPROVE_EXACT_LINKAGE"
    },
    "shipping_freshness_generation": "economic-shipping-refresh-v1:sha256:df3e81aa66b28ad6c4e36a76a81bd1dd140047c34e9cbd3408445baabfe19315",
    "shipping_required_evidence_after": "2026-09-08 22:52:25.467+00",
    "shipping_legacy_recovery_generation": "economic-shipping-legacy-recovery-v1:sha256:789748cfed2a8e7fffbb3d4ef1636391e2d4d0e46096fdc9f9ebbd4080abb348",
    "attempt_count": 21,
    "first_detected_at": "2026-09-06 10:30:35.319+00",
    "last_detected_at": "2026-09-09 07:37:22.187+00",
    "updated_at": "2026-09-09 07:37:22.187+00"
  }
]
```

Las cotizaciones no tienen columnas job_id, generation ni updated_at; esos campos aparecen explícitamente como null. El job y sus generaciones se muestran por separado para evitar atribuirles relaciones inventadas. Se preservó la generación histórica existente y no se invocó recuperación Legacy ni de cohortes.

### Única solicitud física

- Endpoint: `/api/admin/ebay/operational-readiness`, acción `CAPTURE_LIVE_LISTING_SHIPPING_EVIDENCE`.
- Inicio: `2026-09-09T17:09:56.665Z`. HTTP `400`. Código `LUNA_REAUTH_REQUIRED`.
- Identificador de solicitud del cliente: `4955b05f-c3a7-4d92-8567-9e49ab07428b`.
- Auth y vínculo exacto superados: ese error se devuelve después del resolver de identidad y antes de obtener la cotización.
- Readback de sesión: HTTP `200`, `SESSION_EXPIRED`, Vault, `humanBootstrapRequired=true`; sin secretos, cookies ni valores de entorno en evidencia.
- Una solicitud de captura; cero cotizaciones frescas. No se repitió la solicitud.
- Comparación estructural antes/después: cotizaciones y job idénticos, historia preservada.

La siguiente acción Shipping es renovar la sesión mediante [Sesión Luna protegida en preprod](https://imnova-seller-os-preprod.vercel.app/admin/ebay/luna-protected-session). El usuario debe completar el handoff autorizado en Chrome; no se solicitan contraseñas ni cookies. El OWNER inició la renovación en preprod a las `2026-09-09T17:15:12.460Z`: solicitud `a778e8d1-8baa-4e19-9962-a69130c4599f`. El readback de las `17:20:05.827Z` la encuentra `PENDING`, `claimed_at=null`, `completed_at=null`. Pulsar Renovar crea el desafío; falta **Transferir sesión a Seller OS** desde la extensión. Tras disponer de SESSION_READY, falta realizar y certificar la captura fresca y su consumo económico.

## Comisiones y política OWNER

El coste demostrado de producto es USD 1.79. Shipping histórico: USD 6.99, vencido a las `2026-09-09T05:02:31.173Z`; no se presenta como Shipping vigente. Precio observado: USD 18.74.

La autoridad de fees existente devuelve `OFFICIAL_CATEGORY_FEE_POLICY_NOT_CERTIFIED`, categoría `50692`, suscripción observada `NO_STORE`. No hay importe completo demostrado. Tres de los 23 listings tienen importes de modelo base anterior, pero ninguno reúne el handoff exacto READY y esos importes tampoco prueban todos los cargos variables.

La [documentación oficial eBay](https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4822) vincula la comisión a una base que puede incluir impuestos y shipping del comprador, y a condiciones de cuenta/venta. Una tabla publicada no prueba por sí sola el importe aplicable. Faltan base completa, contexto de orden y aplicabilidad de modificadores materiales. No se añadieron porcentajes al código. El [contrato oficial Finances](https://developer.ebay.com/api-docs/sell/static/finances/transaction-info.html) puede aportar readback de operaciones realizadas; no hay una operación exacta con todos sus fees en la evidencia inspeccionada. El detalle de componentes desconocidos está en `feeAudit` del JSON.

La [política OWNER V1](owner-variable-cost-policy-v1.json) queda registrada: cero otros costes variables es una confirmación explícita, no una suposición. Aplica sólo a listings con producto, shipping y fees demostrados. No se prorratea overhead ni se convierte este permiso condicionado en economía válida para un listing aún incompleto.

`EBAY_FEES_COMPLETE=false`, `ECONOMICS_PROVEN=false`. Beneficio, margen y tasa Ads máxima segura permanecen null. La política de simulación 3–5% no se certifica físicamente con componentes faltantes.

## Métricas y selección

Se inspeccionaron 23 listings LIVE mediante páginas acotadas y hasta doce snapshots por listing: 276 registros de la misma ventana de 30 días, del 10 de agosto al 8 de septiembre inclusive. Los snapshots repetidos no multiplican la muestra. No se hallaron ventanas exactas 7D o 24H ni historia previa independiente en las fuentes inspeccionadas.

El conjunto registra 82 views, máximo individual 14 y cero transacciones. Entre los cuatro candidatos con vínculo exacto y decisión durable READY, `366650054490` tiene 298 impresiones, tres views y cero transacciones. El numerador/denominador del CTR calculado por la fuente es 2/265: se conserva distinto de las impresiones totales.

No se declara automáticamente la mediana de una tienda heterogénea como baseline comparable. No se inventa OWN_HISTORY, category baseline ni benchmarks. Los intervalos exploratorios reproducibles en el notebook muestran incertidumbre; no crean umbrales globales.

`NO_SUFFICIENT_METRICS_CANARY_AVAILABLE=true`, `METRIC_SAMPLE_SUFFICIENT=false`, `TREATMENT=TEST`. El item es candidato de investigación, no un canary comercial certificado. No se forzó otro listing ni se esperó artificialmente a generar datos.

## Alcance preservado y validación

Keyword V2.1 continúa `ACCEPTED`, consumidor certificado, sin fallback legacy. Listing Quality y la experiencia Mayel no se rediseñaron. El paquete/Preview previamente certificado se preserva; no se reetiqueta como un nuevo canary comercial completo. No se ejecutó un nuevo tratamiento ni se escribió un receipt que sugiera una acción inexistente.

- Pruebas Shipping: 13 PASS; incluyen 13 variantes de ambigüedad/conflicto rechazadas antes de capturar.
- Suite Seller OS: 376 archivos PASS, cero fallos y cero skips.
- Typecheck, lint, build, auditoría y seguridad dirigida: PASS sobre el SHA de implementación; workspace sin cambios durante certificación.
- Nuevas regresiones observadas: 0.
- Nuevos pollers, workers, scans globales, exact counts y SELECT *: 0.
- Writes marketplace: 0; writes eBay Ads: 0; cambios a producción: 0.
- `ASSISTANT_CLOSEOUT=false`; canaries de publicación y Ads no certificados por este cierre.

[Evidencia íntegra con consultas, IDs, fechas, readbacks y receipt de validación](assistant-revenue-evidence-blockers-fast-closeout-v1-readback.json). [Notebook reproducible sin llamadas de red](assistant-revenue-evidence-blockers-fast-closeout-v1.ipynb).

## Ayuda para Mayel

En Mayel está disponible **Ayuda / Manual**, junto a la navegación, sin añadir una quinta acción principal. Abre una guía sencilla en otra pestaña para consultarla mientras trabaja. El menú conserva Mejorar listings, Impulsar ventas, Publicar y Oportunidades.

El [Manual de Mayel](https://imnova-seller-os-preprod.vercel.app/manual-mayel-menu-v1.pdf) respondió HTTP 200; sus 402923 bytes coinciden con el PDF certificado. Preparar un Preview o una simulación no publica ni activa publicidad. Si Mayel indica que faltan datos, hay que completar esa evidencia antes de impulsar.

## Readback después de la confirmación OWNER

A las `2026-09-09T17:24:38.945Z`, el runtime preprod todavía informa `SESSION_EXPIRED`. A las `17:24:49.654Z`, la solicitud más reciente `82577167-40cc-4a6c-bb19-e575783c30f3`, creada a las `17:23:54.159Z`, permanece `PENDING`, sin claim ni finalización. Las solicitudes anteriores fueron sustituidas explícitamente; no se detecta una transferencia completada. No se volvió a intentar Shipping.

El contrato de la extensión exige que la pestaña activa sea la pantalla protegida de Seller OS y primero se pulse **Comprobar conexión**. Se corrigieron las instrucciones al OWNER y se solicitó el mensaje exacto de la extensión para localizar el fallo anterior al backend; no se atribuye una causa de UI sin ese dato.

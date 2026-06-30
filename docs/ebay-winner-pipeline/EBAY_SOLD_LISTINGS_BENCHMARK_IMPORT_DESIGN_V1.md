# eBay Sold Listings Benchmark Import Design V1

## 1. Proposito

Este documento disena como IMNOVA podra capturar o importar datos de sold listings y benchmarks de eBay sin depender de copiar manualmente listings completos.

Este documento es:

- documentation-only
- sin implementacion
- sin eBay API connection
- sin OAuth
- sin tokens
- sin scraping
- sin browser automation
- sin drafts reales
- sin publicacion
- sin listing mutation
- sin Supabase
- sin SQL
- sin OpenAI
- sin imagenes generadas

No conecta eBay, no usa autorizacion real, no importa datos reales, no copia contenido de competidores y no modifica listings.

## 2. Problema actual

El filtro `Show only -> Sold items` permite ver listings vendidos.

`Sell one like this` puede acelerar una referencia estructural.

Pero copiar manualmente toda esa informacion en IMNOVA no escala.

El objetivo no es copiar competidores. El objetivo es aprender estructura, patrones y datos de mercado para crear un listing original, verificado y compliant.

## 3. Principio profesional

Regla central:

```text
Use sold listings as benchmark data. Do not copy competitor content.
```

Reglas:

- no copiar fotos
- no copiar titulo literal
- no copiar descripcion literal
- no copiar claims no verificados
- no copiar trust badges no verificados
- no copiar branding de seller
- crear listing original, verificado y compliant

El benchmark debe informar decisiones. No debe convertirse en duplicacion de contenido ajeno.

## 4. Flujo objetivo futuro

Flujo objetivo:

```text
eBay Sold Items / Terapeak / Seller Hub -> Benchmark Import -> Benchmark Review -> Listing Package QA -> Human Approval
```

El import futuro debe alimentar:

- title pattern insights
- category confirmation
- item specifics
- sold price range
- competition view
- shipping/returns benchmark
- image sequence benchmark
- pack/bundle opportunities

El flujo debe ser read-only primero. Cualquier accion de draft, publicacion o mutacion queda fuera de este diseno.

## 5. Modos de adquisicion recomendados

Opciones en orden profesional:

1. `ebay_only_connector_or_api_if_supported`

   Preferido a futuro.

   Solo con autorizacion.

   Solo lectura primero.

   No drafts.

   No publicacion.

2. `seller_hub_or_terapeak_export_if_available`

   Si eBay permite exportar o consultar datos desde Seller Hub/Terapeak.

   Import estructurado.

3. `structured_admin_import`

   Usuario pega pocos campos esenciales en un formulario controlado.

   No full-copy.

4. `minimal_human_review_fallback`

   Solo revision humana resumida.

   No copiar listing entero.

Prohibido:

- scraping
- browser automation
- copiar contenido protegido
- importar fotos de competidores
- usar datos no autorizados

## 6. Data contract conceptual

Tipo conceptual:

```ts
type EbaySoldListingBenchmarkImport = {
  benchmarkVersion: "EBAY_SOLD_LISTINGS_BENCHMARK_IMPORT_DESIGN_V1";
  sourceMode:
    | "ebay_only_connector_or_api_if_supported"
    | "seller_hub_or_terapeak_export_if_available"
    | "structured_admin_import"
    | "minimal_human_review_fallback";
  acquisitionStatus:
    | "BENCHMARK_NOT_IMPORTED"
    | "BENCHMARK_IMPORT_DESIGNED"
    | "BENCHMARK_IMPORTED_FOR_REVIEW"
    | "BENCHMARK_REVIEWED";
  caseId: string;
  searchQuery: string;
  marketplace: "ebay_us";
  benchmarkItems: EbaySoldListingBenchmarkItem[];
  aggregateInsights: EbaySoldListingBenchmarkInsights;
  safetyFlags: EbaySoldListingBenchmarkSafetyFlags;
};
```

Este tipo no se crea en codigo en este loop. Solo define el contrato futuro.

## 7. Benchmark item conceptual

Tipo conceptual:

```ts
type EbaySoldListingBenchmarkItem = {
  benchmarkItemId: string;
  soldPriceUsd?: number;
  soldDateRange?: string;
  titlePattern?: string;
  categoryName?: string;
  condition?: string;
  itemSpecificsObserved?: string[];
  shippingPolicyObserved?: string;
  returnsPolicyObserved?: string;
  imageCount?: number;
  imageSequenceObserved?: string[];
  bundleOrPackFormat?: string;
  variationStrategyObserved?: string;
  trustSignalsObserved?: string[];
  notesForHumanReview: string[];
  mustNotCopyContent: true;
};
```

Reglas:

- no guardar fotos de competidor
- no guardar descripciones completas copiadas
- no guardar URLs reales en este diseno
- no guardar seller private data

## 8. Aggregate insights conceptual

Tipo conceptual:

```ts
type EbaySoldListingBenchmarkInsights = {
  averageSoldPriceUsd?: number;
  priceRangeUsd?: {
    min?: number;
    max?: number;
  };
  commonTitlePatterns: string[];
  commonItemSpecifics: string[];
  commonImageSequence: string[];
  commonShippingSignals: string[];
  commonReturnSignals: string[];
  packOrBundleOpportunities: string[];
  recommendedListingAdjustments: string[];
  missingDataForImnovaListing: string[];
};
```

Estos insights deben resumir patrones. No deben almacenar contenido de competidor como texto copiado.

## 9. Safety flags conceptual

Tipo conceptual:

```ts
type EbaySoldListingBenchmarkSafetyFlags = {
  advisoryOnly: true;
  readOnly: true;
  ebayApiUsed: boolean;
  oauthUsed: boolean;
  realDraftCreated: false;
  publishedToEbay: false;
  listingMutated: false;
  competitorContentCopied: false;
  competitorPhotosCopied: false;
  scrapingUsed: false;
  browserAutomationUsed: false;
  humanReviewRequired: true;
};
```

En este loop todos siguen como diseno conceptual, no ejecucion.

## 10. Relacion con Sell One Like This

`Sell one like this` puede servir como referencia estructural.

No debe usarse para copiar contenido.

Puede orientar:

- categoria
- item specifics
- formato
- estructura de galeria
- patron de pack o variante

Reglas:

- el titulo debe reescribirse desde cero
- la descripcion debe reescribirse desde cero
- las fotos deben ser propias o aprobadas
- shipping/returns deben verificarse con nuestra operacion
- el precio debe validarse contra margen propio
- claims y trust signals deben verificarse desde datos propios

## 11. Relacion con Terapeak

Terapeak sigue siendo fuente clave para:

- ventas reales
- precio promedio
- sell-through
- competencia
- margen

Sold listings benchmark complementa Terapeak. No lo reemplaza.

Antes de publicar, el listing package debe tener Terapeak validation y benchmark review.

## 12. Relacion con Listing Package

`tools/fixtures/ebay-first-listing-package-v1.json` ya tiene:

- `soldListingsBenchmarkStrategy`
- `manualCopyNotScalable`
- preferred future acquisition mode
- recommended next loop

Este documento define el diseno mas amplio para implementar eso despues.

## 13. Estados futuros

Estados futuros:

- `SOLD_BENCHMARK_NOT_STARTED`
- `SOLD_BENCHMARK_REQUIRED`
- `SOLD_BENCHMARK_IMPORT_DESIGNED`
- `SOLD_BENCHMARK_IMPORTED_FOR_REVIEW`
- `SOLD_BENCHMARK_REVIEWED`
- `SOLD_BENCHMARK_BLOCKED`

Estos estados deben mantener el flujo en revision humana hasta que los datos esten verificados.

## 14. Reglas de publicacion

Listing no puede pasar a ready-to-publish si:

- no hay Terapeak validation
- no hay benchmark review
- no hay margin validation
- no hay product facts verificados
- se copiaron fotos/texto de competidor
- shipping/returns no estan confirmados
- trust signals no estan verificados

Estas reglas aplican aunque el listing tenga buen titulo o buen precio aparente.

## 15. Relacion con eBay Only Connection

Este diseno prepara camino para conexion eBay-only.

Primer objetivo futuro:

- read-only
- benchmark import
- sin drafts
- sin publicacion
- sin mutacion

Orden seguro:

1. Benchmark read-only.
2. Review humano.
3. Listing package QA.
4. Draft controlado en loop futuro.
5. Publicacion solo con aprobacion humana.

No empezar por publicar.

No empezar por crear draft.

## 16. Que NO hacer

No hacer:

- no implementar import en este loop
- no conectar eBay
- no usar OAuth
- no tokens
- no scraping
- no browser automation
- no copiar listings
- no copiar fotos
- no crear draft real
- no publicar
- no mutar listings
- no tocar Supabase
- no conectar OpenAI

Este documento no autoriza acciones reales. Solo define el diseno futuro.

## 17. Proximos loops recomendados

- `LOOP 095 - First Listing QA Review V1`
- `LOOP 096 - eBay Only Connection Design V1`
- `LOOP 097 - eBay Sold Listings Benchmark Import Fixture V1`
- `LOOP 098 - eBay Read-Only Benchmark Connector Design V1`

## Fast-track documentation-only

Este loop puede avanzar por fast-track documentation-only solo si:

- el cambio sigue siendo documentation-only
- solo se agrega este documento
- `git diff --check` pasa
- `git diff --cached --check` pasa
- `npx tsc --noEmit` pasa
- `node --test tools/ebay-winner-pipeline-tests.mjs` pasa
- el grep de seguridad encuentra solo menciones educativas, diseno futuro o reglas de bloqueo
- Vercel y Vercel Preview Comments quedan en success

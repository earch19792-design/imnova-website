# EBAY-RESUME-B2A — Luna Top 50 eBay Demand Ranker V1

## Why

Confirmar que un candidato de Luna Scan se parece a un producto observado en eBay es una señal útil, pero no demuestra que sea la mejor oportunidad entre todos los candidatos disponibles. Esta capa se inserta antes de B2-RUN para comparar hasta 50 opciones con una metodología uniforme y exigir una selección humana final.

No existen “ganadores de Luna”. Luna Scan aporta candidatos observados. eBay aporta señales de demanda, movimiento, precio, competencia y estructura de listings. El sistema calcula un opportunity score y el humano elige qué producto avanza.

## Current state and corrected route

La confirmación `HUMAN_CONFIRMED_SAME_PRODUCT` del candidato `Black Silicone Self Adhesive Cable Organizer Clips Multipack` sigue siendo válida. El candidato entra al Top 50 con esa señal, pero no pasa automáticamente a B2-RUN.

La ruta profesional es:

1. Luna Scan Top 50.
2. Validación de demanda observada en eBay.
3. Ranking de oportunidades.
4. Listing blueprint para el Top 5.
5. Selección humana del producto final.
6. EBAY-RESUME-B2-RUN-PREFLIGHT.
7. Futuro B2-RUN controlado.
8. LOOP 150 con aprobación humana.

## Why one confirmed product is not enough

Un solo match puede ser correcto y aun así tener menor demanda, más competencia, peor margen potencial, pack ambiguo o un listing difícil de diferenciar. El Top 50 evita convertir la primera coincidencia en una decisión comercial automática.

## Luna candidates and eBay demand

Luna Scan solo aporta nombre observado, categoría aproximada, keywords, pack, color, material, disponibilidad, referencia de imagen y riesgos. No decide qué producto vender.

eBay define la evidencia comercial observada: movimiento relativo, comparables, precio, competencia, keywords, categoría, specifics, pack predominante y listing quality gap. En este loop toda esa evidencia proviene de fixture local marcado `EBAY_MARKET_OBSERVED`; no se llama la API real.

Demanda observada y probabilidad de venta no equivalen a una venta garantizada. El sistema no permite claims de ventas garantizadas.

## Opportunity score

El score de 0 a 100 combina:

- Demanda observada en eBay: 30%.
- Fuerza del match con el candidato Luna: 20%.
- Oportunidad de precio: 15%.
- Listing quality gap: 15%.
- Claridad del pack: 10%.
- Preparación visual de referencia: 10%.
- Penalización máxima de riesgo: 20 puntos.
- Penalización máxima por datos de proveedor desconocidos: 10 puntos.

Un producto sin demanda observada no puede llegar al Top 10. Aerosoles, baterías, suplementos, claims médicos y marcas restringidas se penalizan y quedan en HOLD.

## Listing quality gap

El listing quality gap busca mercados donde existe demanda, pero los listings comparables tienen oportunidades de mejora: títulos poco claros, pack difícil de entender, specifics incompletos, imágenes sin buena estructura o presentación débil. Es una oportunidad de competir mejor, no permiso para copiar.

## Winning structure and listing blueprint

Cada blueprint del Top 5 contiene título original recomendado, keywords, categoría, item specifics, rango y precio observado, estrategia de pack, estructura de bullets, riesgos, campos del proveedor faltantes y estado de preparación.

Los campos reflejan patrones genéricos observados en eBay. No copian títulos, descripciones, marcas ni claims de competidores.

## Image optimization blueprint

El blueprint visual describe estructura, no archivos: fondo principal, ángulos secundarios, visual del número de unidades, contexto de uso y necesidad de mostrar dimensiones.

- Las imágenes eBay son `EBAY_REFERENCE_FOR_STRUCTURE_ONLY`.
- Una referencia Luna, si existe, es `LUNA_SCAN_OBSERVED_FOR_REVIEW`.
- No se descarga ni copia ninguna imagen de competidor.
- No se generan imágenes en este loop.
- Antes de publicar se necesita una imagen propia, autorizada o generada y aprobada en un loop futuro.

## Human final selection

El estado default es `PENDING`, bloquea B2-RUN y recomienda `NEED_HUMAN_TOP_PRODUCT_SELECTION`.

La simulación exacta `TOP50_HUMAN_SELECTED_RANK_1` selecciona el rank 1 y permite avanzar únicamente a `EBAY-RESUME-B2-RUN-PREFLIGHT`. No autoriza escrituras ni publicación.

La simulación `TOP50_HUMAN_REJECTED_ALL` recomienda `NEED_LUNA_SCAN_REFRESH`.

Si todo el conjunto es de alto riesgo, la ruta es `EBAY-RESUME-HOLD`.

## Existing confirmed candidate

La confirmación humana anterior se conserva como señal válida y el producto participa en el ranking. El reporte indica su posición y si sigue dentro del Top 10. La señal no sustituye la selección humana final basada en el conjunto completo.

## Connection to B2-RUN, LOOP 150, and LOOP 152

Después de seleccionar el producto final, B2-RUN-PREFLIGHT prepara y revisa el paquete técnico sin write. El futuro B2-RUN necesitará sus propias compuertas. LOOP 150 seguirá requiriendo aprobación humana para la primera publicación real.

El contrato también alimenta LOOP 152: el candidato seleccionado deberá quedar sujeto a monitor de listing, stock guard, price guard, margin guard y actualización de Luna Scan.

## Safety boundaries

- Sin Production, main, Staging DB o Supabase writes.
- Sin API eBay real, OAuth o token exchange.
- Sin draft, listing, offer o publicación.
- `canPublish` siempre es false.
- Sin scraper, descargas o generación de imágenes.
- Sin copia de imágenes, títulos o descripciones.
- Sin catálogo real Luna ni consulta al almacén.
- Sin Amazon, WhatsApp real u OpenAI/Codex API real.
- Sin secretos, tokens, `.env`, dumps o dirección completa del warehouse.

## Definition of Done

- Exactamente 50 candidatos cargados, normalizados y comparados.
- Ranking determinístico y Top 10 ordenado.
- Cinco blueprints seguros creados.
- Productos riesgosos penalizados o en HOLD.
- Candidato confirmado previamente incluido sin bypass.
- Selección pendiente bloquea; rank 1 seleccionado avanza al preflight; rechazo solicita refresh.
- Todas las guardas y regresiones pasan.

## Human explanation rule

El reporte debe explicar que el ranking estima oportunidad usando demanda observada y no garantiza ventas. Debe distinguir candidato Luna, evidencia eBay, recomendación del sistema y decisión humana.

## Next step

Revisar el Top 5 y seleccionar humanamente el producto final. Solo entonces avanzar a `EBAY-RESUME-B2-RUN-PREFLIGHT`. La publicación continúa bloqueada.

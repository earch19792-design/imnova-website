# EBAY PROFESSIONAL KEYWORD CLASSIFICATION V2

## Objetivo

Convertir las señales read-only de eBay en una recomendación comercial clara
sin presentar estimaciones, actividad de un solo vendedor o frecuencia de
listings como historial vendido verificado.

## Jerarquía de evidencia

1. `VERIFIED_HISTORICAL_MULTI_SELLER`
   - Marketplace Insights autorizado.
   - Cantidad histórica vendida oficial.
   - La keyword aparece con ventas en al menos dos vendedores comparables.
2. `ESTIMATED_MULTI_SELLER_SIGNAL`
   - `estimatedSoldQuantity` de Browse.
   - Señal secundaria observada en al menos dos vendedores.
   - Nunca se llama venta histórica verificada ni keyword ganadora verificada.
3. `SINGLE_SELLER_OBSERVATION`
   - Venta histórica o estimada de un solo vendedor.
   - Sólo se conserva para exploración; no entra como keyword principal.
4. `ACTIVE_LISTING_FREQUENCY_ONLY`
   - El término aparece en listings activos sin cantidad vendida.
   - No valida demanda.

## Roles profesionales de keyword

- `BUYER_INTENT_OR_USE_CASE`: problema o resultado buscado por el comprador.
- `CORE_PRODUCT_PHRASE`: frase que identifica el tipo de producto.
- `PRODUCT_IDENTITY_TOKEN`: modificador de identidad útil como secundario.
- `PRODUCT_ATTRIBUTE`: color u otro atributo; debe coincidir con Luna.
- `CONFIRMED_SPECIFICATION_OR_QUANTITY`: tamaño, peso o cantidad confirmada.
- `PACKAGING_OR_FORMAT`: botella, caja, bolsa o presentación.
- `GENERIC_LOW_SIGNAL`: término demasiado genérico para ser principal.

Los atributos y cantidades sólo entran en la estructura recomendada cuando
también están confirmados en el candidato de Luna. Una variante de color
contradictoria queda excluida del conjunto comparable.

## Estructura recomendada de listing

El reporte agrega `recommendedListingKeywordStructure` con:

- frase principal multi-vendedor;
- términos secundarios compatibles;
- atributos confirmados en Luna;
- términos exploratorios que no deben dominar el título;
- confianza de la estrategia;
- fórmula de título:
  `Marca confirmada + frase principal + beneficio/uso relevante + variante + tamaño/cantidad confirmados`.

No se copia un título competidor y la revisión humana permanece obligatoria.

## Intención de compra

`highestPotentialBuyerIntent` describe la intención agregada con mayor señal,
no una persona ni un comprador individual. Puede representar reparación,
reposición, organización, limpieza, cuidado personal o una compra específica.
Incluye nivel de potencial y base de evidencia. No usa datos personales.

## Selección de comparable

El `professionalReferenceScore` combina:

- 60% coincidencia de identidad;
- 25% señal comercial relativa;
- 15% calidad de la fuente.

El listing con más cantidad estimada no gana automáticamente. La identidad,
variante y evidencia se evalúan juntas, y la confirmación humana final continúa
siendo requerida.

## Seguridad

- Sólo eBay GET read-only previamente permitidos.
- Sin eBay write, Supabase write, draft, offer, listing o publicación.
- Sin descarga o copia de imágenes.
- Sin datos personales de compradores.
- B2-RUN permanece bloqueado.
- `canPublish` permanece `false`.

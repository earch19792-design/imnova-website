# EBAY SELLER KEYWORD DEMAND VALIDATION V1

## Objetivo

Mobile Review deja de pedir que el operador copie manualmente una URL y un
título desde el buscador de eBay. El módulo consulta fuentes oficiales de eBay
en modo read-only, conserva solamente comparables compatibles con el producto
de Luna Portex y ordena listings y keywords por evidencia de ventas.

## Fuentes y nivel de evidencia

1. `EBAY_MARKETPLACE_INSIGHTS_SOLD_HISTORY`
   - Fuente preferida.
   - Entrega historial vendido oficial de hasta 90 días y
     `totalSoldQuantity`.
   - Marketplace Insights es una API de acceso limitado; el módulo sólo la
     intenta cuando `EBAY_MARKETPLACE_INSIGHTS_ENABLED=true` y la aplicación
     tiene el scope autorizado.
2. `EBAY_BROWSE_ESTIMATED_SALES`
   - Se obtiene mediante Browse search + getItem.
   - Usa `estimatedSoldQuantity` expuesto por eBay para el listing activo.
   - Se etiqueta expresamente como estimación, no como historial completo.
3. `EBAY_BROWSE_ACTIVE_LISTING`
   - Confirma que el listing está activo y aporta título, vendedor, precio,
     categoría e imagen remota.
   - Su frecuencia no se presenta como evidencia de ventas.

El sistema nunca deduce que el primer resultado es el más vendido.

## Comparación de identidad

Antes de sumar ventas o keywords, cada listing se compara contra nombre,
variante y medidas del candidato de Luna. Las medidas y packs contradictorios
se excluyen. Los comparables `EXACT` y `STRONG` alimentan el ranking; el
operador conserva una confirmación humana final de un toque.

## Keywords

Las keywords se extraen de títulos reales creados por vendedores eBay. Se
calculan unigramas y bigramas, y se ponderan por:

- cantidad vendida histórica verificada;
- cantidad vendida estimada por eBay;
- número de listings comparables;
- número de vendedores distintos.

No existe vocabulario fijo por producto. Un término de listings activos sin
señal de ventas permanece como `ACTIVE_LISTING_FREQUENCY` y no se muestra como
keyword ganadora. No se copia el título completo de ningún competidor.

## Flujo móvil

El botón `Analizar listings y ventas en eBay` llama a
`POST /api/admin/ebay/seller-keyword-demand` con la sesión admin. La respuesta
muestra:

- nivel y limitaciones de la evidencia;
- cantidad de comparables y vendedores;
- keywords respaldadas por ventas;
- los cinco listings con mayor señal;
- imagen remota, precio, vendedor, match y cantidad vendida;
- selección del comparable y confirmación humana final.

Cuando la evidencia cumple el mínimo de dos comparables y tres unidades
vendidas, se retira `missingDemandValidation`. Si no, permanece
`NEED_EBAY_SALES_EVIDENCE`. B2-RUN y publicación siguen bloqueados.

## Seguridad

- Los secretos OAuth permanecen en el servidor.
- El token se mantiene sólo en memoria y nunca se devuelve al navegador.
- Endpoints permitidos: Browse search, Browse getItem y Marketplace Insights
  item_sales search, todos `GET`.
- No eBay write, draft, offer, listing ni publicación.
- No Supabase write.
- No scraper.
- Las imágenes de eBay se muestran como referencias remotas; no se descargan,
  copian ni reutilizan en un listing.
- `canPublish` permanece `false`.

## Variables de Preview

- `EBAY_CLIENT_ID`
- `EBAY_CLIENT_SECRET`
- `EBAY_MARKETPLACE_INSIGHTS_ENABLED=true` únicamente si eBay otorgó acceso a
  esa API y a sus categorías.

Si Marketplace Insights no está autorizado, Browse continúa funcionando y la
UI identifica con precisión si existe una estimación de ventas o sólo listings
activos.

## Estados runtime seguros

- Sin `EBAY_CLIENT_ID` o `EBAY_CLIENT_SECRET`, la API responde 503 con
  `EBAY_READONLY_ENV_MISSING` y la UI permanece operativa.
- Sin autorización limitada de Marketplace Insights, la UI muestra
  `MARKETPLACE_INSIGHTS_NOT_AUTHORIZED` y conserva Browse como fallback.
- Una señal `estimatedSoldQuantity` de Browse siempre se etiqueta como
  estimada; nunca se convierte en venta histórica verificada.

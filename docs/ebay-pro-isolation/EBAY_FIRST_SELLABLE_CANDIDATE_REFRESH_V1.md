# EBAY-FIRST-SELLABLE-CANDIDATE-REFRESH V1

## Objetivo

Consumir las decisiones modeladas de revisión móvil, excluir candidatos que ya
no están disponibles y preparar un Top 5 refrescado para una nueva revisión en
`/admin/ebay/mobile-review`.

## Decisiones consumidas

- `Reusable Hook and Loop Cable Ties 50 Pack`
- `Cord Keeper Appliance Cable Organizer`

Ambos quedan en `REMOVED_FROM_LUNA_SCAN`, reciben `STOCK_HOLD` y mantienen
`canProceedToB2Run: false`. Estas condiciones siempre los excluyen del ranking.

## Flujo modelado

1. Se normalizan las decisiones móviles removidas.
2. Se carga un conjunto local modelado de candidatos Luna Scan refrescados.
3. Se excluyen nombres removidos, estados `REMOVED_FROM_LUNA_SCAN` y cualquier
   candidato con `STOCK_HOLD`.
4. Los candidatos disponibles se ordenan por `opportunityScore`.
5. Se preparan cinco registros compatibles con `top5Candidates` para revisión
   móvil, sin aprobar el preflight.

Si existen cinco candidatos, la ruta es
`NEED_MOBILE_REVIEW_OF_REFRESHED_TOP5`. Si no existen suficientes candidatos,
la ruta es `NEED_NEW_LUNA_SCAN_SOURCE`.

## Salida

El reporte incluye `sellableCandidateRefreshReportBuilt`, conteos y detalle de
exclusiones, candidatos refrescados, el nuevo Top 5, candidato y score
recomendados, `canProceedToB2RunPreflight: false`, `canPublish: false` y la
siguiente ruta recomendada.

## Límites de seguridad

- Solo fixture y transformación determinista local; no consulta data viva.
- Sin eBay API, OAuth, tokens, writes, draft, offer, listing o publicación.
- Sin Supabase ni writes de base de datos.
- Sin WhatsApp real, imágenes nuevas, scraper, Amazon, secretos o `.env`.
- Este loop nunca ejecuta B2-RUN; exige una nueva revisión móvil del Top 5.

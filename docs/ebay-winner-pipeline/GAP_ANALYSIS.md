# GAP_ANALYSIS â€” eBay Winner Pipeline

## Lo que ya existe y se debe reutilizar

- DetecciÃ³n Luna Portex y normalizaciÃ³n bÃ¡sica de productos/variantes.
- HistÃ³rico de snapshots por variante.
- Eventos idempotentes para cambios relevantes.
- Opportunity Score interno del Radar.
- Dashboard admin y acciÃ³n manual de sync.
- EnvÃ­o WhatsApp de oportunidades resumidas.
- Supabase admin client y validaciÃ³n admin.

## Brechas funcionales

| Necesidad | Estado actual | Brecha |
|---|---|---|
| ValidaciÃ³n de producto eBay | No existe | Falta checklist por categorÃ­a/listing. |
| Cumplimiento | No existe | Falta VERO, marcas restringidas, hazmat, categorÃ­as restringidas, polÃ­tica de imÃ¡genes. |
| Profit real | No existe | Radar usa precio proveedor; falta shipping, fees, margen y precio eBay. |
| Winner Score | Parcial | `opportunity_score` no incluye profit, cumplimiento, completitud ni riesgo. |
| Decisiones WhatsApp | Parcial | Solo alerta; no registra aprobaciÃ³n/rechazo/respuesta. |
| Draft eBay | No existe | Falta modelo local de borrador; no conectar eBay aÃºn. |
| AuditorÃ­a pipeline | Parcial | Radar tiene eventos tÃ©cnicos; falta audit log de estados/decisiones. |
| Idempotencia end-to-end | Parcial | Productos/eventos/scores son idempotentes; candidatos/drafts aÃºn no. |
| Observabilidad | Parcial | `last_error` y console logs; falta run log estructurado por etapa. |
| Datos de listing | Incompleto | Falta GTIN/UPC/MPN, peso, dimensiones, categorÃ­a, condiciÃ³n, polÃ­ticas, descripciones optimizadas. |

## Datos faltantes crÃ­ticos

- UPC/GTIN/MPN confiables.
- Peso y dimensiones para shipping.
- CategorÃ­a eBay y item specifics/aspects.
- CondiciÃ³n permitida.
- Restricciones de marca/categorÃ­a.
- PolÃ­tica de devoluciones, pagos y envÃ­o.
- Costos landed: proveedor + envÃ­o hacia comprador + fees + buffer.
- Reglas de precio mÃ­nimo/margen mÃ­nimo.
- Identidad del aprobador humano y trazabilidad de WhatsApp.

## Propuesta de Winner Score

`winner_score` debe ser independiente del `opportunity_score`, pero puede reutilizarlo como input.

Ejemplo de ponderaciÃ³n inicial:

- 25% seÃ±al Radar: `opportunity_score`, rotaciÃ³n, restocks, descuentos.
- 25% profit: margen estimado, profit absoluto, sensibilidad a shipping/fees.
- 20% completitud: SKU, imÃ¡genes, marca, identificadores, dimensiones, stock.
- 15% cumplimiento: marca, categorÃ­a, hazmat, imagen, polÃ­ticas.
- 10% stock/recencia: disponibilidad, inventario, edad del snapshot.
- 5% calidad listing: tÃ­tulo, descripciÃ³n, cantidad de imÃ¡genes.

Regla de bloqueo: cualquier compliance crÃ­tico debe forzar `BLOCKED` aunque el score sea alto.

## Reglas de transiciÃ³n recomendadas

- `DETECTED` â†’ `ENRICHING` cuando se crea/actualiza candidato.
- `ENRICHING` â†’ `NEEDS_DATA` si faltan datos recuperables.
- `ENRICHING` â†’ `BLOCKED` si hay restricciÃ³n dura.
- `ENRICHING` â†’ `VALIDATED` si validaciÃ³n, profit y compliance pasan.
- `VALIDATED` â†’ `APPROVAL_PENDING` cuando se envÃ­a WhatsApp de aprobaciÃ³n.
- `APPROVAL_PENDING` â†’ `APPROVED` / `REJECTED` / `PAUSED` segÃºn decisiÃ³n.
- `APPROVED` â†’ `DRAFT_CREATED` al generar borrador local.
- `DRAFT_CREATED` â†’ `PUBLISHED` solo en fase futura con conector eBay real.

## Archivos que habrÃ­a que modificar en implementaciÃ³n futura

- `lib/market-radar-types.ts`: agregar tipos de candidato/draft, sin cambiar tipos Radar existentes.
- `app/api/admin/market-radar/route.ts`: opcionalmente agregar acciÃ³n separada para promover candidatos; mejor crear ruta nueva.
- Nueva ruta recomendada: `app/api/admin/ebay-winner-pipeline/route.ts`.
- Nuevo mÃ³dulo recomendado: `lib/ebay-winner-pipeline/*`.
- Nuevo panel recomendado: `components/admin/ebay-winner-pipeline-panel.tsx`.
- `app/admin/page.tsx` o navegaciÃ³n admin: link al pipeline.
- Migraciones Supabase nuevas: `supabase/migrations/YYYYMMDDHHMM_create_ebay_winner_pipeline.sql`.
- `lib/whatsapp.ts`: agregar templates/interacciones de aprobaciÃ³n de forma backward-compatible.

## Dependencias necesarias

Para fase de documentaciÃ³n/diseÃ±o: ninguna.

Para implementaciÃ³n sin conector eBay:

- Ninguna dependencia obligatoria nueva; Supabase y zod ya estÃ¡n disponibles.
- Opcional: librerÃ­a de hashing si no se usa Web Crypto/Node crypto.

Para conector eBay futuro:

- SDK/API client de eBay o cliente HTTP propio.
- Manejo OAuth eBay sandbox/production.
- ValidaciÃ³n de marketplace policies y taxonomy/aspects.

## Preguntas mÃ­nimas de negocio

1. Â¿Marketplace inicial: eBay US solamente?
2. Â¿Margen mÃ­nimo y profit mÃ­nimo por listing?
3. Â¿QuiÃ©n aprueba por WhatsApp y con quÃ© formato de respuesta?
4. Â¿QuÃ© categorÃ­as o marcas estÃ¡n prohibidas desde el dÃ­a 1?
5. Â¿Se permite dropshipping directo o habrÃ¡ inventario propio/intermedio?
6. Â¿CuÃ¡l es la polÃ­tica de shipping y devoluciones por defecto?
7. Â¿Se usarÃ¡ sandbox eBay antes de producciÃ³n? Recomendado: sÃ­, obligatorio para fase conector.

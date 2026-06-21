# GAP_ANALYSIS — eBay Winner Pipeline

## Lo que ya existe y se debe reutilizar

- Detección Luna Portex y normalización básica de productos/variantes.
- Histórico de snapshots por variante.
- Eventos idempotentes para cambios relevantes.
- Opportunity Score interno del Radar.
- Dashboard admin y acción manual de sync.
- Envío WhatsApp de oportunidades resumidas.
- Supabase admin client y validación admin.

## Brechas funcionales

| Necesidad | Estado actual | Brecha |
|---|---|---|
| Validación de producto eBay | No existe | Falta checklist por categoría/listing. |
| Cumplimiento | No existe | Falta VERO, marcas restringidas, hazmat, categorías restringidas, política de imágenes. |
| Profit real | No existe | Radar usa precio proveedor; falta shipping, fees, margen y precio eBay. |
| Winner Score | Parcial | `opportunity_score` no incluye profit, cumplimiento, completitud ni riesgo. |
| Decisiones WhatsApp | Parcial | Solo alerta; no registra aprobación/rechazo/respuesta. |
| Draft eBay | No existe | Falta modelo local de borrador; no conectar eBay aún. |
| Auditoría pipeline | Parcial | Radar tiene eventos técnicos; falta audit log de estados/decisiones. |
| Idempotencia end-to-end | Parcial | Productos/eventos/scores son idempotentes; candidatos/drafts aún no. |
| Observabilidad | Parcial | `last_error` y console logs; falta run log estructurado por etapa. |
| Datos de listing | Incompleto | Falta GTIN/UPC/MPN, peso, dimensiones, categoría, condición, políticas, descripciones optimizadas. |

## Datos faltantes críticos

- UPC/GTIN/MPN confiables.
- Peso y dimensiones para shipping.
- Categoría eBay y item specifics/aspects.
- Condición permitida.
- Restricciones de marca/categoría.
- Política de devoluciones, pagos y envío.
- Costos landed: proveedor + envío hacia comprador + fees + buffer.
- Reglas de precio mínimo/margen mínimo.
- Identidad del aprobador humano y trazabilidad de WhatsApp.

## Propuesta de Winner Score

`winner_score` debe ser independiente del `opportunity_score`, pero puede reutilizarlo como input.

Ejemplo de ponderación inicial:

- 25% señal Radar: `opportunity_score`, rotación, restocks, descuentos.
- 25% profit: margen estimado, profit absoluto, sensibilidad a shipping/fees.
- 20% completitud: SKU, imágenes, marca, identificadores, dimensiones, stock.
- 15% cumplimiento: marca, categoría, hazmat, imagen, políticas.
- 10% stock/recencia: disponibilidad, inventario, edad del snapshot.
- 5% calidad listing: título, descripción, cantidad de imágenes.

Regla de bloqueo: cualquier compliance crítico debe forzar `BLOCKED` aunque el score sea alto.

## Reglas de transición recomendadas

- `DETECTED` → `ENRICHING` cuando se crea/actualiza candidato.
- `ENRICHING` → `NEEDS_DATA` si faltan datos recuperables.
- `ENRICHING` → `BLOCKED` si hay restricción dura.
- `ENRICHING` → `VALIDATED` si validación, profit y compliance pasan.
- `VALIDATED` → `APPROVAL_PENDING` cuando se envía WhatsApp de aprobación.
- `APPROVAL_PENDING` → `APPROVED` / `REJECTED` / `PAUSED` según decisión.
- `APPROVED` → `DRAFT_CREATED` al generar borrador local.
- `DRAFT_CREATED` → `PUBLISHED` solo en fase futura con conector eBay real.

## Archivos que habría que modificar en implementación futura

- `lib/market-radar-types.ts`: agregar tipos de candidato/draft, sin cambiar tipos Radar existentes.
- `app/api/admin/market-radar/route.ts`: opcionalmente agregar acción separada para promover candidatos; mejor crear ruta nueva.
- Nueva ruta recomendada: `app/api/admin/ebay-winner-pipeline/route.ts`.
- Nuevo módulo recomendado: `lib/ebay-winner-pipeline/*`.
- Nuevo panel recomendado: `components/admin/ebay-winner-pipeline-panel.tsx`.
- `app/admin/page.tsx` o navegación admin: link al pipeline.
- Migraciones Supabase nuevas: `supabase/migrations/YYYYMMDDHHMM_create_ebay_winner_pipeline.sql`.
- `lib/whatsapp.ts`: agregar templates/interacciones de aprobación de forma backward-compatible.

## Dependencias necesarias

Para fase de documentación/diseño: ninguna.

Para implementación sin conector eBay:

- Ninguna dependencia obligatoria nueva; Supabase y zod ya están disponibles.
- Opcional: librería de hashing si no se usa Web Crypto/Node crypto.

Para conector eBay futuro:

- SDK/API client de eBay o cliente HTTP propio.
- Manejo OAuth eBay sandbox/production.
- Validación de marketplace policies y taxonomy/aspects.

## Preguntas mínimas de negocio

1. ¿Marketplace inicial: eBay US solamente?
2. ¿Margen mínimo y profit mínimo por listing?
3. ¿Quién aprueba por WhatsApp y con qué formato de respuesta?
4. ¿Qué categorías o marcas están prohibidas desde el día 1?
5. ¿Se permite dropshipping directo o habrá inventario propio/intermedio?
6. ¿Cuál es la política de shipping y devoluciones por defecto?
7. ¿Se usará sandbox eBay antes de producción? Recomendado: sí, obligatorio para fase conector.

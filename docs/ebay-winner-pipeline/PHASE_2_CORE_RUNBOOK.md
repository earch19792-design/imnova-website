# PHASE_2_CORE_RUNBOOK — Motor interno eBay Winner Pipeline

## Qué implementa esta fase

Esta fase agrega el núcleo interno para evaluar candidatos del Radar IMNOVA como oportunidades eBay sin conectar la API real de eBay y sin enviar WhatsApp real. El flujo seguro es:

```text
Radar product -> normalizador -> candidato eBay -> validación -> profit -> compliance -> Winner Score -> WhatsApp dryRun payload
```

## Cómo correr localmente

1. Instalar dependencias si hace falta:

```bash
npm install
```

2. Ejecutar tests unitarios del motor:

```bash
node --test tools/ebay-winner-pipeline-tests.mjs
```

3. Ejecutar build/check de Next:

```bash
npm run build
```

4. Para persistir en Supabase local/remoto controlado, aplicar primero la migración aditiva:

```bash
supabase db push
```

> No ejecutar contra producción sin revisión humana. La migración solo crea tablas nuevas `ebay_*` y no altera tablas existentes.

## Endpoint interno seguro

Ruta admin nueva:

```text
POST /api/admin/ebay-winner-pipeline
```

Acciones soportadas:

### `process_radar_candidate`

Procesa un producto Radar. Por defecto no persiste y responde con cálculo completo en memoria.

```json
{
  "action": "process_radar_candidate",
  "persist": false,
  "radarProduct": {
    "source_key": "lunaportex",
    "product_id": "...",
    "snapshot_id": "...",
    "supplier_product_id": "...",
    "supplier_variant_id": "...",
    "sku": "SUPPLIER-SKU",
    "title": "Producto Luna Portex",
    "price": 10,
    "inventory_quantity": 12,
    "available": true,
    "image_urls": ["https://example.com/image.jpg"],
    "images_authorized": true,
    "suggested_category_id": "159907",
    "weight": 1.2,
    "opportunity_score": 80
  }
}
```

Si `persist` es `true`, escribe/upsertea en las tablas nuevas del pipeline mediante `candidate_key` e `idempotency_key`.

### `record_decision`

Registra una decisión idempotente de botón WhatsApp/admin en modo dryRun:

```json
{
  "action": "record_decision",
  "candidateId": "uuid",
  "candidateKey": "lunaportex:product:variant",
  "decision": "create_draft",
  "messageId": "wamid.dry-run",
  "decidedBy": "admin"
}
```

Decisiones permitidas:

- `create_draft` -> `DRAFT_CREATED`
- `reject` -> `REJECTED`
- `review_data` -> `NEEDS_DATA`
- `postpone` -> `PAUSED`

## Variables necesarias

Para ejecución en memoria y tests:

- Ninguna variable obligatoria.

Para usar el endpoint con persistencia:

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- Bearer token admin válido para `validateAdminApiRequest`

Para esta fase no se requiere ningún secreto eBay. Tampoco se requiere `WHATSAPP_ACCESS_TOKEN` porque el mensaje se genera como payload dryRun y no se envía.

## Qué queda en dryRun

- `whatsappDryRunPayload.dryRun` siempre es `true`.
- `whatsappDryRunPayload.enableRealSend` siempre es `false`.
- El endpoint no llama `sendWhatsAppUpdate` ni Graph API.
- `ebay_listing_drafts.ebay_draft_id` tiene constraint para permanecer `null`.
- El estado `PUBLISHED` no existe en constraints de Fase 2.

## Qué falta para conectar eBay real

- OAuth eBay sandbox y manejo seguro de refresh tokens.
- Taxonomy/aspects API para categoría e item specifics.
- Business policies reales: payment, return y shipping.
- Validación VeRO/categorías restringidas con fuente oficial/manual aprobada.
- Generador final de listing compatible con Trading/Inventory API.
- Feature flag separado para sandbox y producción.
- Revisión legal/operativa antes de publicar.

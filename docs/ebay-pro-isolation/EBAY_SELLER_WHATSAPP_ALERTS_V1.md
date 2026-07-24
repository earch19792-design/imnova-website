# Seller Command Center — alertas WhatsApp profesionales V1

## Objetivo

Este canal reduce el tiempo entre una señal verificable y una acción del vendedor.
No reemplaza el Command Center ni aprueba drafts: el mensaje conduce al workspace
móvil para que una persona revise y autorice.

La entrega real queda desactivada por defecto. En desarrollo y preproducción se
usa `preview`; ningún test llama Meta ni envía un mensaje.

## Política de alertas

| Evento | Regla mínima | Prioridad | Entrega | Acción esperada |
| --- | --- | --- | --- | --- |
| Venta confirmada | Orden oficial nueva y pagada | Crítica | Inmediata | Comprar en Luna y continuar fulfillment |
| Ganador listo | Potencial ≥75, confianza ≥70, stock ≥4, margen ≥20%, beneficio ≥US$5 y evidencia exacta | Alta | Digest | Revisar y autorizar el draft |
| Reposición Luna | Antes 0, ahora ≥4 | Alta si hay listing/potencial; si no, media | Digest | Revalidar margen y reactivar/preparar |
| Baja de costo Luna | Baja ≥3%; urgente desde 8% con potencial ≥60 | Alta/media | Digest | Recalcular precio ganador |
| Listing sin stock | Listing activo y stock Luna 0/no disponible | Crítica | Inmediata | Pausar o corregir cantidad |
| Listing con poco stock | Listing activo y stock Luna entre 1 y 3 | Alta | Digest | Ajustar cantidad o reponer |
| Costo/margen en riesgo | Listing activo y aumento de costo ≥5% o margen <20%; crítica bajo 10% | Alta/crítica | Digest | Recalcular antes de tocar eBay |
| Competencia y oportunidades | Señal verificable de mercado | Alta/media | Digest | Revisar la oportunidad |
| Fallo de draft | Fallo accionable; crítico si agotó reintentos | Alta/crítica | Digest | Corregir y reintentar desde workspace |
| Aprobación larga por vencer | ≤6 h alta; 6–24 h media | Alta/media | Digest | Revalidar y decidir |

Sólo la venta confirmada y el stock Luna exacto en cero de un listing activo se
envían inmediatamente. Los demás eventos se agrupan en un resumen diario a las
18:00 Guatemala. La prueba manual del canal es una excepción operativa explícita,
no un evento de monitoreo. Los cool-downs evitan que
una condición repetida genere ruido. Al resolverse una condición debe llamarse
`resolveSellerWhatsAppAlert`; si reaparece, se considera una nueva ocurrencia.
La resolución cancela filas pendientes o en reintento. Un lease ya en vuelo no
se etiqueta falsamente como cancelado, porque Meta podría haberlo aceptado.

## Seguridad y privacidad

- Sólo se usa un template Meta aprobado; no se envía texto libre proactivo.
- El destinatario se obtiene únicamente de
  `EBAY_SELLER_WHATSAPP_RECIPIENT`; no hay teléfono fallback.
- El destinatario, token y Phone Number ID nunca se guardan en el outbox ni se
  devuelven por la API.
- El payload persistido está limitado a título, resumen, acción, URL HTTPS y
  métricas de decisión permitidas. No contiene headers, tokens ni respuesta
  completa del proveedor.
- Cada intento tiene lease, `SKIP LOCKED`, reintento con backoff, máximo de
  intentos y dead-letter. Sólo se conserva el ID de mensaje y código seguro.
- RPCs de enqueue/claim/complete/fail son exclusivos de `service_role`.

## Configuración server-side

La configuración reporta `NOT_READY` si falta el destinatario o cualquiera de
los templates específicos, `DISABLED` si está completa pero el flag sigue
apagado, y `READY` cuando puede entregar. Se requieren estas variables:

- `EBAY_SELLER_WHATSAPP_ENABLED=false` (default seguro)
- `EBAY_SELLER_WHATSAPP_RECIPIENT`
- `EBAY_SELLER_WHATSAPP_TEMPLATE_NAME`
- `EBAY_SELLER_WHATSAPP_DIGEST_TEMPLATE_NAME`
- `EBAY_SELLER_WHATSAPP_TEMPLATE_LANGUAGE=es`
- `EBAY_SELLER_WHATSAPP_DIGEST_HOUR_UTC=0` (18:00 Guatemala del día anterior)
- `EBAY_SELLER_COMMAND_CENTER_URL`
- `WHATSAPP_ACCESS_TOKEN` y `WHATSAPP_PHONE_NUMBER_ID` existentes en el servidor

Los dos templates deben estar aprobados en Meta y aceptar cuatro parámetros de
cuerpo, en este orden: prioridad, título, resumen y acción/enlace.

## API operativa

`GET /api/admin/ebay/seller-whatsapp-alerts` devuelve configuración segura,
salud y previews. `POST` acepta:

```json
{ "action": "preview", "limit": 20 }
```

La entrega requiere Admin o `CRON_SECRET`, `action=deliver`, `dryRun=false`, flag
habilitado y configuración `READY`. Cualquier JSON inválido recibe una respuesta
JSON controlada.

Los crons aceptan `Authorization: Bearer <secreto>` o el equivalente dedicado
`X-Ebay-Commercial-Authorization: Bearer <secreto>`. El segundo existe para
previews protegidos donde Vercel reserva `Authorization`; exige exactamente el
mismo secreto server-side y no se acepta en Production.

## Puntos de integración

El motor no se acopla al monitor ni al builder. Quien detecta el evento llama:

```ts
await enqueueSellerWhatsAppAlert(supabase, {
  alertType: "winner_ready",
  entityType: "ebay_luna_opportunity",
  entityId: opportunity.id,
  candidateKey: opportunity.candidate_key,
  title: opportunity.product_title,
  summary: "Ganador verificado con stock y margen suficiente.",
  mobileUrl: workspaceUrl,
  facts: {
    potentialScore,
    confidenceScore,
    currentStock,
    estimatedMarginPct,
    estimatedNetProfit,
    hasExactEvidence: true,
  },
})
```

Integraciones activas:

1. Después de guardar la evaluación canónica: `winner_ready`, `luna_restock` y
   `luna_cost_drop`.
2. Al abrir/cerrar riesgos del monitor: `out_of_stock`, `low_stock`, `price_up`,
   `margin_risk` y `mapping_broken`; cerrar con `resolveSellerWhatsAppAlert`.
3. En el worker de draft no publicado: `draft_failure` sólo después de tener un
   error accionable/terminal.
4. El worker prioritario y el cron de protección intentan entregar únicamente
   cuando el feature flag y toda la configuración reportan `READY`.

Las aprobaciones del draft-only duran sólo 15 minutos y no producen WhatsApp:
el usuario ya está dentro del workspace y avisar generaría ruido. La regla
`approval_expiration` queda reservada para aprobaciones futuras de mayor duración.

La migración `20260713051000` debe aplicarse después de la migración base del
Seller Command Center V2. Este cambio no la aplica por sí mismo.

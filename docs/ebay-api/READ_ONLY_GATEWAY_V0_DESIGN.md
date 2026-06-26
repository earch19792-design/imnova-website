# eBay API Read-Only Gateway V0 Design

## Proposito

El eBay API Read-Only Gateway V0 sera una capa aislada para consultar metadata de eBay y apoyar decisiones de listing readiness. No debe operar listings ni tomar acciones reales sobre la cuenta.

El gateway V0 no debe:

- Publicar listings.
- Crear drafts reales.
- Modificar listings.
- Cambiar precio o cantidad.
- Pausar listings.
- Leer ordenes o pagos.
- Enviar mensajes.

La metadata de eBay debe tratarse como contexto de preparacion, no como permiso automatico para publicar.

## Alcance Permitido V0

V0 puede disenar soporte para:

- Categorias eBay.
- Item specifics / aspects.
- Marketplace metadata.
- Validacion de categoria probable.
- Campos faltantes para Listing Readiness.
- Soporte futuro para Listing Strategy Advisor.

Todas las respuestas deben ser read-only y requerir revision humana antes de cualquier accion operativa.

## Acciones Prohibidas V0

- Crear draft real.
- Publicar listing.
- Modificar listing.
- Cambiar precio.
- Cambiar cantidad.
- Pausar listing.
- Enviar mensajes.
- Leer orders/pagos.
- Guardar tokens sin diseno seguro aprobado.
- Usar metadata como permiso automatico para publicar.

## Output Esperado

JSON conceptual read-only:

```json
{
  "marketplace_id": "EBAY_US",
  "category_candidates": [],
  "selected_category": null,
  "required_aspects": [],
  "recommended_aspects": [],
  "missing_aspects": [],
  "readiness_notes": [],
  "api_mode": "sandbox_read_only",
  "write_actions_enabled": false,
  "human_approval_required": true
}
```

Reglas del output:

- `write_actions_enabled` debe permanecer `false` en V0.
- `human_approval_required` debe permanecer `true`.
- `selected_category` puede ser `null` hasta revision humana.
- `missing_aspects` debe alimentar readiness, no publicacion automatica.

## Modulos Futuros Propuestos

- `lib/ebay-api/read-only-client.mjs`
  - Cliente base para endpoints permitidos de metadata.
  - No debe exponer metodos de write.

- `lib/ebay-api/category-metadata.mjs`
  - Resolucion de categorias, candidatos y metadata de marketplace.

- `lib/ebay-api/aspects-normalizer.mjs`
  - Normalizacion de aspects requeridos y recomendados.
  - Comparacion contra datos internos de IMNOVA para detectar faltantes.

- `docs/ebay-api/OAUTH_TOKEN_STORE_DESIGN.md`
  - Documento futuro para diseno seguro de OAuth y almacenamiento de tokens.
  - No debe contener tokens reales.

- `app/api/admin/ebay/readiness-metadata/route.ts`
  - Endpoint futuro, si aplica.
  - Debe ser admin-only, read-only, con feature flag apagado por defecto.

## Seguridad OAuth

OAuth debe disenarse antes de conectar cualquier API real.

Requisitos:

- Tokens server-side solamente.
- Nada en variables `NEXT_PUBLIC`.
- No logs de access tokens, refresh tokens, authorization codes ni headers sensibles.
- Scopes minimos orientados a metadata/read-only.
- Sandbox primero.
- Refresh token cifrado o manejado por secret manager.
- Feature flag `EBAY_API_REAL_ENABLED=false` por defecto.
- Audit log futuro sin secretos.
- Ningun endpoint write en V0.

El gateway debe fallar cerrado si falta configuracion segura.

## Integracion Futura Con IMNOVA

### Listing Readiness

El gateway puede alimentar:

- Categoria probable.
- Required aspects.
- Recommended aspects.
- Missing aspects.
- Notas de readiness.

No debe convertir readiness en publicacion automatica.

### Seller Decision Layout

Puede mostrar metadata faltante y categoria/aspects candidatos como contexto para el vendedor. La decision final debe seguir requiriendo aprobacion humana.

### Listing Seller Advisor Prompts

Puede proveer datos verificados para prompts de titulo, descripcion e item specifics. Los prompts deben seguir bloqueando datos inventados, marcas no autorizadas y claims no comprobados.

### Listing Strategy Advisor

Puede mejorar la decision entre `needs_data`, `listing_prep`, `organic_test` o `pack_review`, siempre sin acciones write.

### Stock Rotation Risk Guardrail

Puede aportar contexto de categoria/aspects, pero no debe reducir bloqueos por stock bajo. El riesgo de cancelacion y disponibilidad sigue teniendo prioridad.

## Orden Futuro De Implementacion

1. Documentar OAuth/token-store design.
2. Crear schemas/output read-only.
3. Implementar normalizadores puros con fixtures locales.
4. Agregar tests sin eBay real.
5. Crear cliente read-only con feature flag apagado.
6. Ejecutar sandbox manual solo con aprobacion explicita.
7. Crear endpoint admin read-only, si aplica.
8. Integrar de forma additive con advisors.

## Gates Antes De API Real

Antes de conectar API real debe existir:

- Diseno token-store aprobado.
- Feature flag apagado por defecto.
- Sandbox validado.
- Tests que confirmen `write_actions_enabled: false`.
- Revision de scopes.
- Revision de logs sin secretos.
- Confirmacion humana explicita.

Sin estos gates, la API real debe permanecer apagada.

## Riesgos

- Scopes demasiado amplios.
- Tokens mal guardados.
- Endpoints de write disponibles por accidente.
- Confundir metadata con permiso para publicar.
- Confiar en categoria sin revision humana.
- Secrets mal configurados en Vercel o env local.
- Logs que expongan headers, authorization codes o tokens.
- Integracion UI que parezca accion operativa aunque el gateway sea read-only.

## Decision V0

V0 es diseno documental. No implementa API, OAuth, tokens, endpoints funcionales, drafts, publicacion, modificacion de listings, pausa, orders ni pagos.

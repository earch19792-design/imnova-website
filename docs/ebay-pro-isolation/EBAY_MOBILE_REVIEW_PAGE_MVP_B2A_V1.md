# EBAY-RESUME-B2A-MOBILE-REVIEW-PAGE-MVP

## Propósito

Esta ruta convierte el Approval Center modelado en una pantalla privada y
mobile-first dentro del Admin: `/admin/ebay/mobile-review`. Permite revisar el
Top 5, seleccionar un candidato y registrar una decisión operativa local desde
el teléfono.

No reemplaza el scan Luna ni la validación de demanda eBay. Tampoco garantiza
que un producto sea ganador o que vaya a venderse.

## Flujo móvil

La pantalla muestra score, título, precio y categoría sugeridos, riesgos y
campos faltantes. El rank #1 aparece recomendado. También muestra el candidato
anterior cuando fue removido del scan.

Las acciones locales son `MARK_UNAVAILABLE`, `SELECT_CANDIDATE`,
`CONFIRM_SAME_PRODUCT`, `CONFIRM_STOCK_QTY`, `CONFIRM_IMAGE_OK`,
`REQUEST_LUNA_SCAN_REFRESH`, `HOLD_FOR_REVIEW` y
`APPROVE_B2_RUN_PREFLIGHT`.

El resultado se presenta como JSON copiable con candidato, disponibilidad,
stock, imagen y siguiente ruta. No se persiste: al recargar la página se pierde
la decisión local.

### Procedencia de los datos del MVP

El Top 5 visible en esta versión proviene de
`tools/fixtures/ebay-mobile-review-page-mvp-v1.json`. Los candidatos, scores,
precios y categorías son datos modelados del flujo Top 50/Approval Center; no
son una consulta viva al último scan, a Supabase o a eBay. La interfaz debe
mostrar esta procedencia y no presentar estos valores como runtime confirmados.

La UI muestra feedback persistente para la última acción, el estado de
disponibilidad dentro de cada tarjeta y desplaza el teléfono automáticamente a
las confirmaciones después de seleccionar. Los controles que necesitan un
candidato permanecen deshabilitados hasta completar la selección.

## Reglas

- Un producto removido queda en `REMOVED_FROM_LUNA_SCAN` y `STOCK_HOLD`.
- Un producto removido nunca puede avanzar y dirige a
  `NEED_LUNA_SCAN_REFRESH`.
- Seleccionar sin confirmar identidad, stock e imagen mantiene el preflight
  bloqueado.
- Solo selección válida + mismo producto + stock positivo + imagen confirmada
  + aprobación explícita habilitan `EBAY-RESUME-B2-RUN-PREFLIGHT`.
- La aprobación únicamente habilita preparar el preflight. `canPublish` siempre
  es `false`.

## Safety boundaries

- Sin WhatsApp o SMS real.
- Sin eBay API, OAuth, tokens, draft, offer, listing o publicación.
- Sin Supabase ni ningún write de base de datos.
- Sin generación, descarga o copia de imágenes.
- Sin scraper, Amazon ni servicios externos.
- Sin secretos ni variables de entorno.
- Sin cambios en Production o `main`.

## Definition of Done

- Top 5 y candidato anterior visibles en una interfaz móvil.
- Botones grandes y estados operativos claros.
- Producto removido bloquea B2-RUN y solicita scan fresco.
- Flujo completo genera una decisión copiable hacia B2-RUN Preflight.
- Tests propios, TypeScript, regresiones e isolation guardrails en PASS.

## Explicación humana

En palabras simples: esta página sirve como una libreta temporal y segura para
decidir desde el teléfono qué producto merece seguir bajo revisión. No toca
eBay ni guarda datos. La siguiente integración deberá decidir explícitamente
si esta decisión local necesita persistencia privada y auditada.

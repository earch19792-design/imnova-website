# Image Generation Manual Image Creation Workflow V1

## 1. Proposito

Este documento define el flujo manual y controlado para crear imagenes profesionales de listings usando IMNOVA como sistema de control, sin conectar OpenAI API todavia.

El objetivo es permitir que IMNOVA prepare analisis, PromptPlan, Dry Run Result, reglas de seguridad y checklist antes de que una persona cree o edite una imagen con una herramienta externa/manual disponible para el equipo.

Este documento es:

- documentation-only
- sin implementacion
- sin generacion de imagenes en este loop
- sin conexion OpenAI
- sin OpenAI API call
- sin API keys
- sin eBay API real
- sin drafts reales
- sin publicacion
- sin cambios reales de listings
- human-review-required

No genera imagenes, no llama OpenAI, no conecta eBay, no crea drafts reales, no publica y no modifica listings.

## 2. Principio estrategico

Regla central:

```text
IMNOVA controls the workflow. Human creates or edits images manually. Nothing is published without QA and approval.
```

La API no es necesaria todavia para crear listings profesionales.

Primero se debe probar el flujo manual, confirmar que los datos son reales, validar que las instrucciones visuales son seguras y medir si el proceso produce imagenes utiles para revision.

La API puede considerarse mas adelante para escalar. No debe usarse como requisito para validar la estrategia inicial.

## 3. Estado actual de IMNOVA

IMNOVA ya cuenta con:

- Visual strategy para comprador americano.
- PromptPlan schema.
- Safety rules.
- Dry Run Result schema.
- Dry Run Runner local.
- Admin Image Generator read-only.
- Admin conectado al runner local.
- Tests de seguridad.
- Botones disabled.
- Sin OpenAI real.
- Sin eBay real.

Esto permite que la pantalla Admin explique por que una imagen no puede generarse todavia y que datos o revisiones hacen falta antes de cualquier flujo visual real.

## 4. Flujo manual recomendado

Flujo recomendado:

```text
Product Facts -> ImagePlan -> PromptPlan -> Dry Run Runner -> Manual Image Brief -> Human Manual Creation -> Image QA -> Human Approval -> Listing Asset Ready
```

Etapas:

1. Product Facts: recopilar y verificar los datos reales del producto.
2. ImagePlan: decidir que roles visuales necesita el listing.
3. PromptPlan: organizar instrucciones seguras y limitadas.
4. Dry Run Runner: evaluar si el plan esta listo, incompleto, bloqueado o rechazado.
5. Manual Image Brief: convertir el plan aprobado en una guia humana para crear o editar imagen.
6. Human Manual Creation: una persona crea o edita la imagen manualmente.
7. Image QA: revisar verdad, calidad, compliance, claims, autorizacion y conversion.
8. Human Approval: aprobar, pedir cambios o rechazar.
9. Listing Asset Ready: marcar internamente como listo para revision de listing, sin publicar automaticamente.

## 5. Product Facts

Antes de crear imagenes, confirmar:

- nombre del producto
- categoria
- color
- material real
- dimensiones reales
- contenido real del paquete
- uso permitido
- restricciones del producto
- ubicacion real de stock
- shipping real
- Free Shipping real o no
- autorizacion de imagen/persona/modelo si aplica

Si faltan datos:

- no crear imagen final
- marcar needs data
- pedir informacion adicional

Los datos reales son la base del flujo. Una imagen visualmente atractiva no debe avanzar si representa informacion no verificada.

## 6. PromptPlan como base

El PromptPlan no es la imagen final.

El PromptPlan organiza instrucciones seguras:

- facts reales
- objetivo visual
- claims permitidos
- claims prohibidos
- elementos requeridos
- elementos prohibidos
- trust signals
- safety rules
- acciones humanas pendientes

El PromptPlan debe estar basado en datos reales.

Si el PromptPlan tiene `PROMPT_PLAN_NEEDS_DATA`, la imagen final no debe usarse para listing real todavia.

Un PromptPlan incompleto puede servir para explicar que falta, pero no para aprobar uso comercial.

## 7. Dry Run Result como control

El Dry Run Result dice si se puede avanzar o no.

Reglas:

- si devuelve `DRY_RUN_NEEDS_DATA`, no crear imagen final para uso comercial
- si devuelve `DRY_RUN_BLOCKED`, corregir o retirar el pedido visual antes de crear imagen
- si devuelve `DRY_RUN_REJECTED`, no usar el plan como base
- si devuelve `DRY_RUN_READY_FOR_HUMAN_REVIEW`, una persona puede preparar imagen manual bajo QA

El Dry Run Result no genera imagenes. Explica la decision y mantiene el flujo bajo revision humana.

## 8. Manual Image Brief

Un Manual Image Brief futuro deberia contener:

- caseId
- imageRole
- targetBuyer
- language
- productFacts
- visualGoal
- allowedClaims
- prohibitedClaims
- requiredElements
- forbiddenElements
- trustSignalsAllowed
- trustSignalsBlocked
- safetyNotes
- humanReviewRequired

El brief debe ser claro para una persona, pero no debe incluir secretos, URLs privadas, credenciales, datos sensibles ni claims no verificados.

En este loop no se crea schema ni fixture del Manual Image Brief. Solo se disena el flujo.

## 9. Herramienta manual de creacion

Una persona puede usar una herramienta externa/manual de generacion o edicion.

Puede ser ChatGPT u otra herramienta visual disponible para el equipo.

Reglas:

- no se conecta API en esta etapa
- la persona debe copiar solo instrucciones seguras
- no copiar secretos
- no copiar URLs privadas
- no copiar datos sensibles
- no copiar datos de proveedor confidenciales
- revisar el resultado antes de usarlo

Este documento no menciona modelos, precios ni capacidades actuales especificas de OpenAI. La herramienta concreta puede cambiar; el control de IMNOVA debe permanecer.

## 10. Reglas para imagen principal

Reglas para imagen principal:

- producto protagonista
- fondo blanco o limpio cuando aplique
- sin exceso de texto
- sin badges falsos
- sin logos no autorizados
- sin accesorios no incluidos
- sin alterar tamano de forma enganosa
- revisar politicas vigentes de eBay antes de uso real

La imagen principal debe vender claridad antes que decoracion. Si una senal visual puede confundir al comprador, debe omitirse o moverse a revision.

## 11. Reglas para lifestyle images

Reglas para lifestyle images:

- uso realista
- producto protagonista
- persona/modelo no distractora
- sin sexualizacion innecesaria
- sin sugerir endoso real
- sin marcas/logos ajenos
- sin datos personales
- model release/autorizacion si aplica
- revision humana obligatoria

La imagen lifestyle debe ayudar a entender el uso real. No debe sugerir resultados, escala, calidad, autoridad, origen o disponibilidad no verificadas.

## 12. Trust signals para comprador americano

Solo usar trust signals si estan verificados:

- `Free Shipping`
- `Ships from USA`
- `In Stock in USA`
- `Fast US Shipping`
- USA flag

Si no estan verificados:

- no incluir en imagen
- no incluir en prompt manual final
- mantener como needs data o blocked

Todo copy visual para comprador americano debe estar en ingles.

Una senal de confianza no verificada es un riesgo comercial, no un recurso visual disponible.

## 13. Que puede hacer una persona manualmente

Puede:

- crear imagen de producto limpia
- crear imagen lifestyle realista
- crear close-up del producto
- crear imagen de package contents si el contenido esta verificado
- crear visual de dimensiones si las dimensiones son reales
- crear infografia simple con claims permitidos
- preparar varias opciones visuales para revision

No puede:

- inventar datos
- inventar medidas
- inventar materiales
- inventar certificaciones
- inventar shipping
- inventar stock USA
- inventar Free Shipping
- usar logos/marcas no autorizadas
- usar claims medicos
- publicar sin aprobacion

## 14. QA visual manual

Toda imagen creada manualmente debe revisarse contra checklist:

- producto coincide con facts
- no inventa dimensiones
- no inventa material
- no inventa claims
- texto en ingles correcto
- no hay logos no autorizados
- trust signals verificados
- imagen no parece enganosa
- producto es protagonista
- mobile-first
- apta para eBay despues de revisar politicas vigentes
- requiere aprobacion humana final

Si una persona no puede confirmar un punto critico, la imagen debe quedar en needs changes, rejected o needs data.

## 15. Decisiones de aprobacion

Estados manuales:

- `MANUAL_IMAGE_NOT_CREATED`
- `MANUAL_IMAGE_CREATED_FOR_REVIEW`
- `MANUAL_IMAGE_NEEDS_CHANGES`
- `MANUAL_IMAGE_REJECTED`
- `MANUAL_IMAGE_APPROVED_FOR_INTERNAL_USE`
- `MANUAL_IMAGE_READY_FOR_LISTING_REVIEW`

`MANUAL_IMAGE_APPROVED_FOR_INTERNAL_USE` no publica, no crea draft y no modifica listings.

`MANUAL_IMAGE_READY_FOR_LISTING_REVIEW` solo significa que la imagen puede avanzar a una revision interna de listing. No equivale a publicacion ni integracion eBay.

## 16. Almacenamiento futuro

En este loop no se guarda ninguna imagen.

Reglas futuras:

- futuro almacenamiento debe disenarse aparte
- no guardar imagenes en el repo sin decision explicita
- no guardar imagenes con datos sensibles
- no usar URLs privadas
- no persistir assets sin aprobacion

El almacenamiento de assets debe tener reglas de seguridad, propiedad, versionado, autorizacion y limpieza antes de cualquier uso real.

## 17. Relacion con Admin

La ruta `/admin/ebay-image-generator` hoy muestra PromptPlan y Dry Run calculado localmente.

En el futuro puede mostrar Manual Image Brief.

En el futuro puede registrar estado manual de imagen.

En este loop no se modifica UI.

El Admin debe seguir siendo read-only hasta que exista un diseno seguro para cualquier accion manual registrada.

## 18. Relacion con eBay

Este flujo:

- no crea listing
- no crea draft
- no publica
- no sube imagenes
- no modifica listings

Antes de uso real:

- revisar politicas vigentes de eBay
- confirmar que la imagen representa el producto real
- confirmar que los trust signals estan verificados
- aprobar manualmente

Este workflow prepara assets para revision. No ejecuta acciones sobre eBay.

## 19. Que NO hacer

No hacer:

- no conectar OpenAI API
- no generar imagenes reales en este loop
- no crear API keys
- no crear API route
- no crear service
- no crear draft real
- no publicar
- no mutar listings
- no guardar reportes reales
- no subir imagenes
- no usar datos sensibles
- no usar URLs privadas
- no usar proveedores reales

Este documento no autoriza acciones reales. Solo define el flujo manual controlado para una etapa futura.

## 20. Proximos loops recomendados

- `LOOP 091 - Manual Image Brief Schema V1`
- `LOOP 092 - Manual Image Brief Fixture V1`
- `LOOP 093 - Admin Manual Image Brief Display V1`
- `LOOP 094 - Manual Image QA Checklist Result V1`

## Fast-track documentation-only

Este loop puede avanzar por fast-track documentation-only solo si:

- el cambio sigue siendo documentation-only
- solo se agrega este documento
- `git diff --check` pasa
- `git diff --cached --check` pasa
- `npx tsc --noEmit` pasa
- `node --test tools/ebay-winner-pipeline-tests.mjs` pasa
- el grep de seguridad encuentra solo menciones educativas, campos esperados o reglas de bloqueo
- Vercel y Vercel Preview Comments quedan en success

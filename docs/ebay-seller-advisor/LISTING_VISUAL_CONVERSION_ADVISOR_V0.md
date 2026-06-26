# Listing Visual Conversion Advisor V0

## Proposito

Listing Visual Conversion Advisor V0 define como planear, evaluar y repetir estrategias visuales profesionales para listings eBay.

Principio:

El producto debe ser el protagonista. Las imagenes deben generar clic, confianza y conversion sin verse cargadas.

Este advisor no habilita drafts, publicacion, modificacion de listings, pausa, orders, pagos ni acciones reales de eBay. Su alcance V0 es documentar estrategia visual, disciplina de prueba y aprendizaje.

## Relacion Con Otros Advisors

- Listing Seller Advisor Prompts define que imagenes pedir.
- Listing Visual Conversion Advisor define como evaluar, probar y aprender que patron visual convierte.
- Seller Consistency Advisor decide cuando observar, optimizar o escalar.
- Launch Observation Advisor evita cambios impulsivos.
- Stock Rotation Risk Guardrail mantiene prioridad si el stock es bajo.

Si el stock bajo bloquea campana, pack, publicacion o escalamiento, una mejora visual no debe saltarse ese bloqueo.

## Arquitectura Futura Sugerida

Modulos futuros:

- `lib/listing-visual-conversion-advisor/main-image-strategy.mjs`
- `lib/listing-visual-conversion-advisor/lifestyle-image-strategy.mjs`
- `lib/listing-visual-conversion-advisor/secondary-image-plan.mjs`
- `lib/listing-visual-conversion-advisor/visual-metrics-diagnosis.mjs`
- `lib/listing-visual-conversion-advisor/winning-patterns.mjs`
- `lib/listing-visual-conversion-advisor/index.mjs`

Implementacion recomendada:

- Docs primero.
- Modulo puro despues.
- Integracion con prompts despues.
- UI mucho despues.

## Reglas Visuales

### Imagen Principal

Objetivo principal: mejorar CTR en resultados de busqueda.

Reglas:

- Fondo blanco o neutro.
- Producto centrado.
- Buena iluminacion.
- Producto grande sin recortes.
- Sin distracciones.
- Sin texto excesivo.
- Sin logos no autorizados.
- Sin promesas visuales no comprobadas.

La imagen principal debe responder rapido: "Es el producto que busco?"

### Imagen Lifestyle

Objetivo principal: mejorar confianza y conversion.

Reglas:

- Persona adulta, natural, profesional y confiable usando el producto.
- La persona no debe robar protagonismo.
- Producto visible y en foco.
- Fondo limpio.
- Escena aspiracional pero realista.
- Sin sexualizacion ni distracciones.
- Vender por uso, confianza y contexto, no por apariencia fisica.

La imagen lifestyle debe mostrar uso real sin convertir a la persona en el producto.

## Plan De 7 Imagenes

### 1. Principal / Fondo Blanco / Click

- Resuelve: "Es el producto que busco?"
- Impacta: CTR.
- Objetivo comercial: ganar el clic con claridad inmediata.
- Composicion: producto centrado, grande, bien iluminado, sin recorte.
- Debe incluir: producto real y cantidad visual correcta cuando aplique.
- No debe incluir: texto excesivo, badges falsos, logos no autorizados, props que confundan.

### 2. Lifestyle / Persona Usando Producto / Contexto

- Resuelve: "Como se usa en la vida real?"
- Impacta: conversion.
- Objetivo comercial: generar confianza y contexto de uso.
- Composicion: persona adulta usando el producto en una escena limpia.
- Debe incluir: producto visible y en foco.
- No debe incluir: sexualizacion, distracciones, exageracion, pose que robe protagonismo.

### 3. Detalle Premium / Material / Textura / Calidad

- Resuelve: "Se ve confiable?"
- Impacta: conversion.
- Objetivo comercial: reducir duda sobre calidad percibida.
- Composicion: close-up de material, textura, acabado o detalle relevante.
- Debe incluir: detalle verificable del producto.
- No debe incluir: claims de calidad no comprobados o certificaciones inventadas.

### 4. Dimensiones / Escala / Tamano Real

- Resuelve: "Me sirve el tamano?"
- Impacta: conversion y reduce devoluciones.
- Objetivo comercial: evitar sorpresa por escala.
- Composicion: producto con referencia de tamano o dimensiones verificadas.
- Debe incluir: medidas reales cuando existan.
- No debe incluir: estimaciones no validadas o perspectiva enganosa.

### 5. Beneficio En Accion

- Resuelve: "Que problema me ayuda a resolver?"
- Impacta: conversion.
- Objetivo comercial: mostrar utilidad sin prometer resultados no comprobados.
- Composicion: producto resolviendo un uso concreto.
- Debe incluir: beneficio practico y realista.
- No debe incluir: claims medicos, garantias, exageraciones o resultados inventados.

### 6. Contenido Del Paquete

- Resuelve: "Que recibo exactamente?"
- Impacta: conversion y reduce confusion.
- Objetivo comercial: aclarar cantidad, piezas y contenido incluido.
- Composicion: flat lay o agrupacion clara de componentes.
- Debe incluir: solo lo que viene incluido.
- No debe incluir: accesorios no incluidos o cantidades no confirmadas.

### 7. Diferenciador / Otro Angulo / Confianza

- Resuelve: "Por que este listing y no otro?"
- Impacta: conversion.
- Objetivo comercial: reforzar confianza sin copiar competidores.
- Composicion: angulo adicional, detalle de confianza o comparacion factual permitida.
- Debe incluir: diferenciador verificable.
- No debe incluir: comparaciones falsas, marcas no autorizadas o promesas visuales no comprobadas.

## Diagnostico Visual Por Metricas

- Muchas impresiones y pocos clics: revisar imagen principal, titulo y precio visible.
- Muchos clics y pocas ventas: revisar imagenes secundarias, descripcion, item specifics, confianza y precio.
- Pocas impresiones: revisar keywords, categoria, demanda y titulo.

La imagen no debe diagnosticarse aislada si titulo, precio, categoria o demanda tambien pueden explicar el problema.

## Sistema De Aprendizaje

Winning Visual Pattern futuro:

```json
{
  "pattern_id": "...",
  "product_family": "...",
  "main_image_type": "white_background_centered_product",
  "lifestyle_image_type": "adult_real_use_clean_background",
  "before_metrics": {},
  "after_metrics": {},
  "change_date": "...",
  "observed_days": 7,
  "ctr_delta": 0,
  "conversion_delta": 0,
  "confidence": "low | medium | high",
  "notes": []
}
```

Reglas:

- Observar aproximadamente 7 dias cuando aplique.
- No cambiar todas las imagenes a la vez.
- Cambiar una variable visual por prueba.
- Si mejora CTR, documentar patron de imagen principal.
- Si mejora conversion, documentar patron de imagenes secundarias.
- Si funciona en varios productos similares, convertirlo en template visual.

## Output Conceptual

```json
{
  "visual_strategy_status": "needs_assets | ready_for_visual_plan | testing_pattern | winning_pattern_found",
  "main_image_strategy": "...",
  "lifestyle_image_strategy": "...",
  "secondary_images": [],
  "buyer_objections_covered": [],
  "visual_risks": [],
  "metrics_to_watch": [],
  "optimization_rule": "change_one_visual_variable_at_a_time",
  "winning_pattern_candidate": null,
  "human_approval_required": true
}
```

Reglas del output:

- `human_approval_required` debe permanecer `true`.
- `optimization_rule` debe favorecer una variable visual por prueba.
- `winning_pattern_candidate` debe permanecer `null` hasta tener datos suficientes.
- El output no debe habilitar publicacion ni cambios reales.

## Datos Necesarios

- Tipo de producto.
- Categoria.
- Imagen principal actual.
- Imagenes secundarias.
- Autorizacion de imagenes.
- Impressions.
- Clicks.
- CTR.
- Watchers.
- Conversion.
- Sales.
- Fecha de cambios visuales.
- Historial de cambios.
- Precio visible.
- Titulo.

## Riesgos

- Copiar visuales de competidores en vez de crear un patron propio.
- Usar persona o escena que robe protagonismo al producto.
- Sobrecargar imagenes con texto, iconos o promesas.
- Cambiar demasiadas imagenes a la vez.
- Optimizar antes de tener datos suficientes.
- Confundir mejora de CTR con mejora de conversion.
- Ignorar stock bajo o riesgo operativo aunque el visual mejore.

## Orden Futuro Recomendado

Despues de PR #20 y patches previos:

1. Aplicar documentacion del advisor visual.
2. Crear modulo puro con plan de 7 imagenes.
3. Agregar tests read-only.
4. Integrar con Listing Seller Advisor Prompts.
5. Integrar con Seller Consistency Advisor.
6. Agregar registro manual de cambios visuales.
7. Mas adelante guardar Winning Visual Patterns.
8. UI solo despues.

## Prohibiciones V0

- No eBay API real.
- No OAuth real.
- No tokens.
- No drafts reales.
- No publicacion.
- No modificacion de listings.
- No pausa real.
- No orders/pagos.
- No secretos.
- No UI en V0.
- No integracion con `decision-advisor` en V0 docs-only.

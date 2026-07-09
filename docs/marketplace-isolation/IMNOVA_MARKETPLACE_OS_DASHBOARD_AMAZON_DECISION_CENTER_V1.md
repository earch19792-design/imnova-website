# IMNOVA Marketplace OS Dashboard + Amazon Decision Center V1

## Por Que

LOOP 149UI hace visible Marketplace Seller OS dentro del admin de IMNOVA. Amazon Track ya tiene motores locales desde 149A hasta 149F, pero el vendedor necesita una pantalla clara que responda que producto se puede investigar, cual esta bloqueado, cuanto margen tiene, que riesgo existe y cual es la siguiente accion.

## Estado Actual

eBay sigue pausado/YELLOW operativo porque la cuenta vendedora no esta resuelta. Amazon esta activo como centro local de decisiones. Produccion sigue congelado y Core-only. El dashboard es read-only y usa datos locales sanitizados.

## Problema Que Resuelve

Antes de este dashboard, las decisiones vivian en modulos, tests, fixtures y dry-runs CLI. La pantalla convierte esas decisiones en una vista operativa para que el equipo vea productos evaluados, bloqueados, watchlist, revision humana y por que ningun producto esta listo para preparar listing todavia.

## Motor Interno vs Centro Visual

El motor interno calcula decisiones. El centro visual las explica. Esta pagina no reemplaza Seller Central, no conecta con Amazon y no ejecuta acciones de marketplace.

## Regla UX Para Vendedor

El dashboard debe responder preguntas de vendedor antes de mostrar nombres tecnicos:

- Que producto puedo vender?
- Que producto esta bloqueado?
- Por que esta bloqueado?
- Cual es la ganancia estimada y el ROI?
- Debo usar ASIN existente, investigar mas o rechazarlo?
- Cual es la siguiente accion humana?

Senales tecnicas como `149A`, `ASIN Decision Engine`, `Restriction Gate` y `Profit Guard` siguen siendo utiles para auditoria, pero el lenguaje principal de la UI debe ser operativo: evaluados, bloqueados, revision humana, posible ASIN existente, margen estimado, no preparar listing todavia y proxima accion.

## eBay

El dashboard muestra eBay como `PAUSED_YELLOW_OPERATIONAL`, con foundation en LOOP 149 y la accion pendiente de resolver la cuenta eBay antes de LOOP 150.

## Amazon

El dashboard muestra Amazon como `ACTIVE_LOCAL_DECISION_ENGINE`, con loops completados 149A, 149B, 149C, 149D, 149E y 149F. El siguiente loop tecnico de Amazon sigue siendo 149G.

## Resumen 149A-149F

- 149A: productos ganadores y readiness de listing.
- 149B: cuenta Amazon Seller y category gate.
- 149C: matcher Luna Portex contra catalogo Amazon sanitizado.
- 149D: restriction, category, brand y GTIN gate.
- 149E: fees, profit guard y ROI.
- 149F: decision ASIN existente vs ASIN nuevo.

## Interpretacion DM0628N

DM0628N tiene evidencia fuerte de marca/modelo/tamano y confianza de match 97. Tiene ROI positivo, pero sigue como `WATCHLIST_EXISTING_ASIN` porque faltan revision hazmat, compliance quimico, elegibilidad manual en Seller Central y revision de margen. No puede pasar a Amazon Listing Package todavia.

## Por Que No Usa APIs

Este loop no usa Amazon API, SP-API, escrituras Supabase, eBay Production API, WhatsApp, OpenAI, Codex API ni scrapers. Es una UI local sobre datos sanitizados.

## Por Que No Publica Nada

No se publica ningun producto, no se crea ASIN, no se crea listing y no se escribe en Seller Central. La pagina es read-only y los controles de roadmap son solo preview.

## Roadmap WhatsApp y Automatizacion

WhatsApp Remote Control y Marketplace Automation aparecen solo como roadmap planificado. No hay envio real de WhatsApp ni automatizacion activa de marketplaces en este loop.

## Roadmap Automejora Con Codex

El motor de automejora IMNOVA es la capa futura donde IMNOVA OS detecta oportunidades internas de mejora desde el estado del dashboard, dry-runs, tests, bloqueos y decisiones del operador.

La capa de handoff a Codex convierte esas oportunidades en work orders y prompts seguros para Codex. No ejecuta codigo por si sola. Produce instrucciones revisables, archivos esperados, validaciones, limites de seguridad y notas de rollback para aprobacion humana.

Flujo previsto:

- IMNOVA detecta un gap, bloqueo u oportunidad.
- IMNOVA crea una tarea en el backlog de automejora.
- IMNOVA genera un work order/prompt para Codex.
- Un humano revisa y aprueba antes de implementar.
- Codex trabaja en una rama segura.
- Corren tests y checks de PR.
- Un humano decide si se mergea.

La aprobacion humana es obligatoria porque la automatizacion de marketplace puede afectar elegibilidad de productos, salud de cuenta, compliance y seguridad de Produccion. El dashboard nunca debe convertir una sugerencia interna en cambio automatico de codigo, write a branch/main, merge automatico, accion en Seller Central, publicacion o cambio en Produccion.

LOOP 149UI no conecta Codex API. Solo muestra el roadmap como `ROADMAP_ONLY_NO_API`. La conexion futura queda gated porque los prompts no deben contener secretos, tokens, datos sensibles, credenciales de marketplace ni instrucciones sin control para Produccion.

Secuencia planificada:

- 149CODEX-A — Self-Improvement Backlog + Codex Handoff Builder.
- 149CODEX-B — Codex API Connection Layer + Safe Execution Gate.
- Luego 149G — Amazon Listing Package Builder.

## Como Alimenta 149G

149G puede usar esta vista como contexto para construir el Amazon Listing Package Builder. Los productos solo deben continuar a preparacion de listing despues de resolver ruta, elegibilidad, restricciones, compliance y margen.

## Limites De Seguridad

- No escritura en Production.
- No escritura en Staging DB.
- No escrituras Supabase.
- No Amazon API ni SP-API.
- No escritura en Seller Central.
- No ASIN creation.
- No listing creation.
- No publicacion.
- No eBay Production API.
- No WhatsApp real send.
- No OpenAI ni image generation.
- No Codex API.
- No cambios automaticos de codigo.
- No merge automatico.
- No scraper.
- No cambios `.env`, secretos, tokens, dumps, backups, uploads, downloads o migrations.

## Definition Of Done

El loop queda listo cuando la ruta admin renderiza el dashboard, el view model local construye, el dry-run pasa, los tests validan safety flags y filas de producto, TypeScript pasa y las regresiones Amazon/eBay/Luna siguen verdes.

## Regla De Explicacion Humana

Cada producto debe explicar ruta, confianza, ROI, ganancia neta, razones de bloqueo, alertas y siguiente accion humana en lenguaje claro.

## Siguiente Paso

Paso estrategico recomendado: 149CODEX-A — Self-Improvement Backlog + Codex Handoff Builder.

Luego continuar Amazon: 149G — Amazon Listing Package Builder.

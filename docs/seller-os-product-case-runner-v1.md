# Seller OS — Product Case Runner V1

## Alcance

`/admin/ebay/product-case-runner` instrumenta un solo caso de producto dentro
de `SINGLE_PRODUCT_LAB`. El Runner prepara evidencia y un paquete para una
publicación manual supervisada. No persiste el caso, no publica, no enlaza un
listing real y no modifica reglas del Strategy Lab.

La base de este paso es el commit
`932bf5375b77d6582b93776eb23c5146d11d776d` de
`feature/seller-os-strategy-lab-v1`. El Strategy Lab y sus tres casos dorados
permanecen sin cambios.

## Flujo instrumentado

```text
Luna Product URL
  -> Supplier Evidence
  -> Product Facts
  -> Market Evidence
  -> Scenario Economics
  -> Strategy Recommendation
  -> Human Review
  -> Listing Package
  -> Image and Commercial QA
  -> Manual eBay Handoff
  -> Manual Listing Registration
  -> Read-only Monitoring
  -> Performance Review
  -> Learning Observation
```

V1 implementa el ingreso, revisión, análisis y preparación del paquete. Las
fases posteriores se representan explícitamente, pero permanecen bloqueadas
hasta que el humano publique desde eBay Seller Hub y registre después el Item
ID. Seller OS nunca presenta una acción de publicación eBay.

La máquina visible del Runner usa exactamente estas fases:

1. `SUPPLIER_SOURCE`
2. `PRODUCT_EVIDENCE`
3. `HUMAN_VISUAL_REVIEW`
4. `IDENTITY_AND_VARIANTS`
5. `MARKET_EVIDENCE`
6. `SCENARIO_ECONOMICS`
7. `STRATEGY_RECOMMENDATION`
8. `HUMAN_SHADOW_REVIEW`
9. `IMAGE_AND_COMMERCIAL_QA`
10. `MANUAL_LISTING_PACKAGE`
11. `MANUAL_EBAY_HANDOFF`
12. `MANUAL_LISTING_REGISTRATION`

Cada fase puede estar `NOT_STARTED`, `IN_PROGRESS`,
`HUMAN_REVIEW_REQUIRED`, `BLOCKED` o `COMPLETED`. Un bloqueo se propaga: ninguna
fase posterior puede aparecer completada. La fase 12 permanece bloqueada hasta
una publicación humana y muestra: “Después de publicar manualmente, registra
el Item ID para iniciar el enlace y monitoreo read-only.”

## Fuente Luna y seguridad

El preflight es una lectura pública y acotada. Acepta solamente:

- `https`;
- host exacto `lunaportex.com` o `www.lunaportex.com`;
- ruta exacta `/products/<handle>`;
- resolución DNS pública;
- contenido de texto permitido y dentro del límite configurado.

Rechaza credenciales en la URL, puertos personalizados, localhost, IPs,
direcciones privadas o link-local, escapes ambiguos y redirecciones fuera del
origen permitido. Las redirecciones no se siguen automáticamente. La petición
tiene timeout corto, límite de bytes, `credentials: omit`, caché deshabilitada
y no registra el cuerpo.

`401`, `403`, una redirección a login o una respuesta reconocible de acceso
restringido producen `AUTHENTICATED_SOURCE_REQUIRED`. Ese es un estado esperado,
no un error inesperado. El operador debe abrir Luna por su cuenta, autenticarse
fuera de Seller OS y copiar únicamente el contenido visible que desee revisar.
Seller OS no recibe contraseñas, cookies ni sesiones Luna.

En ese estado, `SUPPLIER_SOURCE` muestra inmediatamente el textarea
`PEGAR CONTENIDO VISIBLE AUTENTICADO DE LUNA` y las acciones
`PROCESAR EVIDENCIA DEL PROVEEDOR` y `LIMPIAR CONTENIDO`. Son formularios
locales permitidos por Pilot Mode: no disparan workers, persistencia ni acciones
de marketplace.

El textarea acepta únicamente texto visible del producto y exige una
confirmación humana explícita antes de procesar. Rechaza HTML completo y
patrones detectables de contraseñas, email, JWT, bearer/cookie aun sin `:`,
números de tarjeta válidos por Luhn, autorización, pagos o datos personales de
la cuenta. El resultado se registra como
`NO_SENSITIVE_PATTERN_DETECTED`; no afirma que la ausencia de datos sensibles
sea una certeza absoluta. El texto permanece en memoria del navegador; no se
ejecutan scripts, no se inyecta HTML, no se cargan recursos y no se envía el
contenido al servidor. Después del procesamiento se conserva dentro del
Product Case local como:

```text
supplierUrl
rawVisibleSourceText
sourceAccessStatus
sourceCaptureMethod: MANUAL_AUTHENTICATED_PASTE
sensitiveContentAssessment: NO_SENSITIVE_PATTERN_DETECTED
humanVisibleProductTextConfirmed: true
parserVersion
sourceContractVersion: LUNA_SOURCE_CONTRACT_V1
parseHealth
stockState
extractionWarnings
evidenceCandidates
missingFields
```

El caso puede exportarse con un `Blob` local; no se almacena en Supabase, en el
servidor ni en archivos. El Export JSON conserva el texto original y el import
lo restaura para la revisión de la sesión siguiente.

El mismo envelope JSON puede reimportarse localmente. El importador valida
tamaño, versión, forma e invariantes fail-closed antes de reconstruir el
workspace; recalcula SHA-256 desde `rawVisibleSourceText` y lo coteja tanto con
`supplierSourceCapture.contentHash` como con el `ProductCaseCapture`
correspondiente. Un texto alterado se rechaza aunque mantenga exactamente el
mismo `byteLength`. Tampoco confía en un `manualHandoffAllowed` arbitrario. El
round-trip
conserva evidencia original, observaciones, correcciones, conflictos, costos,
comparables, estrategia, operaciones de listing, razones de override y
learning observations, sin persistencia automática.

Limpiar o reprocesar una captura pasa por una transición pura. La transición
retira la evidencia y captura reemplazadas, elimina referencias actuales
obsoletas, cierra el conflicto activo, conserva su etiqueta sólo en
`conflictHistory` e invalida la revisión de identidad para exigir una nueva
revisión humana.

## Luna Source Contract Guard V1

Cada extracción conserva la versión exacta del parser y
`sourceContractVersion: LUNA_SOURCE_CONTRACT_V1`. La salud del contrato es uno
de `PARSED_OK`, `PARTIAL_EXTRACTION`, `SOURCE_FORMAT_CHANGED` o
`AUTHENTICATION_REQUIRED`; el inventario se representa de forma independiente
como `IN_STOCK_SIGNAL`, `OUT_OF_STOCK_SIGNAL`, `STOCK_UNKNOWN` o
`STOCK_CONFLICTED`.

La ausencia de una señal de stock nunca equivale a cero, y un fallo del parser
nunca equivale a `OUT_OF_STOCK_SIGNAL`. Si el texto contiene `Regular price`,
`Sale price`, `units available`, `Out of stock` o `Sold out` pero el dato
correspondiente no se reconoce, el guard usa `SOURCE_FORMAT_CHANGED`, exige
revisión humana y bloquea cualquier paquete o handoff eBay. Un cambio de
`parserVersion` invalida la captura vigente hasta que el texto original se
reprocese.

## Evidencia y revisión humana

Cada propuesta conserva:

- tipo y URL de fuente;
- instante de captura y hash del contenido;
- método determinístico y ruta de extracción;
- valor raw, original, normalizado y corregido;
- clase y estado de evidencia;
- veredicto y motivo humano.

Todo dato de Luna comienza como `SUPPLIER_STATED`. La señal “Top Sellers” usa
`SUPPLIER_MERCHANDISING_SIGNAL` y queda fuera del adaptador del Strategy Lab.
No constituye una venta eBay ni demanda verificada. Precio y stock del proveedor
no son precio de mercado ni demanda. Shipping general no es costo outbound.
Packaging o shipping desconocidos permanecen `MISSING`; jamás se convierten en
cero.

El operador puede aplicar `ACCEPT`, `REJECT`, `CORRECT` o
`NEEDS_MORE_EVIDENCE`. Rechazar o corregir exige motivo. Una corrección conserva
el valor original y no eleva automáticamente la fuente a
`PRODUCT_VERIFIED`. Solamente evidencia aceptada o corregida puede llegar al
adaptador puro. Los conflictos entre título, descripción, variantes y contenido
estructurado se conservan; el Runner no elige silenciosamente un lado.
El parser puede detectar candidatos evidentes como `0.12 kg`, `PVC cloth`,
`Black`, `Grey` o `USD 8.00`, pero no afirma comprender semánticamente la
descripción completa. Cada candidato conserva el texto raw, su normalización,
el método de extracción y el estado de aceptación humana.

La extracción textual separa `regular_price` de `sale_price`, transforma stock
numérico únicamente en `INVENTORY_SIGNAL`, mantiene especificaciones declaradas
como `SUPPLIER_STATED` y clasifica beneficios promocionales como
`SUPPLIER_MARKETING_CLAIM`. Claims, merchandising y stock quedan fuera de
product facts de estrategia. Un costo o campo ausente permanece `MISSING`, no
cero.

## Adaptador al Strategy Lab

El adaptador no inventa defaults y no usa los comparables de los tres fixtures
dorados. Falla cerrado si falta identidad, variante, costo respaldado,
packaging, outbound shipping, evidencia de mercado, dimensiones requeridas o
evidencia del pack.

Cuando no se ha ejecutado una investigación eBay:

```text
MARKET EVIDENCE: NOT_RUN
SOLD_EXACT: MISSING
ACTIVE_EXACT: MISSING
MARKET CEILING: MISSING
```

Una evaluación incompleta devuelve `HOLD_EVIDENCE_INCOMPLETE`. El escenario con
mayor respaldo visible se llama `CURRENT EVIDENCE LEADER`; no es “Preferred” ni
está aprobado para ejecutar. Una hipótesis estratégica aparece por separado
como `STRATEGIC HYPOTHESIS TO VALIDATE`.

## Gates del paquete manual

`canPublishAutomatically` siempre es `false`.
`manualHandoffAllowed` solo puede ser `true` después de revisión humana y cuando
todos estos gates tienen evidencia aceptada:

1. identidad mínima;
2. variante seleccionada;
3. pack quantity;
4. costo de producto;
5. packaging;
6. outbound shipping;
7. precio elegido;
8. categoría;
9. condición;
10. disponibilidad;
11. shipping policy;
12. return policy;
13. item specifics obligatorios;
14. imágenes reales aprobadas;
15. revisión de marca, propiedad intelectual y claims;
16. aprobación humana explícita.

Mientras falte alguno:

```text
manualHandoffAllowed: false
handoffStatus: BLOCKED
```

La única CTA de salida es `GENERAR PAQUETE PARA PUBLICACIÓN MANUAL`, deshabilitada
mientras el handoff esté bloqueado. Nunca existe una CTA “PUBLICAR EN EBAY”.

El paquete es un borrador copiable. Incluye supplier URL/SKU, variante, título
de hasta 80 caracteres, categoría, condición, item specifics, descripción,
precio, cantidad piloto, inversión, profit, margin, ROI, políticas, handling
time, item location, imágenes aprobadas y orden, evidencia por campo,
assumptions, blockers, conclusiones OS/humana, diferencias y razones de
override. Un campo sin respaldo queda bloqueado o requiere decisión humana.

## Política temporal de imágenes

El Runner registra únicamente metadatos de imágenes originales del proveedor o
preparadas manualmente: URL, propósito, orden, estado de aprobación y
observaciones. No descarga, renderiza, transforma ni genera imágenes.

Seller OS no posee visión artificial en este paso:

```text
imageAnalysisCapability: HUMAN_ASSISTED_ONLY
machineVisionStatus: NOT_IMPLEMENTED
openAiVisionUsed: false
humanReviewRequired: true
```

Una observación visual se crea exclusivamente cuando un revisor registra
manualmente `imageId`, URL fuente, producto/variante observados, features, texto,
marcas, colores, cantidad, posibles conflictos, confianza, decisión, motivo y
fecha. El revisor puede identificarse como `HUMAN` o
`CHATGPT_ASSISTED_HUMAN`, pero la captura siempre usa
`HUMAN_VISUAL_REVIEW`. La revisión rápida admite
`ACCEPT_FOR_ANALYSIS`, `NEEDS_MORE_EVIDENCE` o
`REJECT_FOR_EBAY_HANDOFF`; no exige fabricar una contradicción cuando el revisor
solamente documenta lo visible. La evidencia queda clasificada como
`HUMAN_VISUAL_REVIEW`, nunca como product fact. La fuente queda como
`SUPPLIER_IMAGE`, con
`verificationStatus: SOURCE_IMAGE_OBSERVED` y
`physicalProductVerified: false`: describe lo visible, no verifica el producto
físico entregado y no borra la evidencia textual.

Sin una observación humana estructurada, `visualEvidenceStatus` es
`NOT_REVIEWED` y el motor no puede abrir un conflicto visual. Tampoco infiere
features desde filename, alt text o URL. Cuando compara una observación
aportada por el humano contra el texto del proveedor, atribuye el resultado a
`SUPPLIER_TEXT` y `HUMAN_VISUAL_REVIEW`, nunca a machine vision.

El handoff exige revisión explícita de producto/variante, logos o marcas no
autorizadas, claims sin evidencia, compatibilidad de la imagen principal con
eBay y coherencia de las secundarias.

## Handoff y registro posterior

Si todos los gates pasan, el Runner prepara instrucciones para abrir Seller Hub.
El humano copiará los campos, revisará de nuevo y pulsará `List it` dentro de
eBay. Seller OS no llama APIs eBay de escritura.

El repositorio ya contiene el flujo canónico
`/admin/ebay/listings/register` y
`/api/admin/ebay/listings/register`. Su GET sigue siendo read-only; su POST
persistente está bloqueado por `SINGLE_PRODUCT_LAB` durante este piloto. El
Runner no duplica ni invoca ese servicio. Exporta un
`MANUAL_LISTING_REGISTRATION_DRAFT` con:

- eBay Item ID y listing URL;
- eBay SKU, account key y marketplace;
- variante y fingerprint;
- precio, cantidad, categoría y condición publicados;
- shipping/return policy, handling time y timestamp;
- referencias al Product Case y Listing Package.

El esquema actual vincula el registro a opportunity/candidate y no conserva
todo el lineage Product Case/Listing Package. Paso 3B deberá agregar, de manera
aditiva y con RLS, referencias estables a `product_case_id`,
`listing_package_id`, `supplier_variant_id`, `variant_fingerprint`,
`marketplace`, `published_at` y el snapshot operativo aprobado. Hasta entonces
el draft JSON es el artefacto portable y no se realiza ningún enlace real.

## Monitoreo y aprendizaje supervisado

Las etapas futuras se exponen bloqueadas:

- `DAY_0_LISTING_SNAPSHOT`;
- `DAY_7_PERFORMANCE_REVIEW`;
- `DAY_14_PERFORMANCE_REVIEW`;
- `DAY_30_PERFORMANCE_REVIEW`.

Impressions, page views, clicks, CTR, watchers, quantity sold, conversion,
promoted listing cost, fees, shipping real, refunds y net profit comienzan como
`MISSING / UNAVAILABLE`. Ausencia nunca significa cero.

El Runner emite una observación exportable:

```text
ruleCandidateStatus: OBSERVATION_ONLY
listingOutcomeStatus: NOT_YET_MEASURED
engineRuleChanged: false
```

Una decisión individual no cambia el engine. Una regla futura requerirá
repetición en varios productos, explicación general independiente de nombre,
SKU o título, aprobación humana y todos los golden cases verdes.

## Caso inicial

El fixture versionado inicial identifica exclusivamente:

`Smart Inflatable Golf Ball Swing Trainer — Black`.

El producto piloto anterior, ya publicado, no forma parte del Runner ni de este
ciclo. Para el entrenador, el nombre público y el precio USD 8.00 son
`SUPPLIER_STATED`; su ubicación en “New Arrivals & Restocks” es
`SUPPLIER_MERCHANDISING_SIGNAL`. Ninguna de esas fuentes prueba demanda eBay.

El fixture conserva dos enlaces eBay proporcionados por el humano únicamente
como `HUMAN_SUPPLIED_COMPARABLE_CANDIDATE`:

- Item ID `187697800648`: listing activo, precio visible aproximado USD 24.99
  y señal “9 sold”;
- Item ID `376837929124`: listing activo, precio visible aproximado USD 24.76,
  dimensiones declaradas por el competidor de 28 cm y peso de 0.16 kg.

No entran automáticamente en `SOLD_EXACT`, no crean una cohorte de ventas y no
aportan product facts. La señal “9 sold” dentro de un listing activo no
sustituye evidencia oficial de listings vendidos. Dimensiones y peso del
competidor nunca describen automáticamente el producto Luna. Ambos candidatos
requieren validación de identidad visual, variante, contenido y pack.

Antes de cualquier conclusión, el Runner solicita desde la fuente Luna
autenticada: product ID, SKU, variant ID, color, costo vigente, stock,
dimensiones de producto y paquete, peso, material, contenido, mecanismo de
inflado, accesorios, imágenes reales, advertencias y costo/cotización real de
fulfillment. No infiere bomba, correa, válvula adicional, manual ni otro
accesorio. Claims sobre postura, swing, posición de brazos o resultados de
entrenamiento permanecen comerciales y no son garantías verificadas.

La captura autenticada aportada por el humano conserva como
`SUPPLIER_STATED` el tipo de producto, material PVC cloth, colores Black/Grey,
peso 0.12 kg, uso declarado para práctica de swing y disponibilidad de 50,000
unidades. La disponibilidad tiene propósito `INVENTORY_SIGNAL` y
`demandEvidence: NONE`: no aumenta market confidence, score de estrategia ni
demanda estimada. Los superlativos y usos genéricos de running, fitness o
protección se registran como `SUPPLIER_MARKETING_CLAIM`, nunca como product
facts o copy ejecutable.

La observación visual estructurada suministrada por el humano abre el conflicto genérico
`IDENTITY_CONFLICT:SUPPLIER_DESCRIPTION_VS_PROMOTIONAL_IMAGE`. Las imágenes 1 y
3 pueden ser compatibles con una pelota y lanyard, pero no verifican válvula,
mecanismo de inflado, diámetro ni configuración desinflada; permanecen
`SOURCE_VISUAL_PENDING_IDENTITY_CONFIRMATION`. La imagen 2
presenta almacenamiento, cierre, accesorios y marcas Titleist; permanece
`REJECT_FOR_EBAY_HANDOFF` por `THIRD_PARTY_TRADEMARK_VISIBLE:TITLEIST`,
`PROMOTIONAL_COMPOSITE` y `PRODUCT_FUNCTION_NOT_VERIFIED`. Título y descripción
son declaraciones del mismo proveedor, por lo que una mayoría aparente no
resuelve el conflicto.

La variante seleccionada es Black; el proveedor también declara Grey. Los IDs
de ambas variantes y su mapeo a imágenes permanecen `MISSING`. Los tres
resultados aportados desde Seller Hub tampoco forman un cohort exacto: uno es
`SIMILAR_NOT_EXACT` y dos son `REJECTED` por marca Tour Striker, condición usada
y product type incompatible. En consecuencia, `soldExactCount` es cero y no se
calcula una mediana `SOLD_EXACT`.

El estado actual esperado es:

```text
intendedProductType: INFLATABLE_GOLF_SWING_TRAINER
evidenceClass: SUPPLIER_STATED
identityStatus: CONFLICTED
identityConfidence: LOW
productFactsReadiness: NOT_READY
marketEvidence: INSUFFICIENT
marketModel: INSUFFICIENT_EVIDENCE
soldExactCount: 0
economicsStatus: MISSING_INPUT
strategyGate: HOLD_IDENTITY
manualHandoffAllowed: false
canPublishAutomatically: false
nextAction: VERIFY_PHYSICAL_PRODUCT_AND_VARIANT
```

Los blockers vigentes son:

```text
PROMOTIONAL_IMAGE_PRODUCT_FUNCTION_CONFLICT
BLACK_VARIANT_ID_MISSING
GREY_VARIANT_ID_MISSING
VARIANT_IMAGE_MAPPING_MISSING
INFLATED_DIAMETER_MISSING
PACKAGE_DIMENSIONS_MISSING
INFLATION_VALVE_NOT_VISIBLE
PUMP_INCLUDED_STATUS_MISSING
LANYARD_LENGTH_MISSING
PACKAGE_CONTENTS_MISSING
OUTBOUND_SHIPPING_MISSING
SOLD_EXACT_COHORT_MISSING
```

El caso no genera todavía título final, listing package ni creative brief
ejecutable. Para salir de `HOLD_IDENTITY` necesita evidencia verificable del
producto físico, válvula o mecanismo de inflado, dimensiones, lanyard, empaque,
SKU/variant ID e imágenes coherentes con la variante suministrada. La
observación supervisada propone
`TITLE_CANNOT_OVERRIDE_CONTRADICTORY_VISUAL_EVIDENCE`, con
`ruleCandidateStatus: OBSERVATION_ONLY` y `engineRuleChanged: false`; no cambia
ninguna regla.

Una posible fase futura `VISION_SHADOW_MODE` podrá comparar una lectura
automatizada contra la revisión humana, sin autoridad para aprobar imágenes,
crear listings o publicar. No se implementa en V1.

## Recorridos de aceptación

El recorrido A es el entrenador de golf real. Se detiene en
`IDENTITY_AND_VARIANTS: BLOCKED`; las fases posteriores no pueden quedar
`COMPLETED`, `MANUAL_LISTING_PACKAGE` no genera contenido READY y el handoff
permanece deshabilitado.

El recorrido B usa un fixture completamente sanitizado, determinístico,
sin evidencia de mercado real y sin relación con un listing. Demuestra que el
motor genérico puede completar las fases pre-publicación, calcular economía
con costos trazables, obtener una recomendación pura, pasar revisión humana e
imagen/claims QA y producir un paquete para entrada manual en Seller Hub. No
ejecuta ninguna acción externa. `MANUAL_LISTING_REGISTRATION` permanece
`BLOCKED` intencionalmente porque ni el fixture ni Seller OS publican.

La corrección 3A.1 añade un tercer test estructural de captura interactiva con
un producto genérico recargable. El texto incluye stock, precio regular y de
oferta, carga, autonomía, IP rating, batería, potencia, accesorios y claims.
Las reglas se activan por etiquetas y estructura; el dominio no contiene
decisiones por título, SKU, URL ni el nombre de un producto.

## Contención

- cero migraciones y cambios de esquema;
- cero Supabase writes;
- cero eBay writes;
- cero OpenAI y WhatsApp;
- cero imágenes generadas o transformadas;
- cero publicación, repricing o cambios de listings;
- cero aprendizaje automático;
- cero enlace de listings reales;
- Production fuera de alcance.

# Primer listing manual → automatización Seller OS V1

## Resultado operativo

El primer listing se publica manualmente en eBay Seller Hub. Después, Seller OS
lo vincula por `Item ID`, confirma en modo read-only que pertenece a la cuenta
oficial y reutiliza solamente defaults operativos seguros. No copia contenido
comercial de otros vendedores y no publica automáticamente.

El primer listing es una prueba de extremo a extremo, no evidencia suficiente
para afirmar que el algoritmo ya aprendió. El ajuste de ranking sólo se habilita
por categoría con al menos 10 listings propios enlazados, 14 días observados y
500 impresiones oficiales; el ajuste está limitado a ±5 puntos y nunca modifica
las guardas de identidad, stock, costo o rentabilidad.

## Secuencia exacta

1. Ejecutar el sync Luna y el scan eBay. Elegir únicamente una oportunidad que
   el servidor marque como apta para abrir el Listing Workspace.
2. En el Workspace completar fotos propias/autorizadas, peso, dimensiones,
   categoría e item specifics oficiales. La imagen optimizada queda pendiente
   hasta que una persona compare original y resultado.
3. Revisar la economía canónica del servidor: costo Luna, fee estimado, envío,
   reserva de devoluciones/promoción, utilidad, margen y ROI. Cambiar el precio
   vuelve a calcular todo; un valor enviado por el navegador nunca decide la
   aprobación.
4. Copiar exactamente el SKU reservado `IMNOVA-…` del Workspace en el campo
   **Custom label (SKU)** de Seller Hub y publicar manualmente una unidad.
5. Usar desde ese mismo Workspace la acción “Ya lo publiqué manualmente”, que
   abre `/admin/ebay/listings/register` con oportunidad, candidato, variante y
   SKU esperado ya vinculados; el vendedor sólo pega el Item ID/URL.
6. El servidor ejecuta Trading `GetUser` + `GetItem`. Sólo `verified` activa una
   plantilla; cuenta/token/seller/listing y el Custom label reservado deben
   coincidir, y el listing debe estar activo. La evidencia y el vínculo se
   guardan en una sola transacción. El scan diario reverifica primero los
   vínculos más antiguos. Un listing terminado, una cuenta/SKU distinta o una
   lectura no comprobable desactivan su plantilla y ponen su mapping activo en
   `ended`/`unknown` hasta recuperar evidencia válida.
7. Los siguientes paquetes pueden precargar únicamente los IDs que `GetItem`
   observó en el listing propio: categoría, condición y políticas disponibles.
   Lo escrito manualmente en el navegador nunca se vuelve plantilla. El
   preflight eBay vuelve a validar cada valor antes de cualquier draft.
8. El scan diario solicita exactamente 14 días UTC completos, terminando ayer,
   y sólo incluye listings cuya verificación sea anterior o igual al inicio de
   esa ventana. Si `lastUpdatedDate` no cubre todo el período, no persiste el
   snapshot ni aprende de datos incompletos. `startDate` y `endDate` deben venir
   explícitamente en la respuesta oficial; nunca se sustituyen con las fechas
   solicitadas. Consultar manualmente la pantalla
   Seller Performance sólo lee el reporte y el aprendizaje almacenado: nunca
   persiste evidencia ni entrena.

Los defaults y las métricas sólo aceptan una reverificación oficial de menos de
36 horas. Una comprobación diaria exitosa conserva el inicio del intervalo
verificado para que el período causal pueda madurar; si hubo un downgrade, la
siguiente recuperación inicia un intervalo nuevo.

El sync de Inventory API no se usa para descubrir el primer listing creado en
Seller Hub: eBay no expone esos listings allí salvo que se migren expresamente.
Por eso el alta inicial depende de `GetUser` + `GetItem`; el sync Inventory se
mantiene como una fuente adicional para los listings que sí administra esa API.

## Categoría e item specifics oficiales

Cada validación de draft vuelve a consultar eBay Taxonomy y fija junto al
paquete el `categoryTreeId`, `categoryTreeVersion` y las restricciones de cada
aspecto: modo, cardinalidad, longitud máxima, tipo/formato, tipo avanzado,
fecha aproximada de futura obligatoriedad, valores oficiales y dependencias
entre valores. Cambiar el Category ID exige cargar nuevamente ese snapshot.

El servidor bloquea el readiness si el snapshot está incompleto o si no puede
probar una restricción. `SELECTION_ONLY` acepta exclusivamente un valor oficial;
`SINGLE` acepta uno; `MULTI` conserva el límite de 30; se validan `STRING`,
`NUMBER` (`int32`/`double`), `DATE` (`YYYY`, `YYYYMM`, `YYYYMMDD`) y
`NUMERIC_RANGE` en formato `min-max`. También se comprueban dependencias de un
valor respecto de otro aspecto. La interfaz usa selector para
`SELECTION_ONLY`, aplica `maxlength` y no permite borrar aspectos requeridos.
`expectedRequiredByDate` se muestra como fecha aproximada de eBay, pero no se
convierte por sí sola en una afirmación de obligatoriedad actual.

## Imágenes

El optimizador determinista genera JPEG 1600×1600 sobre lienzo blanco a partir
de una foto de al menos 500×500. Conserva hash del original y del resultado,
evidencia de derechos y revisión humana. Sólo procesa fondos ya claros/neutros;
si el fondo requiere segmentación real, falla cerrado y solicita preparación
manual. El original y el derivado pendiente permanecen en buckets privados; la
interfaz los muestra para revisión mediante URLs firmadas de cinco minutos. Al
aprobar, el servidor vuelve a descargar el derivado privado, comprueba tamaño y
SHA-256, lo promueve al bucket público y sólo entonces registra su URL en el
paquete. Si una aprobación anterior se interrumpió después de subir el archivo,
el reintento sólo reutiliza el objeto cuando tamaño y SHA-256 coinciden
exactamente; nunca sobrescribe un conflicto. Al rechazar, elimina original y
derivado privados; un fallo de limpieza queda señalado para conciliación
operativa.

Cada paquete admite como máximo 24 imágenes activas entre pendientes y
aprobadas, con una sola imagen principal. El reordenamiento exige incluir todas
las aprobadas y queda bloqueado mientras exista alguna pendiente; la primera
del orden pasa a ser la principal. El cambio de estado y la reconstrucción del
manifiesto se realizan en una sola transacción SQL y reinician el readiness. No
es un eliminador universal de fondos, no utiliza IA generativa y no publica en
eBay.

Se aceptan únicamente fotos propias, del proveedor con permiso escrito o con
licencia comprobable. Nunca imágenes de competidores por estar públicamente
visibles.

## Configuración para activar

Aplicar, en orden, estas migraciones:

- `20260713070000_create_ebay_image_optimization_pipeline.sql`
- `20260713071000_create_ebay_manual_listing_registration.sql`
- `20260713072000_create_ebay_post_listing_learning.sql`
- `20260713073000_scope_ebay_seller_whatsapp_claims.sql`
- `20260713074000_harden_ebay_active_listing_sync.sql`

Variables read-only del enlace y Analytics:

- `EBAY_CLIENT_ID`
- `EBAY_CLIENT_SECRET`
- `EBAY_SELLER_REFRESH_TOKEN`, autorizado originalmente con `api_scope` y
  `sell.analytics.readonly` (un refresh no agrega scopes nuevos)
- `EBAY_SELLER_ACCOUNT_KEY`
- `EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_ACCOUNT_FINGERPRINT` o
  `EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_USER_ID`
- `CRON_SECRET`
- `EBAY_IMAGE_SOURCE_HOSTS` sólo si existe otro host autorizado del proveedor

`EBAY_SELLER_ACCOUNT_KEY` es un alias estable, no un secreto. El scope real de
base de datos combina ese alias con el fingerprint esperado de producción. Si
la identidad cambia, el nuevo token no puede heredar plantillas, listings ni
ajustes del scope anterior; no existe fallback `default`.

Alertas in-app y WhatsApp también llevan ese scope. El worker sólo puede tomar
mensajes de la cuenta actualmente vinculada; filas antiguas sin scope quedan
inertes. Los listings legacy con `account_key=default` se ponen en cuarentena y
no participan en protección ni aprendizaje. Si Trading e Inventory observan el
mismo Item ID + SKU, la protección los colapsa en una identidad canónica,
prefiere Inventory para operar y conserva ambas lecturas como evidencia; así no
duplica riesgos ni alertas.

La sincronización Inventory usa generaciones monotónicas y un commit SQL
atómico por cuenta. Si una ejecución antigua termina después de otra más nueva,
su generación se ignora y no puede resucitar un listing. Los SKU `IMNOVA-…` se
resuelven primero contra el paquete canónico; un SKU Luna sólo se usa como
fallback cuando identifica una única oportunidad, nunca “la primera” de varias.
Analytics ejecuta además `GetUser` con el mismo token y compara la identidad
oficial antes de solicitar o aprender del reporte.

La identidad que eBay devuelve puede cambiar de username histórico a ID
inmutable. Ante `IDENTITY_MISMATCH`, volver a vincular el valor real observado;
el sistema permanece bloqueado hasta que la identidad esperada coincida.

El draft no publicado usa las credenciales y flags separados descritos en
`EBAY_DRAFT_ONLY_SANDBOX_V1.md`. Activar esos flags autoriza únicamente
Inventory Item + Offer `UNPUBLISHED`; nunca `publishOffer`.

## Qué permanece bloqueado

- Publicación automática o bulk publish.
- Uso de predicciones reconstruidas después del enlace para calibrar ranking.
- Aprendizaje desde competidores, reports incompletos o listings no verificados.
- Reutilización de títulos, descripciones, imágenes, claims, marca/modelo o
  valores de item specifics.
- Alertas WhatsApp reales mientras Meta no apruebe las plantillas y el feature
  flag continúe apagado.

## Criterio de éxito del piloto

El piloto pasa cuando el listing manual queda `verified`, el Custom label
coincide con el SKU reservado por el paquete de esa oportunidad/variante, se
crea una plantilla segura si eBay devolvió campos reutilizables, un segundo
paquete precarga sólo esos campos, el preflight confirma
policies/location/taxonomy vigentes y ninguna ruta llama `publishOffer`.
Ventas, CTR y conversión se evalúan después con Analytics oficial; una sola
publicación no valida causalmente la estrategia ni garantiza un producto
ganador o ventas.

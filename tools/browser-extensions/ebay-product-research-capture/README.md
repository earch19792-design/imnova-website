# Seller OS — eBay Product Research Capture

Extensión local MV3 para el piloto Preview de Loop 2.

1. Abre `chrome://extensions` o `edge://extensions`.
2. Activa **Developer mode**.
3. Selecciona **Load unpacked** y elige esta carpeta.
4. Inicia sesión normalmente en eBay dentro de ese mismo perfil de Chrome.
5. Abre Seller OS Preview y usa **INICIAR RESEARCH AUTOMÁTICO** una sola vez.

Si ya estaba instalada una versión anterior, reemplaza la carpeta extraída y pulsa
**Reload** en `chrome://extensions` o `edge://extensions`. La versión guiada actual es 1.2.27.

## Liveness y recuperación autónoma (v1.2.27)

La extensión mantiene un único control route inactivo mediante `runtime.onStartup` y una alarma
acotada de dos minutos. Ese documento autenticado prueba el bridge, persiste un heartbeat de
liveness independiente de las capturas comerciales y reclama el claimer existente. Un worker
ocioso continúa disponible; reiniciar Chrome redescubre trabajo durable sin clic técnico.

## Reentrada por menú y navegación SPA (v1.2.26)

El mismo bridge origin-bound reconoce el Preview histórico, el proyecto dedicado de preproducción
y su alias operativo exacto. En cada documento permanece inerte fuera de las rutas elegibles y
observa el lifecycle SPA ya existente: al entrar en Oportunidades activa un único listener; al
salir lo retira; al volver reactiva ese mismo listener. La guarda global impide reinicializaciones,
UI o listeners duplicados. No se añadió polling ni un segundo bridge.

## Recuperación al iniciar el service worker (v1.2.26)

Cada inicialización real del service worker ejecuta una sola consulta acotada de pestañas bajo
el scope canónico `/admin/ebay/*` e inyecta el mismo `admin-bridge.js` en el frame principal.
Esto recupera documentos ya abiertos tras **Reload** aunque el evento de actualización no haya
completado la inyección. La guarda global existente vuelve inofensivas las reinyecciones; en rutas
no operativas el bridge permanece dormido hasta entrar por navegación SPA. No hay polling ni
keepalive.

## Recuperación de pestaña abierta tras actualización (v1.2.24)

Chrome no vuelve a ejecutar de forma retroactiva un content script declarativo en un documento
que ya estaba abierto al actualizar una extensión unpacked. Esta versión intentaba recuperar esas
pestañas únicamente desde `runtime.onInstalled`; la prueba real mostró que ese hook aislado no era
una autoridad operacional suficiente. La recuperación vigente se documenta en v1.2.26.

## Activación determinista por ruta (v1.2.23)

El content script ligero se carga únicamente bajo el scope administrativo acotado del host
canónico de Seller OS. Fuera de `/admin/ebay/mobile-review` y
`/admin/ebay/opportunity-queue/research` permanece inerte. Al entrar o salir mediante una
navegación de documento o una transición SPA, activa o retira el mismo listener del bridge
sin polling, credenciales, listeners duplicados ni una segunda autoridad de sesión.

## Diagnóstico acotado de handshake (v1.2.22)

El bridge comunica únicamente etapas, contadores y booleanos del handshake. No persiste HTML,
cookies, credenciales, consultas ni contenido de resultados. El service worker puede permanecer
inactivo entre eventos; cada probe válido lo despierta bajo el contrato normal de Manifest V3.

## Binding efímero de tarea guiada (v1.2.21)

La automatización conserva el `nextQueryState` existente, pero ya no depende de que eBay
retenga el fragmento `#seller-os-*`. El service worker entrega una atestación efímera solo
después de confirmar un tab nuevo y completo con path, consulta, categoría, rango y pestaña
Sold correctos. El content script enlaza esa tarea con la identidad visible de resultados;
una tarea distinta, una consulta/categoría diferente o una firma previa siguen bloqueadas.

## Diagnóstico estructural de readiness (v1.2.20)

La automatización mantiene el gate fail-closed y separa, mediante enums,
el estado estructural de la URL, el estado guiado y la identidad acotada de
resultados. No transmite URLs, consultas, títulos, HTML, cookies ni credenciales.

## Diagnóstico acotado de Product Research (v1.2.19)

La sesión automática informa únicamente etapas, estados, booleanos y conteos acotados
desde la creación de la pestaña hasta el ACK de captura. No conserva URL, HTML,
títulos, cookies, credenciales ni contenido arbitrario del DOM.

## Navegación Product Research acotada (v1.2.18)

La versión 1.2.18 abre cada consulta en el estado oficial de Product Research:
`SOLD`, 90 días, query y categoría exactas. El fragmento local se conserva
únicamente como gate de readiness; nunca sustituye la consulta de eBay. La captura
exige que la categoría visible coincida antes de devolver el resultado al worker.

## Sesión automática acotada (v1.2.17)

La versión 1.2.17 reutiliza esta misma extensión y el plan de consultas ya
preparado por Seller OS. La página administrativa autenticada entrega al
service worker una autorización efímera de hasta 15 minutos: máximo 15
consultas, 200 filas Sold, 2 páginas por consulta y 1 reintento. El bearer de
Seller OS permanece en la página y nunca se entrega a la extensión.

Tras el único clic, la extensión abre pestañas de lectura en el perfil normal
de Chrome, ejecuta Product Research y Main Search con `Sold` + `Completed`,
captura sólo campos visibles y cierra las pestañas de trabajo. Seller OS usa
los importadores existentes para persistir la evidencia. Un precio mostrado
nunca se convierte en precio realizado; `Best Offer` conserva el precio
realizado como `UNPROVEN`. CAPTCHA, acceso denegado, DOM desconocido, pérdida
del bridge, sesión vencida o límites excedidos detienen el proceso de forma
segura. No hay login automatizado, credencial persistente ni escritura eBay.

## Recuperación extremo a extremo (v1.2.16)

La versión 1.2.16 respeta la señal `returnToSellerOs` después de una captura
aceptada: bloquea una segunda captura accidental de la misma tabla y convierte
la única acción disponible en `VOLVER A SELLER OS`.

Si la confirmación entre la pestaña de eBay y el receptor se pierde, la extensión
reenvía una sola vez el mismo `captureId`. El receptor devuelve el resultado
cacheado y la API conserva la misma clave de idempotencia, por lo que no repite
la importación. La llamada del receptor también se cancela de forma segura tras
60 segundos y devuelve un error recuperable en lugar de quedar esperando
indefinidamente.

## Continuidad del lote activo (v1.2.15)

La versión 1.2.15 corrige el regreso desde Product Research: al terminar el
plan guiado, `Volver a Seller OS` abre directamente el lanzamiento activo en
`/admin#today-launch`, no el hub operativo anterior. La autenticación,
captura visible, consulta guiada y validación de resultados conservan el
contrato de v1.2.14.

## Consulta guiada, cero resultados y patrones locales (v1.2.14)

Seller OS puede abrir Product Research con una consulta preparada en el fragmento
local de la URL. La extensión aplica la consulta automáticamente y el usuario sólo
pulsa “Capturar y continuar” cuando la tabla nueva está lista. “Aplicar y buscar” se
mantiene como fallback si eBay impide el submit automático. El fragmento no se envía
al servidor de eBay ni cambia los permisos de la extensión.

La misma captura analiza únicamente miniaturas que ya estén visibles en el viewport de Product Research. Chrome intenta leer primero la representación ya renderizada. Si la seguridad de origen impide esa lectura, el service worker solicita temporalmente sólo esa miniatura visible desde `i.ebayimg.com`, con credenciales omitidas, un límite estricto de 3 MB y sin redirecciones. Deriva en memoria rasgos agregados de fondo, cobertura, complejidad y composición; después borra los buffers y cierra el bitmap.

La extensión no abre versiones completas, no guarda URLs ni imágenes, no genera screenshots/base64 persistentes y no transmite píxeles a Seller OS u OpenAI. Sólo devuelve al content script una lista fija de proporciones numéricas no reconstructivas: fondo, cobertura, complejidad, posición, luminosidad, contraste, temperatura de color, geometría y uniformidad por zonas. Si el host, tipo, tamaño, dimensiones o análisis no son seguros, marca la observación visual como no disponible y continúa la captura comercial normal.

La captura rápida usa un único snapshot de la cuadrícula visible, reutiliza geometría
y procesa primero las filas ancladas a Item IDs, incluso cuando eBay representa el
enlace mediante texto accesible o una imagen con `alt`. Después de importar, Seller OS puede
aplicar y ejecutar automáticamente la siguiente consulta agrupada después de cada captura
aceptada. La extensión espera resultados
nuevos y verifica que la consulta visible coincida antes de habilitar la siguiente captura;
nunca inicia sesión automáticamente. Si eBay recarga la página, conserva en el fragmento
local la consulta y una huella SHA-256 no reconstructiva de la tabla anterior; no guarda
Item IDs ni filas en storage y sólo reactiva la captura cuando prueba que los resultados cambiaron.

La versión 1.2.14 conserva sin cambios el lector y el contrato tabular de v1.2.13. Cuando no existen ventas, acepta el mensaje visible oficial `No sold results found for` si la consulta mostrada coincide con la consulta preparada. También reconoce las variantes visibles de eBay que explican que no encontraron coincidencias y sustituyeron la tabla por anuncios activos, incluso cuando el aviso aparece dentro de un componente sin rol, clase o selector estable. Para ello revisa únicamente texto renderizado, en fragmentos acotados; no lee ni transmite HTML completo. En ese caso ignora las filas activas, registra cero ventas y nunca inventa evidencia vendida. El análisis visual remoto queda limitado a 20 miniaturas y a un presupuesto total de 12 segundos; cualquier miniatura lenta queda como `UNKNOWN` y la captura comercial continúa. La versión mantiene además las mismas reglas de v1.2.8 para las columnas de unidades vendidas y fecha de
última venta. Un precio nunca puede convertirse en cantidad y una fecha numérica ambigua
no puede convertirse en evidencia histórica; Seller OS rechaza además cualquier venta fuera
de la ventana visible autorizada.

La ventana segura de Seller OS se abre una sola vez y se reutiliza durante el lote de
hasta cinco consultas. Su heartbeat se reactiva después de cada captura y reconoce cada
`captureId` de forma idempotente, por lo que una entrega repetida no vuelve a importar.
La extensión no renavega esa ventana entre productos: la sesión que el operador abrió
legítimamente sirve para todo el lote mientras no venza ni se cierre. Nunca automatiza el
login, guarda cookies, lee credenciales ni intenta eludir una expiración de eBay o Seller OS.

El panel muestra los pasos en orden. Sólo la acción humana que corresponde queda
resaltada y habilitada; los pasos futuros permanecen grises. Al completar la última
consulta, oculta los controles intermedios y deja únicamente “VOLVER A SELLER OS”.

La aplicación automática de consultas excluye explícitamente el buscador global de
eBay y valida el destino del formulario antes de enviarlo. Sólo permite formularios
de lectura GET cuya URL resuelva a `https://www.ebay.com/sh/research`; nunca usa `/sch`
ni envía formularios POST. Si eBay no
expone un control local verificable, deja la consulta escrita y se detiene de forma
segura dentro de Product Research para que el usuario pulse Search.

La extensión sólo se inyecta en la ruta oficial Product Research. No lee cookies,
tokens, contraseñas, datos de comprador, HTML completo ni archivos de imagen. La
tabla visible se entrega mediante `postMessage` a la URL canónica de Preview; la
extensión no hace solicitudes de red ni funciona en Production.

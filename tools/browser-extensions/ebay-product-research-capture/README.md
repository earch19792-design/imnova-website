# Seller OS — eBay Product Research Capture

Extensión local MV3 para el piloto Preview de Loop 2.

1. Abre `chrome://extensions` o `edge://extensions`.
2. Activa **Developer mode**.
3. Selecciona **Load unpacked** y elige esta carpeta.
4. Abre la página oficial `https://www.ebay.com/sh/research` e inicia sesión normalmente.
5. Ejecuta una búsqueda y usa **Capturar y continuar**.

Si ya estaba instalada una versión anterior, reemplaza la carpeta extraída y pulsa
**Reload** en `chrome://extensions` o `edge://extensions`. La versión guiada actual es 1.2.11.

## Consulta guiada, cero resultados y patrones locales (v1.2.11)

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

La versión 1.2.11 conserva sin cambios el lector y el contrato tabular de v1.2.10. Cuando no existe una tabla, sólo acepta el mensaje visible oficial `No sold results found for` si la consulta mostrada coincide con la consulta preparada; registra cero filas y nunca inventa evidencia vendida. El análisis visual remoto queda limitado a 20 miniaturas y a un presupuesto total de 12 segundos; cualquier miniatura lenta queda como `UNKNOWN` y la captura comercial continúa. La versión mantiene además las mismas reglas de v1.2.8 para las columnas de unidades vendidas y fecha de
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

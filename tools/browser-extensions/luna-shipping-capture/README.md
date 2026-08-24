# Seller OS — Luna Shipping Capture V1

Extensión MV3 separada y limitada exclusivamente a cotizaciones de envío de Luna.

## Instalación única

1. Abre `chrome://extensions` o `edge://extensions`.
2. Activa **Developer mode**.
3. Selecciona **Load unpacked** y elige esta carpeta.
4. La extensión abre automáticamente la página canónica de captura de Seller OS.

El ID estable de la extensión es `mhpkojahbbfdgodeaecggpjaplllgclk`.
Después de instalarla, Seller OS entrega lotes acotados y la extensión procesa los
candidatos secuencialmente sin clic por producto.

## Límite de seguridad

- No solicita permisos de cookies, storage, webRequest ni `<all_urls>`.
- Sólo se inyecta en `lunaportex.com`, `www.lunaportex.com` y, para detectar un
  desvío de autenticación, `account.lunaportex.com`.
- No lee contraseñas, cookies, tokens, headers de autenticación ni almacenamiento
  del navegador.
- Sólo modifica temporalmente el carrito, intenta restaurarlo y nunca navega a
  pago ni crea una orden.
- Falla cerrado si no prueba sesión autenticada, identidad exacta, subtotal,
  envío, total o restauración del carrito.
- Cada paso tiene como máximo dos intentos. Un cambio del DOM devuelve
  `LUNA_SHIPPING_DOM_CONTRACT_CHANGED`.

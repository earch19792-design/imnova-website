# Seller OS — Luna Shipping Capture V1

Extensión MV3 separada y limitada exclusivamente a cotizaciones de envío de Luna.

## Instalación única

1. Abre `chrome://extensions` o `edge://extensions`.
2. Activa **Developer mode**.
3. Selecciona **Load unpacked** y elige esta carpeta completa. No copies ni
   reemplaces archivos individuales: `manifest.json`, `background.js` y
   `content.js` forman un único artefacto versionado.
4. La extensión abre automáticamente la página canónica de captura de Seller OS.

El ID estable de la extensión es `mhpkojahbbfdgodeaecggpjaplllgclk`.
El artefacto canónico actual es `1.0.46` y su único origen Seller OS externo es
`https://imnova-seller-os-preprod.vercel.app`.
Después de instalarla, Seller OS entrega lotes acotados y la extensión procesa los
candidatos secuencialmente. También puede recibir un único job transitorio de
un listing CURRENT LIVE con identidad exacta; ese job no crea un candidate,
package, opportunity ni profitability frontier.

## Límite de seguridad

- No solicita permisos de cookies, webRequest ni `<all_urls>`. El permiso
  `storage` guarda únicamente el SHA-256 del destino canónico, su versión, la
  clase de país; nunca guarda la dirección.
- El binding explícito descubre exactamente un checkout `shop.app` poblado y
  no depende de que siga vivo un canary. Los candidatos posteriores comparan
  automáticamente el fingerprint antes de aceptar la cotización.
- La existencia del fingerprint persistido es la única autoridad de `BOUND`:
  el primer clic crea el benchmark y las capturas posteriores sólo lo validan.
- El envelope durable contiene exclusivamente fingerprint, versión, clase de
  país y `boundAt`; el ACK se emite únicamente después del readback exacto.
- Cada corrida emite como máximo 100 transiciones allowlisted al transporte
  admin existente. Seller OS las conserva en el event store del mismo flujo y
  nunca incluye dirección, URL de checkout, DOM, cookies ni datos de pago.
- Sólo se inyecta en `lunaportex.com`, `www.lunaportex.com`, el desvío de
  autenticación `account.lunaportex.com` y el checkout acotado `shop.app`.
- No lee contraseñas, cookies, tokens, headers de autenticación, localStorage ni
  sessionStorage del sitio.
- Sólo modifica temporalmente el carrito, intenta restaurarlo y nunca navega a
  pago ni crea una orden.
- Falla cerrado si no prueba sesión autenticada, identidad exacta, subtotal,
  envío, total o restauración del carrito.
- Cada paso tiene como máximo dos intentos. Un cambio del DOM devuelve
  `LUNA_SHIPPING_DOM_CONTRACT_CHANGED`.

# eBay OAuth Token Store Design

## Proposito

Este documento disena como IMNOVA podria guardar credenciales y tokens de eBay en el futuro de forma segura.

Este documento:

- No implementa OAuth.
- No contiene tokens reales.
- No contiene authorization codes reales.
- No habilita conexion real con eBay.
- No habilita drafts, publicacion, modificacion de listings, pausa, orders ni pagos.

El objetivo es definir controles antes de cualquier implementacion.

## Fases De Conexion

### Fase 1: Application Token Para Metadata Read-Only

Uso futuro permitido:

- Metadata de marketplace.
- Categorias.
- Item specifics / aspects.
- Validacion de campos faltantes para readiness.

Restricciones:

- Solo server-side.
- Sandbox primero.
- Feature flag apagado por defecto.
- Sin write scopes.
- Sin cuenta real de vendedor.

### Fase 2 Futura: User Consent Para Lectura De Cuenta Del Vendedor

Uso futuro posible, fuera de V0:

- Leer metadata limitada de cuenta del vendedor cuando exista consentimiento humano explicito.
- Validar configuracion de negocio o policies si el alcance se aprueba.

Restricciones:

- Consentimiento humano explicito.
- Scopes revisados antes de solicitar autorizacion.
- Refresh tokens cifrados o guardados en secret manager.
- Audit log sin secretos.
- No publicar ni modificar listings.

### Fase 3 Futura: Write Actions

Write actions quedan fuera de V0.

Solo podrian evaluarse en una fase futura con:

- Aprobacion humana explicita por accion.
- Diseno separado de permisos.
- Tests de bloqueo.
- Audit log.
- Reglas de rollback.
- Revision de riesgo de cuenta.

## Principios De Seguridad

- Tokens solo server-side.
- Nada en `NEXT_PUBLIC`.
- No logs de `access_token`, `refresh_token`, `client_secret` ni `authorization_code`.
- No devolver tokens al frontend.
- Usar scopes minimos.
- Sandbox primero.
- Feature flag apagado por defecto.
- Rotacion y revocacion futuras.
- Audit log sin secretos.
- Fallar cerrado si falta configuracion segura.

## Variables Futuras Conceptuales

Nombres conceptuales sin valores reales:

```text
EBAY_CLIENT_ID
EBAY_CLIENT_SECRET
EBAY_ENV=sandbox
EBAY_API_REAL_ENABLED=false
EBAY_REDIRECT_URI
EBAY_MARKETPLACE_ID=EBAY_US
```

Reglas:

- Nunca usar `NEXT_PUBLIC` para secretos o tokens.
- Nunca commitear valores reales.
- Nunca copiar valores reales a docs, tests, logs o screenshots.
- `EBAY_API_REAL_ENABLED` debe iniciar en `false`.

## Storage Futuro

### Env Secrets Para Client Credentials

Uso:

- Guardar `EBAY_CLIENT_ID` y `EBAY_CLIENT_SECRET` en el entorno seguro del servidor.

Ventajas:

- Simple para application tokens.
- Compatible con despliegues server-side.

Riesgos:

- Mala configuracion de entorno.
- Exposicion accidental por logs o variables publicas.

### Secret Manager

Uso:

- Guardar client credentials y, si aplica en fases futuras, refresh tokens.

Ventajas:

- Mejor control de acceso.
- Rotacion y auditoria mas maduras.

Riesgos:

- Complejidad operativa.
- Necesita reglas claras de acceso.

### Tabla Cifrada Para Refresh Tokens De Usuario

Uso futuro posible:

- Solo si existe user consent y se aprueba guardar refresh tokens.

Requisitos:

- Cifrado fuerte.
- Acceso server-side solamente.
- Audit log sin secretos.
- Rotacion/revocacion.
- No exponer tokens por API al frontend.

### Opciones Prohibidas

- Nunca `localStorage`.
- Nunca cookies frontend para tokens de eBay.
- Nunca logs.
- Nunca archivos locales commiteados.
- Nunca docs con valores reales.

## Token Lifecycle Futuro

1. Obtener token desde servidor.
2. Usar token server-side solo para endpoints permitidos.
3. Renovar token antes o despues de expiracion segun reglas seguras.
4. Revocar token cuando se retire conexion o se detecte riesgo.
5. Auditar uso sin guardar secretos.
6. Manejar expiracion sin filtrar tokens ni headers.

Errores esperados:

- Token expirado.
- Scope insuficiente.
- Feature flag apagado.
- Sandbox no configurado.
- Credenciales faltantes.

Los errores deben reportar causa operativa sin imprimir secretos.

## Prohibiciones

- No write scopes en V0.
- No guardar tokens planos.
- No imprimir tokens.
- No mezclar OAuth con publicacion.
- No usar metadata como permiso para publicar.
- No conectar cuenta real sin consentimiento humano.
- No leer orders/pagos en V0.
- No crear drafts reales.
- No modificar listings.
- No pausar listings.

## Checklist Antes De Implementar OAuth Real

- Diseno aprobado.
- Scopes revisados.
- Feature flag apagado por defecto.
- Sandbox listo.
- Logs revisados para evitar secretos.
- Secrets configurados en entorno seguro.
- Tests de no exposicion de secretos.
- Tests de `write_actions_enabled: false`.
- Aprobacion humana explicita.

Sin este checklist completo, OAuth real debe permanecer apagado.

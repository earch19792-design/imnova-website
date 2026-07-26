# Seller OS UX - plan de QA accesible

## Automatizado en Fase 1

- Una sola navegación principal renderizada por el shell.
- Skip link y foco programático del contenido.
- `aria-current` en navegación y breadcrumbs.
- Controles persistentes con altura mínima de 44 px.
- Progreso ARIA sólo cuando existe un valor confirmado.
- `prefers-reduced-motion`.
- Estados de carga, parcial, no disponible y error diferenciados.
- `null` no convertido en cero.

## Prueba manual requerida en Preview

1. Teclado completo sin trampas de foco.
2. VoiceOver o NVDA en navegación, actividad y breadcrumbs.
3. Zoom 200 %.
4. Viewports de 360 px, 390 px, tableta y escritorio.
5. Pestaña oculta: polling detenido.
6. Movimiento reducido: animaciones no esenciales detenidas.
7. Deep link desde WhatsApp con foco y contenido correcto.
8. Sesión expirada y recuperación de login.

## Dependencia propuesta por separado

El repositorio no incluye Playwright, Cypress, axe ni Lighthouse CI. No se añade una dependencia pesada en esta fase. Una incorporación posterior debe incluir aprobación, presupuesto de mantenimiento y ejecución aislada contra Preview.

# Seller OS UX Fase 1 - rollout en Preview

1. Confirmar la rama `feature/centralize-ebay-mobile-center`.
2. Ejecutar typecheck, suite Seller OS, auditoría y build.
3. Desplegar sin `--prod` en `imnova-website-z1qh`.
4. Confirmar que `VERCEL_ENV=preview`.
5. Mantener `SELLER_OS_UX_V2_ENABLED` ausente o distinto de `false` para habilitar Fase 1.
6. Asignar únicamente el alias `imnova-ebay-mobile-preprod.vercel.app`.
7. Verificar login, las cinco áreas, navegación utilitaria y deep links.
8. Confirmar que la actividad sin heartbeat dice “No confirmada”.
9. Confirmar que no se ejecutó ninguna escritura eBay, scheduler o llamada OpenAI nueva.
10. Registrar el deployment ID y conservar el Preview anterior para rollback.

Production nunca habilita automáticamente este shell.

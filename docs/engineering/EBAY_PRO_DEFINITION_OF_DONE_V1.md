# eBay Pro Definition Of Done V1

## Mandatory Definition Of Done Per Loop

1. Implementa unicamente el objetivo del loop.
2. No agrega features fuera de la ruta oficial.
3. Tiene tests propios del loop.
4. Tiene dry-run o simulacion cuando aplique.
5. Valida casos normales, bloqueados, incompletos y duplicados.
6. Corre regresiones de modulos anteriores.
7. Pasa `npx tsc --noEmit`.
8. Pasa `git diff --check` y `git diff --cached --check`.
9. No toca Production salvo aprobacion explicita.
10. No escribe en Staging salvo que el loop lo autorice.
11. No usa eBay API/OAuth/tokens salvo que el loop lo autorice.
12. No manda WhatsApp real salvo que el loop lo autorice.
13. No usa Supabase write/SQL salvo que el loop lo autorice.
14. No crea ni modifica `.env*`.
15. No incluye secrets, dumps, backups ni imagenes inesperadas.
16. Reporta outputs numericos esperados.
17. Reporta warnings y bloqueos.
18. Confirma `git status` limpio.
19. Incluye explicacion humana completa y bien redactada.
20. Indica el siguiente loop exacto de la ruta oficial.

## Semaphore

- GREEN: funciona, validaciones PASS, resultado esperado, puede pasar a PR/merge.
- YELLOW: funciona, pero hay warning no bloqueante o requiere revision humana.
- RED: fallo logica, seguridad, datos, build, tests o resultado esperado. No avanzar.

## Mandatory Human Explanation

At the end of each loop, the report must include:

- Que se hizo.
- Por que se hizo.
- Que problema resuelve.
- Que protegio.
- Que cambio realmente.
- Que NO se toco.
- Como esto nos acerca a vender en eBay.
- Que sigue exactamente en la ruta oficial.

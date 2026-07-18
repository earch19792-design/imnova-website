import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const read = (path) => readFileSync(path, "utf8")

test("Salud y configuración muestra un runbook seguro de recuperación", () => {
  const page = read("app/admin/ebay-seller-os/page.tsx")
  const card = read("app/admin/ebay/components/seller-os-disaster-recovery-card.tsx")

  assert.match(page, /SellerOsDisasterRecoveryCard/)
  assert.match(page, /<SellerOsDisasterRecoveryCard \/>/)
  assert.match(card, /data-seller-os-disaster-recovery/)
  assert.match(card, /Recuperación ante fallos/)
  assert.match(card, /Encender el entorno local/)
  assert.match(card, /Verificar el respaldo/)
  assert.match(card, /Restaurar en infraestructura nueva/)
  assert.match(card, /Validar Seller OS/)
  assert.match(card, /Autorizar el cambio/)
})

test("el runbook exige restauración aislada, validación, rollback y cero secretos", () => {
  const card = read("app/admin/ebay/components/seller-os-disaster-recovery-card.tsx")

  assert.match(card, /proyecto Supabase vacío/)
  assert.match(card, /Nunca sobrescribas producción directamente/)
  assert.match(card, /sin activar escrituras/)
  assert.match(card, /se conserva el entorno anterior para rollback/)
  assert.match(card, /no guardar secretos dentro del repositorio/)
  assert.doesNotMatch(card, /SUPABASE_DB_PASSWORD|SERVICE_ROLE_KEY|OPENAI_API_KEY|CRON_SECRET/)
  assert.doesNotMatch(card, /rm\s+-rf|drop\s+(?:database|schema)|reset\s+--hard/i)
})

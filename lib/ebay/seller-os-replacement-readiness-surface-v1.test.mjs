import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'

const service=readFileSync(new URL(
  './teo-owner-listing-experiment-service-v1.ts',import.meta.url),'utf8')
const readiness=readFileSync(new URL(
  './seller-os-replacement-readiness-v1.ts',import.meta.url),'utf8')
const relay=readFileSync(new URL(
  './ebay-seller-os-cloud-read-relay-v1.ts',import.meta.url),'utf8')
const page=readFileSync(new URL(
  '../../app/admin/ebay/teo-listings/page.tsx',import.meta.url),'utf8')

test('TEO exposes the same-family replacement readiness projection read-only',()=>{
  assert.match(service,/buildSellerOsReplacementReadinessV1/)
  assert.match(service,/market_family_id/)
  assert.match(service,/commercial_memory_digest/)
  assert.match(service,/readTeoPreparedReplacementV1/)
  assert.match(relay,/replacementReadinessCollector/)
  assert.match(relay,/readTeoPreparedReplacementV1/)
  assert.match(page,/Reemplazos preparados 1:1/)
  assert.match(page,/Preparado · no probado/)
  assert.match(page,/No se termina ni publica ningún listing/)
})

test('replacement surface preserves the shared economic and no-marketplace-write policy',()=>{
  assert.match(service,/minimumNetProfitUsd: 0 as const/)
  assert.match(readiness,/sellerOsRoiMarginPolicyContractV2/)
  assert.match(readiness,/economicPolicyReady/)
  assert.match(service,/marketplaceWrites: 0 as const/)
  assert.match(service,/automaticExecutionAllowed: false as const/)
  assert.doesNotMatch(page,/END A|PUBLICAR AUTOMATICAMENTE/)
})

import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const sql=readFileSync("supabase/migrations/20260722051000_execute_extraordinary_position_6.sql","utf8")
const executor=readFileSync("scripts/execute-reference-guided-extraordinary-position-6.mjs","utf8")
const route=readFileSync("app/api/admin/ebay/images/reference-guided-extraordinary-position-6/route.ts","utf8")

test("ordinal 8 is bound to exact persisted position 6 contract",()=>{
  for(const value of ["7ac6e2f4-d1f7-44f8-a026-064ca474904b",
    "9541617972ca0bf778941bcd5c6b11131df144b9fdb0e5bdca111f81b0e5f8f3",
    "322226f9-31d0-4881-987d-1040d56a650a",
    "cfa89ed6ceebc0f6899af917d9cc114638d4b4840e46f0dd37990f0f291c049a",
    "2f24eb0993cd71a076e1229fcf54cbdf629cecc85368157cf4247c8bc0909347",
    "ac8c72b757de68715bd7517460f5b69365305202b7a2a297e2636b128aecdb65"]){
    assert.match(sql,new RegExp(value));assert.match(executor,new RegExp(value))}
  assert.match(sql,/v_position\.extraordinary_ordinal<>8/)
  assert.match(sql,/provider_calls=8/)
})

test("position 4 approval and assets 0 through 5 gate final call",()=>{
  assert.match(sql,/position_4_extraordinary_human_verdict_events/)
  assert.match(sql,/approval4\.extraordinary_ordinal=7/)
  assert.match(sql,/job4\.status='PASSED'/)
  assert.match(sql,/primary_verdict='APPROVED'/)
  assert.match(sql,/material_detail_verdict='APPROVED'/)
  assert.match(sql,/job2\.status='PASSED'/)
  assert.match(sql,/job3\.status='PASSED'/)
  assert.match(sql,/job5\.status='PASSED'/)
})

test("one-shot Preview transport has no retry",()=>{
  assert.match(executor,/providerFetches\+=1/)
  assert.match(executor,/providerFetches!==1/)
  assert.match(executor,/https:\/\/api\.openai\.com\/v1\/images\/edits/)
  assert.match(executor,/automaticRetryOccurred:false/)
  assert.doesNotMatch(executor,/for\s*\(let attempt|while\s*\(|retry\(/i)
  assert.match(route,/VERCEL_ENV!=="preview"/)
  assert.match(route,/authenticationMode!=="service_role"/)
  assert.match(route,/FEATURE_MUST_START_DISABLED/)
  assert.match(route,/RUN_ONE_STAGING_EXTRAORDINARY_POSITION_6_PROVIDER_CALL_8/)
})

test("private PNG roundtrip remains human-review-only",()=>{
  assert.match(executor,/persistReferenceGuidedCanaryPng/)
  assert.match(executor,/position-6\/ordinal-8/)
  assert.match(executor,/HUMAN_REVIEW_REQUIRED/)
  assert.match(sql,/status='QA_PENDING'/)
  assert.match(sql,/technicalChecks'->>'png/)
  assert.match(sql,/technicalChecks'->>'width'\)::integer<>1600/)
  assert.match(sql,/technicalChecks'->>'height'\)::integer<>1600/)
})

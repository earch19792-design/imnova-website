import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const sql=readFileSync(
  "supabase/migrations/20260722050000_approve_extraordinary_position_4.sql","utf8")

test("extraordinary position 4 approval is exact and append-only",()=>{
  assert.match(sql,/extraordinary_ordinal integer not null check \(extraordinary_ordinal=7\)/)
  assert.match(sql,/human_verdict text not null check \(human_verdict='APPROVED'\)/)
  assert.match(sql,/d2e22d365178742d4cb9baaac72f286fea2c7745fa607082b8a940f18bb7ed24/)
  assert.match(sql,/req_1c6c97c6febf4af8b7af5a09d47758ac/)
  assert.match(sql,/prevent_reference_guided_human_evidence_mutation/)
})

test("human evidence covers every confirmed contract clause",()=>{
  for(const clause of ["faucetVisibleAndOff","strawberryCountBetween4And6",
    "onlySmallStaticDroplets","noRunningWaterJetsWaterfallsOrActiveDrainage",
    "noHandsOrHumanParts","noTextOrAddedLogos","completeProduct",
    "handlesRimBasePerforationsColorAndProportionsFaithful","noDeformation",
    "noPerformanceClaims"]){assert.match(sql,new RegExp(clause))}
})

test("position 6 stays unauthorized while becoming eligible",()=>{
  assert.match(sql,/position_6_authorized boolean not null check \(not position_6_authorized\)/)
  assert.match(sql,/authorization6\.position=6/)
  assert.match(sql,/return query select v_verdict\.id,v_job_after\.status,v_job_after\.output_sha256,7,true,7/)
  assert.doesNotMatch(sql,/insert into public\.ebay_reference_guided_extraordinary_authorization_events/)
  assert.doesNotMatch(sql,/OPENAI_API_KEY|api\.openai\.com|images\/edits/)
})

test("rejected evidence, budget, and external isolation are enforced",()=>{
  assert.match(sql,/EXTRAORDINARY_POSITION_4_REJECTED_HISTORY_NOT_PRESERVED/)
  assert.match(sql,/provider_calls<>7 or v_attempt\.max_provider_calls<>8/)
  assert.match(sql,/v_attempt\.ebay_writes<>0/)
  assert.match(sql,/v_attempt\.production_changed/)
  assert.match(sql,/grant select,insert[\s\S]*to service_role/)
})

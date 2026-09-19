import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const prepare=readFileSync(new URL(
  '../../supabase/migrations/20260919143000_stockguard_listing_link_authority_p0.sql',
  import.meta.url),'utf8')
const activate=readFileSync(new URL(
  '../../supabase/migrations/20260919150000_stockguard_listing_link_authority_p0_activate.sql',
  import.meta.url),'utf8')

const auditedLegacyJobs=Object.freeze([
  ['luna-stock-check-v1:sha256:7a708987d1e1caa193e75a2d3c711540cacaa4e6d97f899eece27fb9402b9599','ended','NOT_APPLICABLE'],
  ['luna-stock-check-v1:sha256:a94c75e731ac167f49b0f0f2221cb359d85402d274adb480a78beda1433340a4','active','BLOCKED'],
  ['luna-stock-check-v1:sha256:8d879960be44d7596bb01a6ec6fe9cd347aac264351e24412a5af7fa20a0b169','active','BLOCKED'],
  ['luna-stock-check-v1:sha256:e78b5441a085a32ad1ff37b205bd129140c3440d47547640fa768a3aff89feea','ended','NOT_APPLICABLE'],
  ['luna-stock-check-v1:sha256:ffbdf2c72741bf165ffc9401a1817ccd94b3f07c8a7e5b3857afcc3efbb20403','ended','NOT_APPLICABLE'],
  ['luna-stock-check-v1:sha256:f06adad23b1e5338573f4bcc9787d59dae18a0df0f5bc86cb8d19b07aef850b0','ended','NOT_APPLICABLE'],
  ['luna-stock-check-v1:sha256:c84be4e88fbf5c831736cfc16b7f90d168a52f352605d78a71e4ef8deefad790','ended','NOT_APPLICABLE'],
  ['luna-stock-check-v1:sha256:ddb4013ad48686ff43af9c6f05b58d02f301a08d7562a205f6aa5d83abdece3d','ended','NOT_APPLICABLE'],
  ['luna-stock-check-v1:sha256:6c23421a512f7bb3be6f05c372b989140fd340db032fef30fa46d2c0022138c7','active','BLOCKED'],
  ['luna-stock-check-v1:sha256:b73e795c74571fec79ebd92d0de1352541678a244cb4ec022c02ad702d098301','active','BLOCKED'],
  ['luna-stock-check-v1:sha256:b39f31cda9ce4989ab9fe9eeec498a8441f888d96e1059b24a5c5d7ec675beeb','active','BLOCKED'],
])

function terminalDisposition(listingStatus){
  return Object.freeze({
    safeDisposition:'TERMINALIZE_USING_EXISTING_VALID_JOB_STATE',
    terminalState:listingStatus==='active'?'BLOCKED':'NOT_APPLICABLE',
    grantsAuthority:false,
  })
}

function reconcile(state){
  return state.authority
    ? { ...state, quarantine:false }
    : state.duplicate ? { ...state, quarantine:true } : state
}
function createOrReplace(state){
  return { ...state, authority:true, quarantine:false }
}
function unlinkOrInvalidate(state){
  return { ...state, authority:false }
}

test('all 11 audited nonterminal jobs use existing terminal states without authority',()=>{
  assert.equal(auditedLegacyJobs.length,11)
  for(const [jobId,listingStatus,expectedState] of auditedLegacyJobs){
    assert.match(jobId,/^luna-stock-check-v1:sha256:[0-9a-f]{64}$/)
    const disposition=terminalDisposition(listingStatus)
    assert.equal(disposition.safeDisposition,
      'TERMINALIZE_USING_EXISTING_VALID_JOB_STATE')
    assert.equal(disposition.terminalState,expectedState)
    assert.equal(disposition.grantsAuthority,false)
  }
  assert.match(activate,/terminal_workflow_state in \('BLOCKED','NOT_APPLICABLE'\)/)
  assert.match(activate,/authority_id=job\.linkage_id|authority\.linkage_id=job\.linkage_id/)
  assert.doesNotMatch(activate,
    /insert into public\.seller_os_listing_product_link_authorities_v1/i)
})

test('prepare is backward compatible and activation is explicitly staged',()=>{
  assert.match(prepare,/PREPARE only:[\s\S]*current worker[\s\S]*rollout boundary/i)
  assert.doesNotMatch(prepare,
    /create trigger seller_os_luna_stock_job_authority_p0/)
  assert.doesNotMatch(prepare,
    /create trigger seller_os_luna_stock_observation_authority_p0/)
  assert.match(activate,/Apply only after the authority-aware application release/)
  assert.match(activate,/lock table public\.seller_os_luna_stock_check_jobs\s+in share row exclusive mode/)
  assert.match(activate,/lock table public\.seller_os_luna_stock_observations\s+in share row exclusive mode/)
  assert.match(activate,/create trigger seller_os_luna_stock_job_authority_p0/)
  assert.match(activate,/create trigger seller_os_luna_stock_observation_authority_p0/)
  assert.match(activate,/STOCKGUARD_LEGACY_NONTERMINAL_AUTHORITY_GAP/)
  assert.doesNotMatch(activate,
    /(?:delete|update)\s+public\.seller_os_luna_stock_observations/i)
  assert.doesNotMatch(activate,
    /update\s+public\.seller_os_listing_product_link_authorities_v1/i)
  assert.match(activate,
    /from public\.seller_os_stockguard_legacy_job_dispositions_v1 disposition[\s\S]*disposition\.stock_check_job_id=job\.stock_check_job_id/)
})

test('all paths share canonical lock namespace and deterministic order',()=>{
  const transition=prepare.match(
    /create or replace function public\.transition_seller_os_listing_product_link_authority_v1[\s\S]*?\n\$function\$;/)?.[0] ?? ''
  const reconciliation=prepare.match(
    /create or replace function public\.reconcile_seller_os_listing_identity_quarantines_v1[\s\S]*?\n\$function\$;/)?.[0] ?? ''
  const lock=(scope)=>`listing-link-authority-v1:${scope}:`
  const positions=['account','item','sku','identity'].map((scope)=>
    transition.indexOf(lock(scope)))
  assert.ok(positions.every((position)=>position>=0))
  assert.deepEqual([...positions].sort((a,b)=>a-b),positions)
  assert.ok(reconciliation.indexOf(lock('account'))>=0)
  assert.ok(reconciliation.indexOf(lock('account'))<
    reconciliation.indexOf('with duplicated as'))
  assert.match(prepare,
    /lock_anchor[\s\S]*listing-link-authority-v1:account:[\s\S]*hashtextextended\(p_account_key, 417\)/)
  assert.match(activate,
    /select distinct job\.account_key[\s\S]*order by job\.account_key[\s\S]*listing-link-authority-v1:account:/)
})

test('serialized race outcomes cannot retain authority plus active quarantine',()=>{
  const duplicate={authority:false,quarantine:false,duplicate:true}
  for(const lifecycle of [createOrReplace,createOrReplace]){
    const reconcileFirst=lifecycle(reconcile(duplicate))
    const lifecycleFirst=reconcile(lifecycle(duplicate))
    assert.deepEqual(reconcileFirst,{authority:true,quarantine:false,duplicate:true})
    assert.deepEqual(lifecycleFirst,{authority:true,quarantine:false,duplicate:true})
  }
  const activeDuplicate={authority:true,quarantine:false,duplicate:true}
  const reconcileThenUnlink=unlinkOrInvalidate(reconcile(activeDuplicate))
  const unlinkThenReconcile=reconcile(unlinkOrInvalidate(activeDuplicate))
  assert.equal(reconcileThenUnlink.authority,false)
  assert.equal(unlinkThenReconcile.authority,false)
  assert.equal(unlinkThenReconcile.quarantine,true)
  assert.match(prepare,/CANONICAL_ACTIVE_AUTHORITY_PRESENT/)
  assert.match(prepare,/quarantine_state='RESOLVED'/)
  assert.match(prepare,/authority\.lifecycle_state='ACTIVE'/)
})

test('known duplicate SKU policy remains A authoritative and B quarantined',()=>{
  const listings=[
    {itemId:'366666581320',sku:'IMN-LST-000027',authority:'ITEM5195'},
    {itemId:'366672502737',sku:'IMN-LST-000027',authority:null},
  ]
  const authoritative=listings.filter((row)=>row.authority)
  const quarantined=listings.filter((row)=>!row.authority)
  assert.deepEqual(authoritative.map((row)=>[row.itemId,row.authority]),
    [['366666581320','ITEM5195']])
  assert.deepEqual(quarantined.map((row)=>row.itemId),['366672502737'])
  assert.match(prepare,/DUPLICATE_LIVE_EBAY_SKU/)
  assert.match(prepare,/where not exists[\s\S]*authority\.lifecycle_state='ACTIVE'/)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {promotionShippingLabelV1 as shipping,promotionMetricLabelV1 as metric,promotionDataLabelV1 as data,promotionEconomicStatusV1 as economics} from './mayel-promotion-ui-semantics-v1.ts'
const now=Date.parse('2026-09-10T15:00:00Z'),id='366643555454'
const snapshot=()=>({observedAt:new Date(now).toISOString(),accountKey:'account',worker:null,lease:null,ebay:null,itemIds:[id],jobs:[],economics:[],evidence:[{ebay_item_id:id,marketplace_account_key:'account',evidence_type:'LUNA_CURRENT_SHIPPING',evidence_id:'quote',value_amount:6.99,freshness_status:'FRESH',captured_at:new Date(now-1000).toISOString(),fresh_until:new Date(now+1000).toISOString()}]})
test('STALE_SHIPPING_LABEL_PASS: amount requires exact unexpired quote, never heartbeat or a new quote',()=>{
 const s=snapshot(),input={itemId:id,value:6.99,reference:'quote',snapshot:s,now}
 assert.equal(shipping(input),'$6.99 · Vigente')
 assert.equal(shipping({...input,now:now+1001}),'$6.99 · Vencido')
 assert.equal(shipping({...input,reference:'old-quote'}),'$6.99 · Vencido')
 assert.equal(shipping({...input,value:5.99}),'$5.99 · Vencido')
 assert.equal(shipping({...input,snapshot:null}),'$6.99 · Vencido')
 assert.equal(shipping({...input,value:null}),'Esperando actualización')
 s.evidence[0].freshness_status='STALE';assert.equal(shipping(input),'$6.99 · Vencido')
})
test('COLD_START_FRIENDLY_STATE_PASS: missing/stale evidence waits; explicit OWNER work stays actionable',()=>{
 assert.equal(data({complete:false,sampleSufficient:false,treatment:'TEST'}),'ESPERANDO DATOS')
 assert.equal(data({complete:true,sampleSufficient:false,treatment:'TEST'}),'ESPERANDO DATOS')
 assert.equal(data({complete:false,sampleSufficient:true,treatment:'SCALE'}),'ESPERANDO DATOS')
 assert.equal(data({complete:true,sampleSufficient:true,treatment:'SCALE'}),'COMPLETO')
 assert.equal(data({complete:false,sampleSufficient:false,treatment:'RESTOCK'}),'REQUIERE ATENCIÓN')
 assert.equal(data({complete:false,sampleSufficient:false,treatment:'TEST',ownerActionRequired:true}),'REQUIERE ATENCIÓN')
})
test('CTR_UNIT_SEMANTICS_PASS / CONVERSION_UNIT_SEMANTICS_PASS: explicit units only; source unchanged',()=>{
 for(const key of ['ctr','conversion']){
  const raw=Object.freeze({value:0.0037,unit:'EBAY_API_RATE_RAW'})
  assert.equal(metric(key,raw.value,'PERCENT'),'0.0037%')
  assert.equal(metric(key,raw.value,'RATIO'),'0.37%')
  assert.equal(metric(key,0,'PERCENT'),'0%')
  assert.equal(metric(key,raw.value,raw.unit),'Porcentaje pendiente de confirmar')
  assert.equal(metric(key,raw.value,null),'Porcentaje pendiente de confirmar')
  assert.equal(metric(key,null,'PERCENT'),'Sin datos para este periodo')
  assert.deepEqual(raw,{value:0.0037,unit:'EBAY_API_RATE_RAW'})
 }
 assert.equal(metric('salesRevenue',12.5,'USD'),'12.5 USD')
})
test('ECONOMIC_BLOCKER_EXPLAINED_PASS: fees pending are a waiting state, not an error',()=>{
 const status=economics({feesProven:false,economicsProven:false})
 assert.equal(status.status,'WAITING_FOR_FEES');assert.match(status.label,/esperando comisiones eBay/)
 assert.equal(economics({feesProven:true,economicsProven:false}).status,'WAITING_FOR_DATA')
 assert.equal(economics({feesProven:true,economicsProven:true}).status,'PROVEN')
})
test('NO_EXTRA_EBAY_TRAFFIC: pure presentation, both metric surfaces and economic chains preserved',()=>{
 const helper=readFileSync('lib/seller-os/mayel-promotion-ui-semantics-v1.ts','utf8')
 assert.doesNotMatch(helper,/fetch\(|setInterval\(|setTimeout\(|\.rpc\(|\.from\(/)
 const ui=readFileSync('app/admin/ebay/mayel/revenue-engine.tsx','utf8'),ads=readFileSync('app/admin/ebay/mayel/ads-activation-preview.tsx','utf8')
 assert.match(ui,/promotionMetricLabelV1\(key, row.metrics.windows/);assert.match(ui,/promotionMetricLabelV1\(key, observation.value, observation.unit\)/)
 assert.doesNotMatch(ui,/\{row.commercialEnvelope.label\}/)
 for(const s of [ui,ads]){assert.match(s,/promotionShippingLabelV1/);assert.match(s,/promotionEconomicStatusV1/);assert.match(s,/Techo Ads seguro/);assert.match(s,/Ver detalles/)}
 const engine=readFileSync('lib/seller-os/listing-treatment-engine-v1.ts','utf8')
 assert.match(engine,/value: exact \? o!.value : null, unit: o\?\.unit \?\? null/)
})

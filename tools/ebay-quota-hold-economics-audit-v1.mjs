// Offline certification utility, not a runtime dependency. Input is the saved
// output of the service-only Ads inputs RPC; no eBay client is imported.
import {readFile,writeFile} from 'node:fs/promises'
import {quotaHoldEconomicsReportV1} from '../lib/seller-os/ebay-economics-quota-hold-v1.ts'
const [inputPath,outputPath,accountKey]=process.argv.slice(2)
if(!inputPath || !outputPath || !accountKey) throw Error('INPUT_OUTPUT_ACCOUNT_REQUIRED')
const rawRows=JSON.parse(await readFile(inputPath,'utf8'))
const report=quotaHoldEconomicsReportV1({accountKey,rawRows,now:new Date()})
await writeFile(outputPath,JSON.stringify(report,null,2)+'\n',{mode:0o600})
console.log(JSON.stringify({status:report.status,examined:report.examined,counts:report.economicsBlockerCountsByReason,officialApiCalls:report.officialApiCalls}))

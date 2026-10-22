import { canonicalJson } from '../../modules/import-kit/src/provenance/identity.ts'
import { rational, plus as add, rounded } from '../currency/decimal'
import type { Snapshot } from '../data/snapshots/store'
/** A discrepancy is evidence, never an automatic certification decision. */
export function compareSnapshots(left: Snapshot, right: Snapshot) {
 const sameDefinition = left.answer.definitionHash === right.answer.definitionHash
 const sameConventions = canonicalJson(left.context) === canonicalJson(right.context)
 const commonSnapshot = canonicalJson(left.answer.sourceWatermarks) === canonicalJson(right.answer.sourceWatermarks)
 const sameAnswer = canonicalJson(left.answer) === canonicalJson(right.answer)
 const totals = Object.keys(left.answer.totals).map(id => {
  const a = left.answer.totals[id], b = right.answer.totals[id]
  let difference: string | null = null
  if (a.exact && b?.exact && a.unit === b.unit) {
   const x = rational(BigInt(a.exact.numerator),BigInt(a.exact.denominator)), y = rational(BigInt(b.exact.numerator),BigInt(b.exact.denominator))
   difference = rounded(add(y,rational(-x.numerator,x.denominator)),12,'half-even')
  }
  return {measure:id,left:a,right:b ?? null,difference}
 })
 return {leftQueryId:left.queryId,rightQueryId:right.queryId,sameDefinition,sameConventions,commonSnapshot,sameAnswer,totals,
  status:sameDefinition && sameConventions && commonSnapshot && sameAnswer ? 'matched' : 'unresolved_difference',
  officialCertificationAllowed:false,
  reason:commonSnapshot ? 'Evidence only: model and metric certification are not implemented.' : 'No common source snapshot: source cutoffs differ; any difference remains unresolved.'}
}

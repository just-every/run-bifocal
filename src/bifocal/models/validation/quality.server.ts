import type { Bindings } from '../../../auth.server'
import { inspectQuality } from '../../quality/evidence.server'

/** Promotion consumes only the owner's existing configured source checks. */
export async function promotionQuality(env:Bindings,datasets:string[],ownerId:string) {
 const inspected=await inspectQuality(env,[...new Set(datasets)].sort(),ownerId)
 const blocking=inspected.quality.tests.some(test=>Boolean(test.ruleId)&&test.state!=='passed')
 return {guards:inspected.guards,impact:{...inspected.quality,blocking,policy:'Configured checks require current passing evidence; sources without configured checks remain unknown.',historicalAnswers:'pinned-original'}}
}

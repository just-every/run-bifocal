import { sha256 } from '../../../../modules/import-kit/src/provenance/identity.ts'
import { compound } from './compound'
import { biff } from './biff'
/** Bounded MS-CFB and MS-XLS value-only reader. No imported record executes. */
export function readLegacyWorkbook(base64: string, selected: unknown) {
 const {bytes,workbook}=compound(base64)
 return {...biff(workbook,selected),sha256:sha256(bytes)}
}

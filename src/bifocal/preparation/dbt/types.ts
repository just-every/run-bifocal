import type { Column } from '../../imports/files/csv'
import type { ProjectResource } from '../../imports/models/readers/types'
import type { Cell } from '../../query/types'

export type Ref = { dataset:string; revision:string; column:string }
export type Frame = { columns:Column[]; rows:Cell[][]; lineage:Record<string,Ref[]> }
export type Bindings = Record<string,string>
export type DBTInput = { projectId:string; revision:string; resources:ProjectResource[]; bindings:Bindings }
export type Diagnostic = { resource:string; code:string; file:string; message:string }
export type TestResult = { resource:string; model:string; column:string; test:'not_null'|'unique'; status:'passed'|'failed'; failures:number }
export const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)

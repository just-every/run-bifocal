import type {JsonSchema} from '../../modules/agent-door/index.ts'
const text={type:'string'}, strings={type:'array',items:text}
const record=(properties:Record<string,unknown>)=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false})
export const outputSchemas:Record<string,JsonSchema>={
 status:record({credentialId:text,modelId:text,revision:text,scopeDigest:text,active:{type:'boolean'}}),
 definitions:record({modelId:text,revision:text,viewId:text,dimensions:strings,measures:{type:'array',items:record({id:text,unit:text})},scopeDigest:text,tools:strings}),
 query:record({rows:{type:'array',items:{type:'object'}},totals:{type:'object'},totalRows:{type:'integer',minimum:0},offset:{type:'integer',minimum:0},nextOffset:{type:['integer','null'],minimum:0},citations:{type:'object',required:['modelId','revision','viewId','credentialId','sourceWatermarks','scopeDigest','definitionHash']},query:{type:'object',required:['modelId','revision','viewId','groupBy','filters','measures']}}),
}

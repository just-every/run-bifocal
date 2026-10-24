import type { CalculationExpr, CalculationGroup, CalculationMeasure, Literal } from '../core'
import type { FormulaLanguage, TranslationIssue } from '../../imports/calculations'
export type Formula={id:string;kind?:'field'|'measure';dataType?:import('../core').DataType;language:FormulaLanguage|'native';sourceExpression:string;expression?:CalculationExpr;format?:string}
export type Parameter={id:string;default:Literal;min?:string;max?:string;step?:string}
export type FieldParameter={id:string;default:string;choices:Record<string,string[]>}
export type LibraryInput={version:1;id:string;label:string;modelId:string;modelRevision:string;viewId:string;calculations:Formula[];groups:(Formula&{precedence:number})[];parameters:Parameter[];fieldParameters:FieldParameter[];source?:{format:'tmdl'|'tableau';content:string};table?:string;window?:{partitionBy:string[];orderBy:import('../core').Order[]}}
export type Library={ownerId:string;input:LibraryInput;report:{compatible:boolean;translations:(Formula&{targetExpression:CalculationExpr|null;issues:TranslationIssue[]})[];issues:TranslationIssue[];dependencies:unknown[]};fields:(Formula&{expression:CalculationExpr})[];measures:CalculationMeasure[];groups:CalculationGroup[];schema:import('../core').Schema;guards:import('../../../modules/import-kit/src/d1/types.ts').D1Sql[];sources:{id:string;revision:string}[]}

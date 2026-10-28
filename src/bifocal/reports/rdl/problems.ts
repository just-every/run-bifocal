import { QueryError } from '../../query/types'
import type { RdlNode, RdlProject } from './parse'
export class RdlExecutionError extends QueryError {
 constructor(code: string, public issues: RdlProject['report']['issues']) {super(code, 422)}
}
export function expressionProblem(node: RdlNode, error: unknown): never {
 if (error instanceof RdlExecutionError) throw error
 if (!(error instanceof QueryError)) throw error
 throw new RdlExecutionError(error.code, [{location: node.location, code: error.code, reason: error.code === 'rdl_division_by_zero' ? 'The expression divides by zero, including in an eagerly evaluated IIF branch.' : 'This expression cannot render with the supported exact source semantics.', dependency: node.text, resolution: 'Review a supported native expression and reconcile its output against the retained source before accepting a switch.'}])
}

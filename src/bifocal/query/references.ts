/** Qualified references win; otherwise the operand names a physical base column. */
export const queryReference = (ref:string,columns:ReadonlyMap<string,unknown>) => columns.has(ref)?ref:`base.${ref}`

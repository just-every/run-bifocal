import type { InputColumn, InputSchema } from './schema'

type Template = { id: Exclude<InputSchema['template'], 'custom'>; label: string; schema: InputSchema }
function analytical(id: Template['id'], label: string, kind: 'adjustment' | 'target' | 'correction', amountLabel: string, activeLabel: string): Template {
 return {
  id, label,
  schema: {
   format: 1, template: id,
   columns: [
    { name: kind, label: amountLabel, type: 'money', currency: 'USD', scale: 2 },
    { name: 'note', label: 'Reason', type: 'text', maxLength: 1000 },
    { name: 'effectiveOn', label: 'Effective date', type: 'date' },
    { name: 'active', label: activeLabel, type: 'boolean' },
   ] satisfies InputColumn[],
   effect: { kind, column: kind, activeColumn: 'active' },
  },
 }
}

export const inputTemplates: Template[] = [
 analytical('forecast-adjustment', 'Forecast adjustment', 'adjustment', 'Adjustment (USD)', 'Apply adjustment'),
 analytical('light-target', 'Light target', 'target', 'Target (USD)', 'Apply target'),
 {
  id: 'note-only', label: 'Note only',
  schema: { format: 1, template: 'note-only', columns: [{ name: 'note', label: 'Note', type: 'text', maxLength: 1000 }], effect: null },
 },
 analytical('analytical-correction', 'Analytical correction', 'correction', 'Correction (USD)', 'Apply correction'),
]

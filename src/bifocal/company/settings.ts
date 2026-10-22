import { clock, timezone } from '../calendars/timezone'
import { currency } from '../currency/rates'
import { object, requireValue, text } from './protocol'
export interface CompanySettings { name: string; currency: string; dateFormat: 'MM/DD/YYYY'; timezone: string; reportCutoff: string }
export const companyDefaults = { name: '', currency: 'USD', dateFormat: 'MM/DD/YYYY' as const, timezone: 'America/New_York', reportCutoff: '00:00' }
export function companySettings(value: unknown): CompanySettings {
 const input = object(value, ['name', 'currency', 'dateFormat', 'timezone', 'reportCutoff'])
 requireValue(input.dateFormat === undefined || input.dateFormat === 'MM/DD/YYYY', 'unsupported_date_format')
 return { name: text(input.name, 'name'), currency: currency(input.currency ?? companyDefaults.currency), dateFormat: 'MM/DD/YYYY', timezone: timezone(input.timezone ?? companyDefaults.timezone), reportCutoff: clock(input.reportCutoff ?? companyDefaults.reportCutoff, 'reportCutoff') }
}

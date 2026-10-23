-- Built-in defaults precede any owner save, so they have no owner-authored
-- update time. Keep their row image deterministic for Base's exact migration
-- replay check at restore. Owner-saved revisions and their timestamps stay intact.
UPDATE bf_company_settings
SET updated_at = ''
WHERE singleton = 1
  AND revision = 'company-defaults-v1'
  AND updated_by = 'installation'
  AND value_json = '{"name":"","currency":"USD","dateFormat":"MM/DD/YYYY","timezone":"America/New_York","reportCutoff":"00:00"}';

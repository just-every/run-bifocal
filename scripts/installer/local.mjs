import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { operatorInstaller, developmentTarget, previewTarget } from '@runeditrun/rer/operator-installer';
import { selectLocalState } from '@runeditrun/rer/local/state';
import { commandAdapter as createCommandAdapter } from '@runeditrun/rer/adapter';
import { ownerDeploy } from '@runeditrun/rer/deploy';
import { localPortability } from '@runeditrun/rer/portability';
import * as model from './ui/seed.mjs';

export { selectLocalState };
const lifecycle = operatorInstaller({
 database: 'foundation', features: model.features,
 async prepare({ root, input, store }) {
  // export and import run prepare without answers; the saved branding stays.
  if (input.APP_NAME === undefined && input.PRIMARY_COLOR === undefined) return;
  await store.step('Saving application branding');
  await writeFile(join(root, 'src/branding.json'), JSON.stringify({ name: input.APP_NAME, primaryColor: input.PRIMARY_COLOR }, null, 2) + '\n');
 },
});
export const adapter = lifecycle;
export const { install } = lifecycle;
export const commandAdapter = createCommandAdapter(lifecycle, {
 dev: developmentTarget, preview: previewTarget, verify: ['pnpm', ['run', 'verify:app']], deploy: ownerDeploy('deploy.json', lifecycle),
 portability: localPortability({ database: 'foundation', policy: { includeTables: ['oa_operators','oa_bootstrap','oa_external_identities','oa_invitation_cancellations','oa_tokens','oa_auth_settings','oa_auth_audit','oa_domain_rules','oa_logout_events','oc_owner_claims','oc_idp_grants','bf_file_tables','bf_file_reviews','bf_spreadsheet_reads','bf_analytics_reads','bf_analytics_boards','bf_analytics_cards','bf_warehouse_exports','bf_company_settings','bf_viewer_timezones','bf_calendars','bf_rate_sources','bf_schedules','bf_conventions_audit','bf_catalog_collections','bf_catalog_collection_grants','bf_catalog_items','bf_catalog_versions','bf_catalog_grants','bf_catalog_favourites','bf_catalog_dependencies','bf_catalog_sources','bf_catalog_policy','bf_catalog_usage','bf_catalog_audit','bf_catalog_epoch','bf_semantic_models','bf_semantic_revisions','bf_semantic_branches','bf_semantic_history','bf_semantic_approvals','bf_query_snapshots','bf_query_sources','bf_query_artifacts','ik_batches','ik_d1_custody_revisions','ik_d1_custody_states','ik_d1_entries','ik_d1_erased_sources','ik_d1_erased_targets','ik_d1_erasure_journal','ik_d1_erasure_progress','ik_d1_history','ik_d1_indexed_jobs','ik_d1_native_staging','ik_d1_native_staging_index','ik_d1_native_staging_values','ik_d1_original_chunks','ik_d1_plan_chunks','ik_d1_plan_index','ik_d1_preparation_receipts','ik_d1_preparation_steps','ik_d1_publication_fences','ik_d1_retirements','ik_d1_reversal_fences','ik_d1_staging','ik_d1_staging_chunks','ik_d1_staging_headers','ik_d1_staging_index','ik_d1_staging_originals','ik_d1_staging_pages','ik_d1_stream_origins','ik_d1_stream_pages','ik_d1_stream_revisions','ik_d1_stream_sources','ik_d1_streams','ik_door_apply_failures','ik_door_approvals','ik_door_archive_chunks','ik_door_archives','ik_door_chunks','ik_door_grants','ik_door_namespaces','ik_door_plan_chunks','ik_door_plans','ik_door_revoked_keys','ik_door_scopes','ik_door_settings','ik_door_uploads','ik_jobs','ik_original_sets','ik_originals','ik_provenance','ik_sources','ik_stages','ik_targets'], excludeTables: ['rer_dependency_keys','rer_dependency_pending','rer_dependency_codes'], product: 'just-every/bifocal', requiredConfiguration: ['OWNER_EMAIL', 'SESSION_SECRET', 'INSTALLATION_KEY', 'SETUP_TOKEN', 'AUTH_ORIGIN', 'MAIL_PROVIDER', 'MAIL_FROM'] }, transient: ['local runtime caches and logs'] }),
 setup: { manifestFile: 'rer-setup.json' }, browserModule: 'scripts/installer/ui/seed.mjs',
 // The run site (rer build --site, rer deploy --site, RER_SITE): pages from
 // edition identity and Run data, written to an ignored folder; its domain is in deploy-site.json.
 site: { entry: 'src/site/pages.tsx', output: 'dist/site', declaration: 'deploy-site.json', config: 'vite.site.config.ts' },
 // Local dev identity: the local-only Worker entry, the build output rer build
 // scans for the dev layer.
 devIdentity: { entry: 'src/server.dev.ts', output: ['dist'] },
 localOnlyKeys: ['RER_DEV_ORIGIN', 'RER_DEV_IDENTITY'],
 product: model.product.name, input: { names: { email: 'OWNER_EMAIL', name: 'displayName' }, async defaults(root) { const { readFile } = await import('node:fs/promises'); const branding = JSON.parse(await readFile(join(root, 'src/branding.json'), 'utf8')); return { APP_NAME: branding.name, PRIMARY_COLOR: branding.primaryColor }; } },
});

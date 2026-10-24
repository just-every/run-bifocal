import { localPortability } from '@runeditrun/rer/portability';
import policy from './archive-policy.mjs';

const native = localPortability({
 database: 'foundation', policy, transient: ['local runtime caches and logs'],
});

export const installationPortability = {
 ...native,
 async import(context) {
  if (context.platform === 'container') throw new Error('Catalog search restore requires native local transport.');
  const result = await native.import(context);
  // Native restore suppresses item triggers while loading retained rows.
  // Finish this public restore command under its existing operation lock.
  await context.store.run('Rebuilding catalog search', 'pnpm', [
   'exec', 'wrangler', 'd1', 'execute', 'foundation', '--local',
   '--persist-to', '.wrangler/state', '--config', 'wrangler.jsonc',
   '--command', 'DELETE FROM bf_catalog_search; INSERT INTO bf_catalog_search(item_id,title,description,tags) SELECT id,title,description,tags_json FROM bf_catalog_items;',
  ], {
   cwd: context.root, signal: context.signal,
   env: { ...process.env, RER_LOCAL_OPERATION: context.operationToken, WRANGLER_SEND_METRICS: 'false' },
  });
  return result;
 },
};

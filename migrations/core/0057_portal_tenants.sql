CREATE TABLE bf_portal_tenants (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','suspended','erased')),
 generation INTEGER NOT NULL DEFAULT 1, head INTEGER NOT NULL DEFAULT 0, published INTEGER, created_at TEXT NOT NULL
);
CREATE TABLE bf_portal_releases (
 tenant_id TEXT NOT NULL REFERENCES bf_portal_tenants(id), version INTEGER NOT NULL,
 document_json TEXT NOT NULL, digest TEXT NOT NULL, PRIMARY KEY(tenant_id,version)
);
CREATE TABLE bf_portal_tokens (
 nonce TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES bf_portal_tenants(id), generation INTEGER NOT NULL,
 expires_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE bf_portal_cache (
 tenant_id TEXT NOT NULL REFERENCES bf_portal_tenants(id), generation INTEGER NOT NULL, key TEXT NOT NULL, result_json TEXT NOT NULL,
 PRIMARY KEY(tenant_id,generation,key)
);
CREATE TABLE bf_portal_usage (
 tenant_id TEXT NOT NULL REFERENCES bf_portal_tenants(id), generation INTEGER NOT NULL, queries INTEGER NOT NULL DEFAULT 0,
 exports INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(tenant_id,generation)
);
CREATE TABLE bf_portal_jobs (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES bf_portal_tenants(id), generation INTEGER NOT NULL,
 release_version INTEGER NOT NULL, parameters_json TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('queued','processing','completed','cancelled'))
);
CREATE TABLE bf_portal_audit (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, actor_id TEXT NOT NULL, action TEXT NOT NULL, generation INTEGER NOT NULL, recorded_at TEXT NOT NULL
);
-- Local activation is excluded from installation archives; restored definitions need fresh review.
CREATE TABLE bf_portal_activation (
 tenant_id TEXT PRIMARY KEY REFERENCES bf_portal_tenants(id), generation INTEGER NOT NULL
);
CREATE TRIGGER bf_portal_source_changed AFTER UPDATE ON bf_file_tables BEGIN
 DELETE FROM bf_portal_activation WHERE tenant_id IN (
  SELECT t.id FROM bf_portal_tenants t JOIN bf_portal_releases r ON r.tenant_id=t.id AND r.version=t.published,
  json_each(r.document_json,'$.sources') s WHERE json_extract(s.value,'$.id')=OLD.id
 );
END;
CREATE TRIGGER bf_portal_source_erased BEFORE DELETE ON bf_file_tables BEGIN
 DELETE FROM bf_portal_activation WHERE tenant_id IN (
  SELECT t.id FROM bf_portal_tenants t JOIN bf_portal_releases r ON r.tenant_id=t.id AND r.version=t.published,
  json_each(r.document_json,'$.sources') s WHERE json_extract(s.value,'$.id')=OLD.id
 );
 DELETE FROM bf_portal_jobs WHERE EXISTS (
  SELECT 1 FROM bf_portal_releases r,json_each(r.document_json,'$.sources') s
  WHERE r.tenant_id=bf_portal_jobs.tenant_id AND r.version=bf_portal_jobs.release_version AND json_extract(s.value,'$.id')=OLD.id
 );
 DELETE FROM bf_portal_releases WHERE EXISTS (SELECT 1 FROM json_each(document_json,'$.sources') s WHERE json_extract(s.value,'$.id')=OLD.id);
 UPDATE bf_portal_tenants SET published=NULL,status='suspended',generation=generation+1 WHERE status<>'erased' AND published IS NOT NULL AND NOT EXISTS (SELECT 1 FROM bf_portal_releases r WHERE r.tenant_id=bf_portal_tenants.id AND r.version=bf_portal_tenants.published);
 DELETE FROM bf_portal_cache WHERE tenant_id NOT IN (SELECT tenant_id FROM bf_portal_activation);
 DELETE FROM bf_portal_tokens WHERE tenant_id NOT IN (SELECT tenant_id FROM bf_portal_activation);
 UPDATE bf_portal_jobs SET state='cancelled' WHERE state IN ('queued','processing') AND tenant_id NOT IN (SELECT tenant_id FROM bf_portal_activation);
END;
CREATE TRIGGER bf_portal_model_changed AFTER UPDATE OF production ON bf_semantic_models
WHEN OLD.production IS NOT NEW.production BEGIN
 DELETE FROM bf_portal_activation WHERE tenant_id IN (
  SELECT t.id FROM bf_portal_tenants t JOIN bf_portal_releases r ON r.tenant_id=t.id AND r.version=t.published
  WHERE json_extract(r.document_json,'$.document.modelId')=OLD.id
 );
END;
CREATE TRIGGER bf_portal_principal_changed AFTER UPDATE OF version,status,role ON oa_operators
WHEN OLD.version IS NOT NEW.version OR OLD.status IS NOT NEW.status OR OLD.role IS NOT NEW.role BEGIN
 DELETE FROM bf_portal_activation WHERE tenant_id IN (SELECT id FROM bf_portal_tenants WHERE owner_id=OLD.id);
END;
CREATE TRIGGER bf_portal_activation_withdrawn AFTER DELETE ON bf_portal_activation BEGIN
 DELETE FROM bf_portal_cache WHERE tenant_id=OLD.tenant_id;
 DELETE FROM bf_portal_tokens WHERE tenant_id=OLD.tenant_id;
 UPDATE bf_portal_jobs SET state='cancelled' WHERE tenant_id=OLD.tenant_id AND state IN ('queued','processing');
END;
CREATE TRIGGER bf_portal_model_erased BEFORE DELETE ON bf_semantic_models BEGIN
 DELETE FROM bf_portal_activation WHERE tenant_id IN (
  SELECT t.id FROM bf_portal_tenants t JOIN bf_portal_releases r ON r.tenant_id=t.id AND r.version=t.published
  WHERE json_extract(r.document_json,'$.document.modelId')=OLD.id
 );
END;
CREATE TRIGGER bf_portal_principal_erased BEFORE DELETE ON oa_operators BEGIN
 DELETE FROM bf_portal_activation WHERE tenant_id IN (SELECT id FROM bf_portal_tenants WHERE owner_id=OLD.id);
END;

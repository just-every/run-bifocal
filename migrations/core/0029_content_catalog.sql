CREATE TABLE bf_catalog_collections (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, parent_id TEXT REFERENCES bf_catalog_collections(id),
 name TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE bf_catalog_items (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, collection_id TEXT REFERENCES bf_catalog_collections(id),
 kind TEXT NOT NULL CHECK(kind IN ('dashboard','report','question','notebook','metric','source-column')),
 title TEXT NOT NULL, description TEXT NOT NULL, tags_json TEXT NOT NULL CHECK(json_valid(tags_json)),
 definition_json TEXT NOT NULL CHECK(json_valid(definition_json)), source_links_json TEXT NOT NULL CHECK(json_valid(source_links_json)),
 verified INTEGER NOT NULL DEFAULT 0 CHECK(verified IN (0,1)), fingerprint TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1, archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)), updated_at TEXT NOT NULL
);
CREATE TABLE bf_catalog_versions (
 item_id TEXT NOT NULL REFERENCES bf_catalog_items(id) ON DELETE CASCADE, version INTEGER NOT NULL,
 metadata_json TEXT NOT NULL CHECK(json_valid(metadata_json)), PRIMARY KEY(item_id,version)
);
CREATE TABLE bf_catalog_grants (
 item_id TEXT NOT NULL REFERENCES bf_catalog_items(id) ON DELETE CASCADE,
 operator_id TEXT NOT NULL REFERENCES oa_operators(id), PRIMARY KEY(item_id,operator_id)
);
CREATE TABLE bf_catalog_favourites (
 item_id TEXT NOT NULL REFERENCES bf_catalog_items(id) ON DELETE CASCADE,
 operator_id TEXT NOT NULL REFERENCES oa_operators(id), PRIMARY KEY(item_id,operator_id)
);
CREATE TABLE bf_catalog_dependencies (
 item_id TEXT NOT NULL REFERENCES bf_catalog_items(id) ON DELETE CASCADE,
 depends_on TEXT NOT NULL REFERENCES bf_catalog_items(id) ON DELETE CASCADE,
 PRIMARY KEY(item_id,depends_on), CHECK(item_id<>depends_on)
);
CREATE TABLE bf_catalog_policy (
 owner_id TEXT PRIMARY KEY, version INTEGER NOT NULL, usage_enabled INTEGER NOT NULL CHECK(usage_enabled IN (0,1)),
 consented_at TEXT NOT NULL
);
CREATE TABLE bf_catalog_usage (
 id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES bf_catalog_items(id) ON DELETE CASCADE,
 reader_id TEXT NOT NULL REFERENCES oa_operators(id), tenant TEXT NOT NULL, opened_at TEXT NOT NULL,
 fingerprint TEXT NOT NULL, imported_at TEXT NOT NULL
);
CREATE INDEX bf_catalog_usage_item ON bf_catalog_usage(item_id,opened_at);
CREATE TABLE bf_catalog_audit (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, actor_id TEXT NOT NULL, action TEXT NOT NULL,
 item_id TEXT, version INTEGER, digest TEXT, recorded_at TEXT NOT NULL
);
CREATE VIRTUAL TABLE bf_catalog_search USING fts5(item_id UNINDEXED,title,description,tags,tokenize='unicode61');
CREATE TRIGGER bf_catalog_search_insert AFTER INSERT ON bf_catalog_items BEGIN
 INSERT INTO bf_catalog_search(item_id,title,description,tags) VALUES(new.id,new.title,new.description,new.tags_json);
END;
CREATE TRIGGER bf_catalog_search_update AFTER UPDATE ON bf_catalog_items BEGIN
 DELETE FROM bf_catalog_search WHERE item_id=old.id;
 INSERT INTO bf_catalog_search(item_id,title,description,tags) VALUES(new.id,new.title,new.description,new.tags_json);
END;
CREATE TRIGGER bf_catalog_search_delete AFTER DELETE ON bf_catalog_items BEGIN DELETE FROM bf_catalog_search WHERE item_id=old.id; END;
CREATE TRIGGER bf_catalog_version_immutable BEFORE UPDATE ON bf_catalog_versions BEGIN SELECT RAISE(ABORT,'immutable_catalog_version'); END;
CREATE TRIGGER bf_catalog_usage_immutable BEFORE UPDATE ON bf_catalog_usage BEGIN SELECT RAISE(ABORT,'immutable_catalog_usage'); END;
CREATE TRIGGER bf_catalog_audit_immutable BEFORE UPDATE ON bf_catalog_audit BEGIN SELECT RAISE(ABORT,'immutable_catalog_audit'); END;
CREATE TABLE bf_catalog_collection_grants (
 collection_id TEXT NOT NULL REFERENCES bf_catalog_collections(id) ON DELETE CASCADE,
 operator_id TEXT NOT NULL REFERENCES oa_operators(id), PRIMARY KEY(collection_id,operator_id)
);
CREATE TABLE bf_catalog_sources (
 item_id TEXT NOT NULL REFERENCES bf_catalog_items(id) ON DELETE CASCADE,
 dataset_id TEXT NOT NULL, PRIMARY KEY(item_id,dataset_id)
);
-- A read fences the complete permission-filtered count and suggestion set.
CREATE TABLE bf_catalog_epoch (singleton INTEGER PRIMARY KEY CHECK(singleton=1), revision INTEGER NOT NULL);
INSERT INTO bf_catalog_epoch VALUES(1,0);
CREATE TRIGGER bf_catalog_epoch_item_insert AFTER INSERT ON bf_catalog_items BEGIN UPDATE bf_catalog_epoch SET revision=revision+1; END;
CREATE TRIGGER bf_catalog_epoch_item_update AFTER UPDATE ON bf_catalog_items BEGIN UPDATE bf_catalog_epoch SET revision=revision+1; END;
CREATE TRIGGER bf_catalog_epoch_item_delete AFTER DELETE ON bf_catalog_items BEGIN UPDATE bf_catalog_epoch SET revision=revision+1; END;
CREATE TRIGGER bf_catalog_epoch_grant_insert AFTER INSERT ON bf_catalog_grants BEGIN UPDATE bf_catalog_epoch SET revision=revision+1; END;
CREATE TRIGGER bf_catalog_epoch_grant_delete AFTER DELETE ON bf_catalog_grants BEGIN UPDATE bf_catalog_epoch SET revision=revision+1; END;
CREATE TRIGGER bf_catalog_epoch_collection_insert AFTER INSERT ON bf_catalog_collections BEGIN UPDATE bf_catalog_epoch SET revision=revision+1; END;
CREATE TRIGGER bf_catalog_epoch_collection_grant_insert AFTER INSERT ON bf_catalog_collection_grants BEGIN UPDATE bf_catalog_epoch SET revision=revision+1; END;
CREATE TRIGGER bf_catalog_epoch_collection_grant_delete AFTER DELETE ON bf_catalog_collection_grants BEGIN UPDATE bf_catalog_epoch SET revision=revision+1; END;
CREATE TRIGGER bf_catalog_epoch_usage_insert AFTER INSERT ON bf_catalog_usage BEGIN UPDATE bf_catalog_epoch SET revision=revision+1; END;
CREATE TRIGGER bf_catalog_epoch_usage_delete AFTER DELETE ON bf_catalog_usage BEGIN UPDATE bf_catalog_epoch SET revision=revision+1; END;
CREATE TRIGGER bf_catalog_epoch_dependency_insert AFTER INSERT ON bf_catalog_dependencies BEGIN UPDATE bf_catalog_epoch SET revision=revision+1; END;
CREATE TRIGGER bf_catalog_epoch_dependency_delete AFTER DELETE ON bf_catalog_dependencies BEGIN UPDATE bf_catalog_epoch SET revision=revision+1; END;
CREATE TRIGGER bf_catalog_epoch_favourite_insert AFTER INSERT ON bf_catalog_favourites BEGIN UPDATE bf_catalog_epoch SET revision=revision+1; END;
CREATE TRIGGER bf_catalog_epoch_favourite_delete AFTER DELETE ON bf_catalog_favourites BEGIN UPDATE bf_catalog_epoch SET revision=revision+1; END;

-- Logical grant definitions are portable; fresh activation is installation-local.
CREATE TABLE bf_catalog_grant_activation (
 kind TEXT NOT NULL CHECK(kind IN ('item','collection')),
 resource_id TEXT NOT NULL, operator_id TEXT NOT NULL REFERENCES oa_operators(id),
 operator_version INTEGER NOT NULL,
 PRIMARY KEY(kind,resource_id,operator_id)
);
CREATE TRIGGER bf_catalog_activation_insert AFTER INSERT ON bf_catalog_grant_activation BEGIN UPDATE bf_catalog_epoch SET revision=revision+1; END;
CREATE TRIGGER bf_catalog_activation_update AFTER UPDATE ON bf_catalog_grant_activation BEGIN UPDATE bf_catalog_epoch SET revision=revision+1; END;
CREATE TRIGGER bf_catalog_activation_delete AFTER DELETE ON bf_catalog_grant_activation BEGIN UPDATE bf_catalog_epoch SET revision=revision+1; END;
CREATE TRIGGER bf_catalog_grant_definition_delete AFTER DELETE ON bf_catalog_grants BEGIN DELETE FROM bf_catalog_grant_activation WHERE kind='item' AND resource_id=old.item_id AND operator_id=old.operator_id; END;
CREATE TRIGGER bf_catalog_collection_grant_definition_delete AFTER DELETE ON bf_catalog_collection_grants BEGIN DELETE FROM bf_catalog_grant_activation WHERE kind='collection' AND resource_id=old.collection_id AND operator_id=old.operator_id; END;

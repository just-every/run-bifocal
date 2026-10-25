-- Native interactive limits can be lowered by the current installation owner.
-- An absent singleton is explicit configuration revision zero: CSV 30000,
-- XLSX 150000. No rows, source grants or analytical activations are stored here.
CREATE TABLE bf_explore_export_policy (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),
 revision INTEGER NOT NULL CHECK(revision>0),
 csv INTEGER NOT NULL CHECK(csv BETWEEN 1 AND 30000),
 xlsx INTEGER NOT NULL CHECK(xlsx BETWEEN 1 AND 150000)
);
CREATE TABLE bf_explore_export_policy_audit (
 revision INTEGER PRIMARY KEY CHECK(revision>0), actor_id TEXT NOT NULL,
 previous_csv INTEGER NOT NULL, previous_xlsx INTEGER NOT NULL,
 csv INTEGER NOT NULL, xlsx INTEGER NOT NULL, recorded_at TEXT NOT NULL
);
CREATE TRIGGER bf_explore_export_policy_audit_immutable BEFORE UPDATE ON bf_explore_export_policy_audit BEGIN SELECT RAISE(ABORT,'immutable_export_policy_audit'); END;

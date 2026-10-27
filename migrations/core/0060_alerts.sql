CREATE TABLE bf_alert_rules (
 id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,
 query_id TEXT NOT NULL REFERENCES bf_query_snapshots(id) ON DELETE CASCADE,
 definition_json TEXT NOT NULL,generation INTEGER NOT NULL DEFAULT 0,
 baseline_observation_id TEXT,last_observation_id TEXT,qualifying INTEGER NOT NULL DEFAULT 0 CHECK(qualifying IN (0,1)),created_at TEXT NOT NULL
);
CREATE INDEX bf_alert_rules_owner ON bf_alert_rules(owner_id,created_at);
CREATE TABLE bf_alert_sources (
 rule_id TEXT NOT NULL REFERENCES bf_alert_rules(id) ON DELETE CASCADE,
 dataset_id TEXT NOT NULL REFERENCES bf_file_tables(id) ON DELETE CASCADE,
 PRIMARY KEY(rule_id,dataset_id)
);
CREATE TRIGGER bf_alert_source_erasure BEFORE DELETE ON bf_file_tables BEGIN
 DELETE FROM bf_alert_rules WHERE id IN (SELECT rule_id FROM bf_alert_sources WHERE dataset_id=OLD.id);
END;
CREATE TABLE bf_alert_observations (
 id TEXT PRIMARY KEY,rule_id TEXT NOT NULL REFERENCES bf_alert_rules(id) ON DELETE CASCADE,
 request_id TEXT NOT NULL,generation INTEGER NOT NULL,result_hash TEXT NOT NULL,payload_json TEXT NOT NULL,created_at TEXT NOT NULL,
 UNIQUE(rule_id,request_id),UNIQUE(rule_id,generation)
);
CREATE TABLE bf_alert_episodes (
 id TEXT PRIMARY KEY,rule_id TEXT NOT NULL REFERENCES bf_alert_rules(id) ON DELETE CASCADE,
 state TEXT NOT NULL CHECK(state IN ('open','closed')),document_json TEXT NOT NULL
);
CREATE UNIQUE INDEX bf_alert_one_open_episode ON bf_alert_episodes(rule_id) WHERE state='open';
CREATE TABLE bf_alert_transitions (
 id TEXT PRIMARY KEY,rule_id TEXT NOT NULL REFERENCES bf_alert_rules(id) ON DELETE CASCADE,
 episode_id TEXT REFERENCES bf_alert_episodes(id) ON DELETE CASCADE,
 observation_id TEXT REFERENCES bf_alert_observations(id) ON DELETE CASCADE,
 document_json TEXT NOT NULL,created_at TEXT NOT NULL
);

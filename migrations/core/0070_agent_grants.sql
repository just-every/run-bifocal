-- Exact native owner review binds one named agent to an existing bounded read
-- credential. Activation is installation-local and is never exported.
CREATE TABLE bf_agent_grants (
 agent_id TEXT PRIMARY KEY, credential_id TEXT NOT NULL REFERENCES bf_machine_credentials(id),
 owner_id TEXT NOT NULL REFERENCES oa_operators(id), reviewed_digest TEXT NOT NULL,
 reviewed_at TEXT NOT NULL
);
ALTER TABLE bf_machine_audit ADD COLUMN agent_id TEXT;
ALTER TABLE bf_machine_audit ADD COLUMN agent_name TEXT;
ALTER TABLE bf_machine_audit ADD COLUMN sponsor_name TEXT;

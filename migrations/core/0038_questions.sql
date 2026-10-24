CREATE TABLE bf_questions (
 id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,model_id TEXT NOT NULL REFERENCES bf_semantic_models(id) ON DELETE CASCADE,
 snapshot_id TEXT REFERENCES bf_query_snapshots(id) ON DELETE CASCADE,
 question TEXT NOT NULL,result_json TEXT NOT NULL,digest TEXT NOT NULL,created_at TEXT NOT NULL
);
CREATE TABLE bf_question_sources (
 question_id TEXT NOT NULL REFERENCES bf_questions(id) ON DELETE CASCADE,dataset_id TEXT NOT NULL,
 PRIMARY KEY(question_id,dataset_id)
);
CREATE TABLE bf_question_consents (
 id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,prompt_digest TEXT NOT NULL,policy_version TEXT NOT NULL,
 outcome TEXT NOT NULL,created_at TEXT NOT NULL
);

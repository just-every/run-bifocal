CREATE TABLE bf_goals (id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,metric_id TEXT NOT NULL,version INTEGER NOT NULL);
CREATE TABLE bf_goal_versions (
 goal_id TEXT NOT NULL REFERENCES bf_goals(id) ON DELETE CASCADE,
 version INTEGER NOT NULL,document_json TEXT NOT NULL,created_at TEXT NOT NULL,
 PRIMARY KEY(goal_id,version)
);
CREATE TABLE bf_goal_checkins (
 id TEXT PRIMARY KEY,goal_id TEXT NOT NULL REFERENCES bf_goals(id) ON DELETE CASCADE,
 owner_id TEXT NOT NULL,observation TEXT NOT NULL,observed_on TEXT NOT NULL,created_at TEXT NOT NULL
);

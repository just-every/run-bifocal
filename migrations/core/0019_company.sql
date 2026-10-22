-- Owner-only native US conventions. Definitions are append-only versions;
-- no schedule dispatcher, analytical report or provider feed is implied.
CREATE TABLE bf_conventions_assertions (ok INTEGER NOT NULL CHECK(ok=1));
CREATE TABLE bf_company_settings (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),
 revision TEXT NOT NULL,
 value_json TEXT NOT NULL CHECK(json_valid(value_json)),
 updated_at TEXT NOT NULL, updated_by TEXT NOT NULL
);
-- Defaults are real durable installation state, preceding first product setup.
INSERT INTO bf_company_settings(singleton,revision,value_json,updated_at,updated_by)
VALUES(1,'company-defaults-v1','{"name":"","currency":"USD","dateFormat":"MM/DD/YYYY","timezone":"America/New_York","reportCutoff":"00:00"}',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'installation');
CREATE TABLE bf_viewer_timezones (
 operator_email TEXT PRIMARY KEY, timezone TEXT NOT NULL, revision TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE TABLE bf_calendars (
 id TEXT NOT NULL, version INTEGER NOT NULL CHECK(version>0),
 value_json TEXT NOT NULL CHECK(json_valid(value_json)),
 created_at TEXT NOT NULL, created_by TEXT NOT NULL,
 PRIMARY KEY(id,version)
);
CREATE TABLE bf_rate_sources (
 id TEXT NOT NULL, version INTEGER NOT NULL CHECK(version>0),
 value_json TEXT NOT NULL CHECK(json_valid(value_json)),
 created_at TEXT NOT NULL, created_by TEXT NOT NULL,
 PRIMARY KEY(id,version)
);
CREATE TABLE bf_schedules (
 id TEXT NOT NULL, version INTEGER NOT NULL CHECK(version>0),
 value_json TEXT NOT NULL CHECK(json_valid(value_json)),
 created_at TEXT NOT NULL, created_by TEXT NOT NULL,
 PRIMARY KEY(id,version)
);
CREATE TABLE bf_conventions_audit (
 id TEXT PRIMARY KEY, actor TEXT NOT NULL, kind TEXT NOT NULL, record_id TEXT NOT NULL,
 revision TEXT NOT NULL, value_json TEXT NOT NULL CHECK(json_valid(value_json)), created_at TEXT NOT NULL
);
CREATE TRIGGER bf_calendars_immutable BEFORE UPDATE ON bf_calendars BEGIN SELECT RAISE(ABORT,'immutable_calendar_version'); END;
CREATE TRIGGER bf_rate_sources_immutable BEFORE UPDATE ON bf_rate_sources BEGIN SELECT RAISE(ABORT,'immutable_rate_version'); END;
CREATE TRIGGER bf_schedules_immutable BEFORE UPDATE ON bf_schedules BEGIN SELECT RAISE(ABORT,'immutable_schedule_version'); END;

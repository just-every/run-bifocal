CREATE TABLE IF NOT EXISTS agent_door_relay (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT, decision_id TEXT NOT NULL, business TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS agent_door_relay_business ON agent_door_relay(business,sequence);
CREATE INDEX IF NOT EXISTS agent_door_relay_decision ON agent_door_relay(decision_id,sequence);
-- Executions inherit only their decision's membership, including no membership.
-- Erasure drops the link, door and consent; preserve its existing membership.
-- Plain INSERT then DELETE: an outer UPSERT's conflict policy overrides a trigger's.
CREATE TRIGGER IF NOT EXISTS agent_door_relay_audit_insert AFTER INSERT ON agent_door_audit
WHEN json_extract(NEW.row,'$.door')='mcp' AND json_extract(NEW.row,'$.consent') IS NOT NULL
BEGIN
  INSERT INTO agent_door_relay(decision_id,business)
    SELECT NEW.id,business FROM (SELECT CASE WHEN json_extract(NEW.row,'$.decision_id') IS NOT NULL THEN
      (SELECT business FROM agent_door_relay WHERE decision_id=json_extract(NEW.row,'$.decision_id') ORDER BY sequence DESC LIMIT 1)
    ELSE COALESCE((SELECT business FROM agent_door_relay WHERE decision_id=NEW.id ORDER BY sequence DESC LIMIT 1),
      (SELECT json_extract(envelope,'$.business') FROM agent_door_state WHERE id=1)) END AS business)
    WHERE business IS NOT NULL;
  DELETE FROM agent_door_relay WHERE decision_id=NEW.id AND (
    sequence<(SELECT MAX(sequence) FROM agent_door_relay WHERE decision_id=NEW.id)
    OR (json_extract(NEW.row,'$.decision_id') IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM agent_door_relay WHERE decision_id=json_extract(NEW.row,'$.decision_id'))));
END;
CREATE TRIGGER IF NOT EXISTS agent_door_relay_audit_update AFTER UPDATE ON agent_door_audit
WHEN EXISTS(SELECT 1 FROM agent_door_relay WHERE decision_id=NEW.id)
  OR (json_extract(NEW.row,'$.door')='mcp' AND json_extract(NEW.row,'$.consent') IS NOT NULL)
BEGIN
  INSERT INTO agent_door_relay(decision_id,business)
    SELECT NEW.id,business FROM (SELECT CASE WHEN json_extract(NEW.row,'$.decision_id') IS NOT NULL THEN
      (SELECT business FROM agent_door_relay WHERE decision_id=json_extract(NEW.row,'$.decision_id') ORDER BY sequence DESC LIMIT 1)
    ELSE COALESCE((SELECT business FROM agent_door_relay WHERE decision_id=NEW.id ORDER BY sequence DESC LIMIT 1),
      (SELECT json_extract(envelope,'$.business') FROM agent_door_state WHERE id=1)) END AS business)
    WHERE business IS NOT NULL;
  DELETE FROM agent_door_relay WHERE decision_id=NEW.id AND (
    sequence<(SELECT MAX(sequence) FROM agent_door_relay WHERE decision_id=NEW.id)
    OR (json_extract(NEW.row,'$.decision_id') IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM agent_door_relay WHERE decision_id=json_extract(NEW.row,'$.decision_id'))));
END;
CREATE TRIGGER IF NOT EXISTS agent_door_relay_approval AFTER UPDATE OF state ON agent_door_approvals
WHEN EXISTS(SELECT 1 FROM agent_door_relay WHERE decision_id=json_extract(NEW.saved,'$.decision_id'))
BEGIN
  INSERT INTO agent_door_relay(decision_id,business)
    SELECT decision_id,business FROM agent_door_relay WHERE decision_id=json_extract(NEW.saved,'$.decision_id') ORDER BY sequence DESC LIMIT 1;
  DELETE FROM agent_door_relay WHERE decision_id=json_extract(NEW.saved,'$.decision_id')
    AND sequence<(SELECT MAX(sequence) FROM agent_door_relay WHERE decision_id=json_extract(NEW.saved,'$.decision_id'));
END;
CREATE TRIGGER IF NOT EXISTS agent_door_relay_review AFTER UPDATE OF state ON agent_door_reviews
WHEN EXISTS(SELECT 1 FROM agent_door_relay WHERE decision_id=json_extract(NEW.saved,'$.decision_id'))
BEGIN
  INSERT INTO agent_door_relay(decision_id,business)
    SELECT decision_id,business FROM agent_door_relay WHERE decision_id=json_extract(NEW.saved,'$.decision_id') ORDER BY sequence DESC LIMIT 1;
  DELETE FROM agent_door_relay WHERE decision_id=json_extract(NEW.saved,'$.decision_id')
    AND sequence<(SELECT MAX(sequence) FROM agent_door_relay WHERE decision_id=json_extract(NEW.saved,'$.decision_id'));
END;
-- Attribute existing eligible audits to the current Business. Older pairing
-- authority cannot be reconstructed from the audit; Business drops pre-join history.
-- A linked execution requires an eligible parent decision to enter the feed.
INSERT INTO agent_door_relay(decision_id,business)
  SELECT audit.id, json_extract(state.envelope,'$.business')
  FROM agent_door_audit audit
  JOIN agent_door_state state ON state.id=1
  LEFT JOIN agent_door_audit parent ON parent.id=json_extract(audit.row,'$.decision_id')
  WHERE json_extract(audit.row,'$.door')='mcp' AND json_extract(audit.row,'$.consent') IS NOT NULL
    AND json_extract(state.envelope,'$.business') IS NOT NULL
    AND (json_extract(audit.row,'$.decision_id') IS NULL
      OR (json_extract(parent.row,'$.door')='mcp' AND json_extract(parent.row,'$.consent') IS NOT NULL
        AND json_extract(parent.row,'$.decision_id') IS NULL))
    AND NOT EXISTS(SELECT 1 FROM agent_door_relay WHERE decision_id=audit.id)
  ORDER BY audit.sequence;

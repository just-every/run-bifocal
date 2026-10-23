CREATE TABLE bf_analytics_boards (
 id TEXT PRIMARY KEY NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('dashboard','report')),
 owner_id TEXT NOT NULL,title TEXT NOT NULL,created_at TEXT NOT NULL
);
CREATE TABLE bf_analytics_cards (
 board_id TEXT NOT NULL REFERENCES bf_analytics_boards(id) ON DELETE CASCADE,
 position INTEGER NOT NULL,snapshot_id TEXT NOT NULL REFERENCES bf_query_snapshots(id) ON DELETE CASCADE,
 PRIMARY KEY(board_id,position),UNIQUE(board_id,snapshot_id)
);
-- Withdrawing any retained answer withdraws the whole multi-source artifact.
CREATE TRIGGER bf_analytics_withdraw BEFORE DELETE ON bf_query_snapshots BEGIN
 DELETE FROM bf_analytics_boards WHERE id IN (SELECT board_id FROM bf_analytics_cards WHERE snapshot_id=OLD.id);
END;
CREATE TRIGGER bf_analytics_board_immutable BEFORE UPDATE ON bf_analytics_boards BEGIN SELECT RAISE(ABORT,'immutable_board'); END;
CREATE TRIGGER bf_analytics_card_immutable BEFORE UPDATE ON bf_analytics_cards BEGIN SELECT RAISE(ABORT,'immutable_card'); END;

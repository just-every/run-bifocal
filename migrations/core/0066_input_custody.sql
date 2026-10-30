-- Undo withdraws an imported source, not independently authored input history.
-- Only the reviewed source-erasure batch may remove these controlled copies.
DROP TRIGGER bf_input_source_removed;

CREATE TABLE bf_file_reviews (
 plan_id TEXT PRIMARY KEY,
 dataset_id TEXT NOT NULL,
 review_json TEXT NOT NULL
);
CREATE INDEX bf_file_reviews_dataset ON bf_file_reviews(dataset_id);

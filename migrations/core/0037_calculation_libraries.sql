CREATE TABLE bf_calculation_libraries (
 id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,value_json TEXT NOT NULL,revision TEXT NOT NULL
);
CREATE TABLE bf_calculation_sources (
 library_id TEXT NOT NULL,dataset_id TEXT NOT NULL,PRIMARY KEY(library_id,dataset_id)
);
CREATE TABLE bf_calculation_runs (
 id TEXT PRIMARY KEY,library_id TEXT NOT NULL,owner_id TEXT NOT NULL,value_json TEXT NOT NULL,digest TEXT NOT NULL
);
CREATE TABLE bf_calculation_models (
 library_id TEXT NOT NULL,model_id TEXT NOT NULL,PRIMARY KEY(library_id,model_id)
);

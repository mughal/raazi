CREATE TABLE IF NOT EXISTS object_stores (
 id TEXT PRIMARY KEY, endpoint TEXT NOT NULL, region TEXT NOT NULL,
 bucket TEXT NOT NULL, prefix TEXT NOT NULL, force_path_style INTEGER NOT NULL,
 access_key TEXT NOT NULL, secret_key TEXT NOT NULL, UNIQUE(endpoint,bucket)
);
CREATE TABLE IF NOT EXISTS attachments (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
 filename TEXT NOT NULL, mime TEXT NOT NULL, kind TEXT NOT NULL,
 size INTEGER NOT NULL, object_ref TEXT NOT NULL, units TEXT NOT NULL DEFAULT '[]',
 status TEXT NOT NULL, error TEXT NOT NULL DEFAULT '', warning TEXT NOT NULL DEFAULT '',
 indexed_signature TEXT NOT NULL DEFAULT '', index_backend TEXT NOT NULL DEFAULT 'local',
 created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS attachments_owner ON attachments(user_id,created_at);
CREATE TABLE IF NOT EXISTS attachment_passages (
 id TEXT PRIMARY KEY, attachment_id TEXT NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
 content TEXT NOT NULL, page INTEGER, label TEXT NOT NULL, vector TEXT
);
CREATE INDEX IF NOT EXISTS attachment_passages_file ON attachment_passages(attachment_id);
CREATE VIRTUAL TABLE IF NOT EXISTS attachment_passages_fts USING fts5(content,passage_id UNINDEXED);
CREATE TRIGGER IF NOT EXISTS attachment_passages_delete AFTER DELETE ON attachment_passages BEGIN
 DELETE FROM attachment_passages_fts WHERE passage_id=old.id;
END;

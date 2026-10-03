
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL,
          role TEXT NOT NULL, groups_json TEXT NOT NULL DEFAULT '[]', department TEXT NOT NULL DEFAULT '',
          job_title TEXT NOT NULL DEFAULT '', profile TEXT NOT NULL DEFAULT '', disabled INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1), base_url TEXT NOT NULL DEFAULT '',
          model TEXT NOT NULL DEFAULT '', api_key TEXT NOT NULL DEFAULT '',
          system_prompt TEXT NOT NULL DEFAULT 'You are Raazi, a helpful enterprise assistant.');
        INSERT OR IGNORE INTO settings(id) VALUES(1);
        CREATE TABLE IF NOT EXISTS repositories(id INTEGER PRIMARY KEY, name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '', groups_json TEXT NOT NULL DEFAULT '[]');
        CREATE TABLE IF NOT EXISTS documents(id INTEGER PRIMARY KEY,
          repo_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE, title TEXT NOT NULL, content TEXT NOT NULL);
        CREATE VIRTUAL TABLE IF NOT EXISTS chunks USING fts5(content, doc_id UNINDEXED, repo_id UNINDEXED);
        CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
          title TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY,
          conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
          role TEXT NOT NULL, content TEXT NOT NULL, sources TEXT NOT NULL DEFAULT '[]');
        CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, user_id TEXT, action TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);

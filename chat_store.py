"""Private chat history in SQLite development mode or PostgreSQL deployment mode."""
import json
import secrets
from contextlib import contextmanager
from datetime import datetime, timezone

from flask import abort


def timestamp():
    return datetime.now(timezone.utc).isoformat(timespec='microseconds')


def migrate_local(conn):
    conn.execute('''CREATE TABLE IF NOT EXISTS chat_groups(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
                    name TEXT NOT NULL, collapsed INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)''')
    columns = {row['name'] for row in conn.execute('PRAGMA table_info(conversations)')}
    additions = {'group_id': 'TEXT REFERENCES chat_groups(id) ON DELETE SET NULL',
                 'pinned': 'INTEGER NOT NULL DEFAULT 0', 'updated_at': "TEXT NOT NULL DEFAULT ''"}
    for name, ddl in additions.items():
        if name not in columns:
            conn.execute(f'ALTER TABLE conversations ADD COLUMN {name} {ddl}')
    conn.execute("UPDATE conversations SET updated_at=replace(created_at,' ','T') || '+00:00' WHERE updated_at=''")
    conn.execute('CREATE INDEX IF NOT EXISTS conversations_owner_updated ON conversations(user_id,updated_at)')
    conn.commit()


class ChatStore:
    def __init__(self, local_db, namespace, url=''):
        self.local_db, self.namespace, self.url = local_db, namespace, url
        self.backend = 'postgres' if url else 'local'
        migrate_local(local_db())
        if url:
            self.prepare_and_import()

    @contextmanager
    def connection(self):
        if self.url:
            import psycopg
            from psycopg.rows import dict_row
            with psycopg.connect(self.url, row_factory=dict_row, connect_timeout=10,
                                 options='-c statement_timeout=30000') as conn:
                yield conn
        else:
            conn = self.local_db()
            try:
                yield conn
                conn.commit()
            except Exception:
                conn.rollback()
                raise

    def execute(self, conn, sql, args=()):
        return conn.execute(sql.replace('?', '%s') if self.url else sql, args)

    def table(self, name):
        return 'raazi_chat_' + name if self.url else {'groups': 'chat_groups', 'conversations': 'conversations', 'messages': 'messages'}[name]

    def scope(self, uid):
        return ('namespace=? AND user_id=?', (self.namespace, uid)) if self.url else ('user_id=?', (uid,))

    def prepare_and_import(self):
        # Import once per persistent workspace namespace. Never resurrect deleted imported chats.
        with self.connection() as conn:
            conn.execute('SELECT pg_advisory_xact_lock(hashtextextended(%s,0))', ('raazi-chat-schema-v1',))
            conn.execute('''CREATE TABLE IF NOT EXISTS raazi_chat_groups(namespace TEXT NOT NULL, id TEXT NOT NULL,
                user_id TEXT NOT NULL, name TEXT NOT NULL, collapsed INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL, PRIMARY KEY(namespace,id), UNIQUE(namespace,user_id,id))''')
            conn.execute('''CREATE TABLE IF NOT EXISTS raazi_chat_conversations(namespace TEXT NOT NULL, id TEXT NOT NULL,
                user_id TEXT NOT NULL, title TEXT NOT NULL, group_id TEXT, pinned INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(namespace,id),
                FOREIGN KEY(namespace,user_id,group_id) REFERENCES raazi_chat_groups(namespace,user_id,id))''')
            conn.execute('''CREATE TABLE IF NOT EXISTS raazi_chat_messages(id BIGSERIAL PRIMARY KEY, namespace TEXT NOT NULL,
                conversation_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, sources TEXT NOT NULL DEFAULT '[]',
                FOREIGN KEY(namespace,conversation_id) REFERENCES raazi_chat_conversations(namespace,id) ON DELETE CASCADE)''')
            conn.execute('CREATE INDEX IF NOT EXISTS raazi_chat_owner_updated ON raazi_chat_conversations(namespace,user_id,updated_at)')
            conn.execute('CREATE INDEX IF NOT EXISTS raazi_chat_message_order ON raazi_chat_messages(namespace,conversation_id,id)')
            conn.execute('CREATE TABLE IF NOT EXISTS raazi_chat_imports(namespace TEXT PRIMARY KEY, imported_at TEXT NOT NULL)')
            # Serializes simultaneous application startups for this workspace only.
            conn.execute('SELECT pg_advisory_xact_lock(hashtextextended(%s,0))', (self.namespace,))
            if conn.execute('SELECT 1 FROM raazi_chat_imports WHERE namespace=%s', (self.namespace,)).fetchone():
                return
            local = self.local_db()
            for row in local.execute('SELECT * FROM chat_groups'):
                conn.execute('''INSERT INTO raazi_chat_groups(namespace,id,user_id,name,collapsed,created_at)
                    VALUES(%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING''',
                    (self.namespace, row['id'], row['user_id'], row['name'], row['collapsed'], row['created_at']))
            for row in local.execute('SELECT * FROM conversations'):
                conn.execute('''INSERT INTO raazi_chat_conversations(namespace,id,user_id,title,group_id,pinned,created_at,updated_at)
                    VALUES(%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING''',
                    (self.namespace, row['id'], row['user_id'], row['title'], row['group_id'], row['pinned'], row['created_at'], row['updated_at']))
            for row in local.execute('SELECT * FROM messages ORDER BY id'):
                conn.execute('''INSERT INTO raazi_chat_messages(namespace,conversation_id,role,content,sources)
                    VALUES(%s,%s,%s,%s,%s)''', (self.namespace, row['conversation_id'], row['role'], row['content'], row['sources']))
            conn.execute('INSERT INTO raazi_chat_imports(namespace,imported_at) VALUES(%s,%s)', (self.namespace, timestamp()))

    def owned(self, conn, uid, cid, lock=False):
        clause, args = self.scope(uid)
        suffix = ' FOR UPDATE' if lock and self.url else ''
        row = self.execute(conn, f'SELECT * FROM {self.table("conversations")} WHERE {clause} AND id=?' + suffix, (*args, cid)).fetchone()
        if not row:
            abort(404)
        return row

    def owned_group(self, conn, uid, gid, lock=False):
        clause, args = self.scope(uid)
        suffix = ' FOR UPDATE' if lock and self.url else ''
        row = self.execute(conn, f'SELECT * FROM {self.table("groups")} WHERE {clause} AND id=?' + suffix, (*args, gid)).fetchone()
        if not row:
            abort(404)
        return row

    def list(self, uid):
        with self.connection() as conn:
            clause, args = self.scope(uid)
            chats = [dict(row) for row in self.execute(conn, f'SELECT * FROM {self.table("conversations")} WHERE {clause} ORDER BY updated_at DESC,id', args)]
            groups = [dict(row) for row in self.execute(conn, f'SELECT * FROM {self.table("groups")} WHERE {clause} ORDER BY created_at,id', args)]
            for row in chats:
                row.pop('namespace', None)
                row['pinned'] = bool(row['pinned'])
            for row in groups:
                row.pop('namespace', None)
                row['collapsed'] = bool(row['collapsed'])
            return chats, groups

    def messages(self, uid, cid, limit=None):
        with self.connection() as conn:
            self.owned(conn, uid, cid)
            clause = 'namespace=? AND conversation_id=?' if self.url else 'conversation_id=?'
            args = (self.namespace, cid) if self.url else (cid,)
            suffix = ' ORDER BY id DESC LIMIT ?' if limit else ' ORDER BY id'
            rows = [dict(row) for row in self.execute(conn, f'SELECT * FROM {self.table("messages")} WHERE {clause}' + suffix, (*args, limit) if limit else args)]
            for row in rows:
                row.pop('namespace', None)
            return rows[::-1] if limit else rows

    def append_turn(self, uid, cid, prompt, answer, sources, group_id=None):
        now = timestamp()
        with self.connection() as conn:
            if cid:
                self.owned(conn, uid, cid, lock=True)
            else:
                if group_id:
                    self.owned_group(conn, uid, group_id, lock=True)
                cid = secrets.token_urlsafe(18)
                columns = 'id,user_id,title,group_id,created_at,updated_at'
                values = (cid, uid, prompt[:70], group_id, now, now)
                if self.url:
                    columns = 'namespace,' + columns
                    values = (self.namespace, *values)
                marks = ','.join('?' for _ in values)
                self.execute(conn, f'INSERT INTO {self.table("conversations")}({columns}) VALUES({marks})', values)
            for role, content, refs in [('user', prompt, '[]'), ('assistant', answer, json.dumps(sources))]:
                columns, values = 'conversation_id,role,content,sources', (cid, role, content, refs)
                if self.url:
                    columns, values = 'namespace,' + columns, (self.namespace, *values)
                marks = ','.join('?' for _ in values)
                self.execute(conn, f'INSERT INTO {self.table("messages")}({columns}) VALUES({marks})', values)
            clause, args = self.scope(uid)
            self.execute(conn, f'UPDATE {self.table("conversations")} SET updated_at=? WHERE {clause} AND id=?', (now, *args, cid))
        return cid

    def update_chat(self, uid, cid, changes):
        with self.connection() as conn:
            # Match group-delete lock order: group before conversation.
            if changes.get('group_id'):
                self.owned_group(conn, uid, changes['group_id'], lock=True)
            self.owned(conn, uid, cid, lock=True)
            if changes:
                clause, args = self.scope(uid)
                assignments = ','.join(f'{name}=?' for name in changes)
                self.execute(conn, f'UPDATE {self.table("conversations")} SET {assignments} WHERE {clause} AND id=?', (*changes.values(), *args, cid))

    def delete_chat(self, uid, cid):
        with self.connection() as conn:
            self.owned(conn, uid, cid, lock=True)
            clause, args = self.scope(uid)
            self.execute(conn, f'DELETE FROM {self.table("conversations")} WHERE {clause} AND id=?', (*args, cid))

    def create_group(self, uid, name):
        gid = secrets.token_urlsafe(18)
        with self.connection() as conn:
            columns, values = 'id,user_id,name,created_at', (gid, uid, name, timestamp())
            if self.url:
                columns, values = 'namespace,' + columns, (self.namespace, *values)
            self.execute(conn, f'INSERT INTO {self.table("groups")}({columns}) VALUES({",".join("?" for _ in values)})', values)
        return gid

    def update_group(self, uid, gid, changes):
        with self.connection() as conn:
            self.owned_group(conn, uid, gid, lock=True)
            if changes:
                clause, args = self.scope(uid)
                self.execute(conn, f'UPDATE {self.table("groups")} SET {",".join(f"{key}=?" for key in changes)} WHERE {clause} AND id=?', (*changes.values(), *args, gid))

    def delete_group(self, uid, gid):
        with self.connection() as conn:
            self.owned_group(conn, uid, gid, lock=True)
            clause, args = self.scope(uid)
            # Deleting a folder never deletes its conversations.
            self.execute(conn, f'UPDATE {self.table("conversations")} SET group_id=NULL WHERE {clause} AND group_id=?', (*args, gid))
            self.execute(conn, f'DELETE FROM {self.table("groups")} WHERE {clause} AND id=?', (*args, gid))

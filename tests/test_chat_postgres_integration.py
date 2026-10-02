"""Opt-in PostgreSQL history import and durable private grouping test."""
import os
import sqlite3
import uuid

import pytest
from werkzeug.exceptions import NotFound

from chat_store import ChatStore


def test_live_postgres_chat_history_import_groups_and_namespaces(tmp_path):
    url = os.environ.get('TEST_VECTOR_DATABASE_URL')
    if not url:
        pytest.skip('TEST_VECTOR_DATABASE_URL is not configured; live PostgreSQL chat storage not verified')
    local = sqlite3.connect(tmp_path / 'legacy.db')
    local.row_factory = sqlite3.Row
    local.execute('PRAGMA foreign_keys=ON')
    local.executescript('''CREATE TABLE users(id TEXT PRIMARY KEY);
        INSERT INTO users VALUES('employee'); INSERT INTO users VALUES('other');
        CREATE TABLE conversations(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),title TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE messages(id INTEGER PRIMARY KEY,conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
          role TEXT NOT NULL,content TEXT NOT NULL,sources TEXT NOT NULL DEFAULT '[]');
        INSERT INTO conversations(id,user_id,title) VALUES('legacy','employee','Imported chat');
        INSERT INTO messages(conversation_id,role,content) VALUES('legacy','user','Existing message');''')
    namespace = 'chat-test-' + uuid.uuid4().hex
    store = None
    try:
        store = ChatStore(lambda: local, namespace, url)
        assert store.backend == 'postgres'
        assert store.messages('employee','legacy')[0]['content'] == 'Existing message'
        gid = store.create_group('employee','Engineering')
        cid = store.append_turn('employee',None,'Sprint plan','Ready',[],gid)
        store.update_chat('employee',cid,{'title':'Roadmap','pinned':1})
        store.update_group('employee',gid,{'collapsed':1})
        restarted = ChatStore(lambda: local,namespace,url)
        chats, groups = restarted.list('employee')
        assert len(chats) == 2 and len(groups) == 1
        assert chats[0]['title'] == 'Roadmap' and chats[0]['pinned'] is True
        assert groups[0]['collapsed'] is True
        assert restarted.list('other') == ([],[])
        with pytest.raises(NotFound):
            restarted.update_chat('other',cid,{'pinned':1})
        with pytest.raises(NotFound):
            restarted.update_chat('other',cid,{'group_id':gid})
        restarted.delete_group('employee',gid)
        assert restarted.list('employee')[0][0]['group_id'] is None
        assert len(restarted.messages('employee',cid)) == 2
        restarted.delete_chat('employee','legacy')
        again = ChatStore(lambda: local,namespace,url)
        with pytest.raises(NotFound):
            again.messages('employee','legacy')  # startup import must never resurrect a deletion
        again.namespace += '-different-workspace'
        assert again.list('employee') == ([],[])
    finally:
        if store:
            with store.connection() as conn:
                conn.execute('DELETE FROM raazi_chat_conversations WHERE namespace=%s',(namespace,))
                conn.execute('DELETE FROM raazi_chat_groups WHERE namespace=%s',(namespace,))
                conn.execute('DELETE FROM raazi_chat_imports WHERE namespace=%s',(namespace,))
        local.close()

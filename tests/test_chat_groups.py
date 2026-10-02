import sqlite3
from unittest.mock import Mock

import pytest
from psycopg import OperationalError

from app import create_app
from test_app import setup, configure, regular_user


def send_chat(client, headers, monkeypatch, message='Discuss quarterly planning', group_id=None):
    configure(client, headers)
    response = Mock()
    response.json.return_value = {'choices': [{'message': {'content': 'Here is a plan.'}}]}
    monkeypatch.setattr('app.requests.post', Mock(return_value=response))
    result = client.post('/api/chat', headers=headers, json={'message': message, 'group_id': group_id})
    assert result.status_code == 200, result.json
    return result.json['conversation_id']


def group(client, headers, name='Project Raazi'):
    result = client.post('/api/chat-groups', headers=headers, json={'name': name})
    assert result.status_code == 201
    return result.json['id']


def test_group_rename_collapse_move_pin_and_reload(setup, monkeypatch):
    app, client, headers = setup
    gid = group(client, headers)
    cid = send_chat(client, headers, monkeypatch)
    assert client.patch('/api/conversations/' + cid, headers=headers,
                        json={'group_id': gid, 'title': 'Deployment plan', 'pinned': True}).status_code == 200
    assert client.patch('/api/chat-groups/' + gid, headers=headers,
                        json={'name': 'Engineering', 'collapsed': True}).status_code == 200
    result = client.get('/api/workspace').json
    assert result['chat_storage'] == 'local'
    assert result['groups'][0]['name'] == 'Engineering'
    assert result['groups'][0]['collapsed'] is True
    assert result['conversations'][0]['group_id'] == gid
    assert result['conversations'][0]['pinned'] is True
    restarted = create_app(dict(app.config))
    other_client = restarted.test_client()
    with other_client.session_transaction() as session:
        session['uid'] = 'dev-admin'
    saved = other_client.get('/api/workspace').json
    assert saved['conversations'][0]['title'] == 'Deployment plan'
    assert saved['groups'][0]['collapsed'] is True
    assert len(other_client.get('/api/conversations/' + cid).json) == 2


def test_group_deletion_keeps_messages_and_pin(setup, monkeypatch):
    _, client, headers = setup
    gid = group(client, headers)
    cid = send_chat(client, headers, monkeypatch, group_id=gid)
    client.patch('/api/conversations/' + cid, headers=headers, json={'pinned': True})
    assert client.delete('/api/chat-groups/' + gid, headers=headers).status_code == 200
    workspace = client.get('/api/workspace').json
    assert workspace['groups'] == []
    assert workspace['conversations'][0]['group_id'] is None
    assert workspace['conversations'][0]['pinned'] is True
    assert len(client.get('/api/conversations/' + cid).json) == 2


def test_group_and_chat_ownership_are_enforced(setup, monkeypatch):
    app, admin, headers = setup
    gid = group(admin, headers)
    cid = send_chat(admin, headers, monkeypatch)
    user, user_headers = regular_user(app)
    user_group = group(user, user_headers, 'Private employee folder')
    assert user.get('/api/workspace').json['groups'][0]['id'] == user_group
    assert user.get('/api/workspace').json['conversations'] == []
    assert user.patch('/api/chat-groups/' + gid, headers=user_headers, json={'name': 'Hijacked'}).status_code == 404
    assert user.delete('/api/chat-groups/' + gid, headers=user_headers).status_code == 404
    assert user.patch('/api/conversations/' + cid, headers=user_headers, json={'pinned': True}).status_code == 404
    assert admin.patch('/api/conversations/' + cid, headers=headers, json={'group_id': user_group}).status_code == 404
    assert user.post('/api/chat', headers=user_headers, json={'message': 'Hello', 'group_id': gid}).status_code == 404
    assert admin.get('/api/workspace').json['conversations'][0]['group_id'] is None


def test_group_validation_csrf_and_empty_changes(setup, monkeypatch):
    _, client, headers = setup
    gid = group(client, headers)
    cid = send_chat(client, headers, monkeypatch)
    assert client.post('/api/chat-groups', json={'name': 'Unauthorized mutation'}).status_code == 403
    for name in ['', '   ', 'A' * 101, []]:
        assert client.post('/api/chat-groups', headers=headers, json={'name': name}).status_code == 400
    for patch in [{'pinned': 'yes'}, {'group_id': ''}, {'title': ''}, {}]:
        assert client.patch('/api/conversations/' + cid, headers=headers, json=patch).status_code == 400
    assert client.patch('/api/chat-groups/' + gid, headers=headers, json={'collapsed': 'yes'}).status_code == 400
    assert client.patch('/api/chat-groups/' + gid, headers=headers, json={}).status_code == 400


def test_new_chat_group_validated_before_inference(setup, monkeypatch):
    _, client, headers = setup
    configure(client, headers)
    post = Mock()
    monkeypatch.setattr('app.requests.post', post)
    result = client.post('/api/chat', headers=headers, json={'message': 'Hello', 'group_id': 'missing-folder'})
    assert result.status_code == 404
    post.assert_not_called()
    assert client.get('/api/workspace').json['conversations'] == []


def test_recency_updates_when_existing_chat_continues(setup, monkeypatch):
    _, client, headers = setup
    first = send_chat(client, headers, monkeypatch, 'First chat')
    second = send_chat(client, headers, monkeypatch, 'Second chat')
    assert client.get('/api/workspace').json['conversations'][0]['id'] == second
    assert client.post('/api/chat', headers=headers, json={'message': 'Follow up', 'conversation_id': first}).status_code == 200
    assert client.get('/api/workspace').json['conversations'][0]['id'] == first
    assert len(client.get('/api/conversations/' + first).json) == 4


def test_conversation_deleted_during_inference_not_resurrected(setup, monkeypatch):
    app, client, headers = setup
    cid = send_chat(client, headers, monkeypatch)
    def inference(*_args, **_kwargs):
        other = sqlite3.connect(app.config['DATABASE'])
        other.execute('PRAGMA foreign_keys=ON')
        other.execute('DELETE FROM conversations WHERE id=?', (cid,))
        other.commit()
        other.close()
        response = Mock()
        response.json.return_value = {'choices': [{'message': {'content': 'A late reply'}}]}
        return response
    monkeypatch.setattr('app.requests.post', inference)
    result = client.post('/api/chat', headers=headers, json={'message': 'Continue', 'conversation_id': cid})
    assert result.status_code == 404
    assert client.get('/api/workspace').json['conversations'] == []


def test_postgres_outage_reports_safe_error_without_fallback(setup, monkeypatch):
    app, client, _ = setup
    monkeypatch.setattr(app.extensions['chat_store'], 'list', Mock(side_effect=OperationalError('sensitive connection text')))
    response = client.get('/api/workspace')
    assert response.status_code == 503
    assert 'sensitive connection text' not in response.get_data(as_text=True)


def test_legacy_chats_receive_group_fields_idempotently(setup):
    app, _, _ = setup
    conn = sqlite3.connect(app.config['DATABASE'])
    conn.execute("INSERT INTO conversations(id,user_id,title) VALUES('old','dev-admin','Legacy chat')")
    conn.execute("INSERT INTO messages(conversation_id,role,content) VALUES('old','user','Hello')")
    conn.commit()
    conn.close()
    for _ in range(2):
        create_app(dict(app.config))
    conn = sqlite3.connect(app.config['DATABASE'])
    assert conn.execute("SELECT count(*) FROM messages WHERE conversation_id='old'").fetchone()[0] == 1
    row = conn.execute("SELECT group_id,pinned,updated_at FROM conversations WHERE id='old'").fetchone()
    assert row[0] is None and row[1] == 0 and row[2]
    conn.close()

import json
import sqlite3
from unittest.mock import Mock

import pytest
import requests

from app import create_app


@pytest.fixture
def setup(tmp_path, monkeypatch):
    monkeypatch.delenv('ENCRYPTION_KEY', raising=False)
    app = create_app({'TESTING': True, 'SECRET_KEY': 'test-session-secret', 'DATABASE': str(tmp_path / 'test.db'),
                      'AUTH_MODE': 'development', 'SESSION_COOKIE_SECURE': False, 'VECTOR_DATABASE_URL': '', 'CHAT_DATABASE_URL': ''})
    client = app.test_client()
    csrf = client.get('/api/session').json['csrf']
    client.post('/auth/development', json={}, headers={'X-CSRF-Token': csrf})
    csrf = client.get('/api/session').json['csrf']
    return app, client, {'X-CSRF-Token': csrf}


def configure(client, headers):
    result = client.put('/api/admin/settings', headers=headers, json={
        'base_url': 'http://localhost:1234/v1', 'model': 'test-model', 'api_key': 'test-secret',
        'system_prompt': 'Be helpful.'})
    assert result.status_code == 200


def add_repo(client, headers, groups=None):
    rid = client.post('/api/admin/repositories', headers=headers,
                      json={'name': 'HR', 'groups': groups or []}).json['id']
    result = client.post('/api/admin/documents', headers=headers,
                        json={'repository_id': rid, 'title': 'Leave policy', 'content': 'Annual leave allowance is 25 days.'})
    assert result.status_code == 201
    return rid, result.json['id']


def regular_user(app, groups=None):
    conn = sqlite3.connect(app.config['DATABASE'])
    conn.execute('INSERT INTO users(id,name,email,role,groups_json) VALUES(?,?,?,?,?)',
                 ('user-1', 'Employee', 'employee@example.test', 'user', json.dumps(groups or [])))
    conn.commit()
    conn.close()
    client = app.test_client()
    with client.session_transaction() as session:
        session['uid'] = 'user-1'
        session['csrf'] = 'user-csrf'
    return client, {'X-CSRF-Token': 'user-csrf'}


def test_auth_and_csrf(setup):
    app, admin, headers = setup
    anonymous = app.test_client()
    assert anonymous.get('/api/workspace').status_code == 401
    assert admin.put('/api/admin/settings', json={}).status_code == 403
    user, user_headers = regular_user(app)
    assert user.get('/api/admin').status_code == 403
    assert user.post('/api/admin/repositories', json={'name': 'bad'}, headers=user_headers).status_code == 403
    assert admin.post('/auth/logout', headers=headers).status_code == 200
    assert admin.get('/api/admin').status_code == 401


def test_secret_encrypted_and_never_returned(setup):
    app, client, headers = setup
    configure(client, headers)
    settings = client.get('/api/admin').json['settings']
    assert settings['has_api_key'] is True
    assert 'api_key' not in settings
    conn = sqlite3.connect(app.config['DATABASE'])
    stored = conn.execute('SELECT api_key FROM settings').fetchone()[0]
    conn.close()
    assert stored != 'test-secret' and stored.startswith('gAAAA')


def test_retrieval_chat_history_and_ownership(setup, monkeypatch):
    app, client, headers = setup
    configure(client, headers)
    rid, did = add_repo(client, headers)
    response = Mock()
    response.json.return_value = {'choices': [{'message': {'content': 'You have 25 days [1].'}}]}
    post = Mock(return_value=response)
    monkeypatch.setattr('app.requests.post', post)
    result = client.post('/api/chat', headers=headers, json={'message': 'What is the annual leave allowance?', 'repository_id': rid})
    assert result.status_code == 200
    assert result.json['sources'][0]['document_id'] == did
    payload = post.call_args.kwargs
    assert '25 days' in payload['json']['messages'][0]['content']
    assert payload['headers']['Authorization'] == 'Bearer test-secret'
    assert payload['allow_redirects'] is False
    cid = result.json['conversation_id']
    assert len(client.get('/api/conversations/' + cid).json) == 2
    user, user_headers = regular_user(app)
    assert user.get('/api/conversations/' + cid).status_code == 404
    assert user.delete('/api/conversations/' + cid, headers=user_headers).status_code == 404
    assert user.post('/api/chat', json={'message': 'Continue', 'conversation_id': cid}, headers=user_headers).status_code == 404


def test_repository_group_filtering(setup, monkeypatch):
    app, client, headers = setup
    configure(client, headers)
    restricted, _ = add_repo(client, headers, ['hr-group'])
    user, user_headers = regular_user(app)
    assert user.get('/api/workspace').json['repositories'] == []
    assert user.post('/api/chat', headers=user_headers, json={'message': 'Leave', 'repository_id': restricted}).status_code == 403
    response = Mock()
    response.json.return_value = {'choices': [{'message': {'content': 'No evidence.'}}]}
    monkeypatch.setattr('app.requests.post', Mock(return_value=response))
    result = user.post('/api/chat', headers=user_headers, json={'message': 'Annual leave allowance'})
    assert result.status_code == 200
    assert result.json['sources'] == []
    conn = sqlite3.connect(app.config['DATABASE'])
    conn.execute('UPDATE users SET groups_json=? WHERE id=?', (json.dumps(['hr-group']), 'user-1'))
    conn.commit()
    conn.close()
    assert len(user.get('/api/workspace').json['repositories']) == 1
    result = user.post('/api/chat', headers=user_headers, json={'message': 'Annual leave allowance'})
    assert len(result.json['sources']) == 1


def test_disabled_user_and_self_lockout(setup):
    app, client, headers = setup
    user, _ = regular_user(app)
    assert client.put('/api/admin/users', headers=headers, json={'id': 'dev-admin', 'disabled': True}).status_code == 400
    assert client.put('/api/admin/users', headers=headers, json={'id': 'user-1', 'disabled': True}).status_code == 200
    assert user.get('/api/workspace').status_code == 401


def test_failed_model_does_not_save_partial_conversation(setup, monkeypatch):
    _, client, headers = setup
    configure(client, headers)
    monkeypatch.setattr('app.requests.post', Mock(side_effect=requests.Timeout))
    result = client.post('/api/chat', headers=headers, json={'message': 'Hello'})
    assert result.status_code == 502
    assert client.get('/api/workspace').json['conversations'] == []


def test_delete_removes_search_chunks(setup):
    app, client, headers = setup
    rid, did = add_repo(client, headers)
    assert client.delete('/api/admin/documents/' + str(did), headers=headers).status_code == 200
    conn = sqlite3.connect(app.config['DATABASE'])
    assert conn.execute('SELECT count(*) FROM chunks').fetchone()[0] == 0
    conn.close()
    assert client.delete('/api/admin/repositories/' + str(rid), headers=headers).status_code == 200


def test_invalid_inputs(setup):
    _, client, headers = setup
    assert client.post('/api/admin/repositories', headers=headers, json={'name': 'HR', 'groups': 'everyone'}).status_code == 400
    assert client.put('/api/admin/settings', headers=headers, json={'base_url': 'file:///etc/passwd'}).status_code == 400
    assert client.post('/api/chat', headers=headers, json={'message': []}).status_code == 400
    assert client.post('/api/chat', headers=headers, json=[]).status_code == 400


def test_enterprise_mode_cannot_use_development_login(setup):
    app, client, headers = setup
    app.config['AUTH_MODE'] = 'oidc'
    assert client.post('/auth/development', json={}, headers=headers).status_code == 404

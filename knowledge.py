"""Document ingestion and semantic retrieval, with SQLite metadata as authority."""
import hashlib
import io
import json
import math
import os
import re
import threading
import uuid
import zipfile
from pathlib import PurePath
from urllib.parse import urlparse

import requests
from flask import abort, g, jsonify, request, send_file, send_from_directory

MAX_UPLOAD = 20 * 1024 * 1024
MAX_TEXT = 500000


class KnowledgeError(Exception):
    pass


def extract_document(filename, raw):
    """Return source units; PDF units are physical pages, DOCX units are blocks."""
    extension = PurePath(filename).suffix.lower()
    units, warnings = [], []
    try:
        if extension == '.pdf':
            from pypdf import PdfReader
            reader = PdfReader(io.BytesIO(raw))
            if reader.is_encrypted:
                raise KnowledgeError('Password-protected PDFs are not supported. Upload an unlocked copy.')
            if len(reader.pages) > 500:
                raise KnowledgeError('PDFs are limited to 500 pages.')
            blank = 0
            total = 0
            for number, page in enumerate(reader.pages, 1):
                text = (page.extract_text() or '').strip()
                total += len(text)
                if total > MAX_TEXT:
                    raise KnowledgeError('Extracted text exceeds 500,000 characters. Split this document.')
                if text:
                    units.append({'text': text, 'page': number, 'label': f'Page {number}'})
                else:
                    blank += 1
            if blank:
                warnings.append(f'{blank} page(s) have no extractable text. Scanned pages require OCR before upload.')
            mime = 'application/pdf'
        elif extension == '.docx':
            from docx import Document
            from docx.text.paragraph import Paragraph
            with zipfile.ZipFile(io.BytesIO(raw)) as archive:
                if sum(info.file_size for info in archive.infolist()) > 50 * 1024 * 1024:
                    raise KnowledgeError('Expanded DOCX exceeds the 50 MB safety limit.')
            doc = Document(io.BytesIO(raw))
            section, total = '', 0
            for number, block in enumerate(doc.iter_inner_content(), 1):
                if isinstance(block, Paragraph):
                    text = block.text.strip()
                    if block.style and block.style.name.startswith('Heading'):
                        section = text
                    label = f'{section} / paragraph {number}' if section else f'Paragraph {number}'
                else:
                    text = '\n'.join(' | '.join(cell.text for cell in row.cells) for row in block.rows)
                    label = f'{section} / table {number}' if section else f'Table {number}'
                total += len(text)
                if total > MAX_TEXT:
                    raise KnowledgeError('Extracted text exceeds 500,000 characters. Split this document.')
                if text:
                    units.append({'text': text, 'page': None, 'label': label})
            mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        elif extension in ('.txt', '.md'):
            text = raw.decode('utf-8-sig').strip()
            units = [{'text': text, 'page': None, 'label': 'Text'}] if text else []
            mime = 'text/plain'
        else:
            raise KnowledgeError('Supported formats: PDF, DOCX, UTF-8 TXT and Markdown.')
    except KnowledgeError:
        raise
    except Exception as error:
        raise KnowledgeError('Could not read this document. Check its format and upload an unencrypted, valid file.') from error
    if not units:
        raise KnowledgeError('No text could be extracted. Scanned PDFs require OCR before upload.')
    if sum(len(unit['text']) for unit in units) > MAX_TEXT:
        raise KnowledgeError('Extracted text exceeds 500,000 characters. Split this document.')
    return units, mime, ' '.join(warnings)


def chunk_units(units):
    chunks = []
    for unit in units:
        for start in range(0, len(unit['text']), 1400):
            text = unit['text'][start:start + 1800].strip()
            if text:
                chunks.append({'id': uuid.uuid4().hex, 'content': text,
                               'page': unit['page'], 'label': unit['label']})
    if len(chunks) > 2000:
        raise KnowledgeError('Document has too many sections. Split it into smaller files.')
    return chunks


def signature(settings):
    if not settings['embedding_url']:
        return 'keyword'
    value = [settings['embedding_url'], settings['embedding_model'], settings['embedding_dimensions'], 'chunks-v1']
    return hashlib.sha256(json.dumps(value).encode()).hexdigest()


def embeddings(settings, cipher, texts):
    headers = {'Content-Type': 'application/json'}
    if settings['embedding_key']:
        headers['Authorization'] = 'Bearer ' + cipher.decrypt(settings['embedding_key'].encode()).decode()
    result = []
    try:
        for offset in range(0, len(texts), 32):
            batch = texts[offset:offset + 32]
            response = requests.post(settings['embedding_url'] + '/embeddings', headers=headers,
                                     json={'model': settings['embedding_model'], 'input': batch, 'encoding_format': 'float'},
                                     timeout=(10, 120), allow_redirects=False)
            response.raise_for_status()
            data = response.json()['data']
            if not isinstance(data, list) or len(data) != len(batch):
                raise ValueError('Incorrect number of embeddings')
            if any(type(item['index']) is not int for item in data):
                raise ValueError('Invalid embedding indices')
            data = sorted(data, key=lambda item: item['index'])
            if [item['index'] for item in data] != list(range(len(batch))):
                raise ValueError('Invalid embedding indices')
            for item in data:
                vector = item['embedding']
                if not isinstance(vector, list) or len(vector) != settings['embedding_dimensions']:
                    raise ValueError('Dimension mismatch')
                if any(type(x) not in (float, int) or not math.isfinite(x) for x in vector):
                    raise ValueError('Invalid vector')
                norm = math.sqrt(sum(x*x for x in vector))
                if not math.isfinite(norm) or norm == 0:
                    raise ValueError('Invalid vector norm')
                result.append([x / norm for x in vector])
    except (requests.RequestException, ValueError, KeyError, TypeError, OverflowError) as error:
        raise KnowledgeError('Embedding request failed. Check endpoint, model, credentials, and vector dimensions.') from error
    return result


class PgVectors:
    """One HNSW table per dimension; namespace isolates different Raazi databases."""
    def __init__(self, url, namespace):
        self.url, self.namespace = url, namespace

    def connect(self):
        import psycopg
        return psycopg.connect(self.url, connect_timeout=10, options='-c statement_timeout=30000')

    def table(self, dimensions):
        if type(dimensions) is not int or not 1 <= dimensions <= 2000:
            raise KnowledgeError('Vector dimensions must be between 1 and 2000.')
        return f'raazi_vectors_{dimensions}'

    def prepare(self, dimensions):
        table = self.table(dimensions)
        with self.connect() as conn:
            conn.execute('CREATE EXTENSION IF NOT EXISTS vector')
            conn.execute(f'''CREATE TABLE IF NOT EXISTS {table} (id TEXT PRIMARY KEY, namespace TEXT NOT NULL,
                repo_id BIGINT NOT NULL, signature TEXT NOT NULL, embedding vector({dimensions}) NOT NULL)''')
            conn.execute(f'CREATE INDEX IF NOT EXISTS {table}_hnsw ON {table} USING hnsw (embedding vector_cosine_ops)')
            conn.execute(f'CREATE INDEX IF NOT EXISTS {table}_scope ON {table}(namespace, signature, repo_id)')

    def put(self, dimensions, repo_id, sig, chunks, vectors):
        self.prepare(dimensions)
        table = self.table(dimensions)
        with self.connect() as conn:
            with conn.cursor() as cursor:
                cursor.executemany(f'''INSERT INTO {table}(id,namespace,repo_id,signature,embedding) VALUES(%s,%s,%s,%s,%s::vector)
                    ON CONFLICT(id) DO UPDATE SET signature=excluded.signature,embedding=excluded.embedding''',
                    [(c['id'], self.namespace, repo_id, sig, json.dumps(v)) for c, v in zip(chunks, vectors)])

    def search(self, dimensions, sig, repo_ids, vector):
        table = self.table(dimensions)
        with self.connect() as conn:
            conn.execute("SET LOCAL hnsw.iterative_scan = 'strict_order'")
            rows = conn.execute(f'''SELECT id, 1 - (embedding <=> %s::vector) AS score FROM {table}
                WHERE namespace=%s AND signature=%s AND repo_id=ANY(%s)
                ORDER BY embedding <=> %s::vector LIMIT 40''',
                (json.dumps(vector), self.namespace, sig, repo_ids, json.dumps(vector))).fetchall()
        return rows

    def delete(self, ids):
        if not ids:
            return
        with self.connect() as conn:
            tables = conn.execute("SELECT tablename FROM pg_tables WHERE schemaname=current_schema() AND tablename LIKE 'raazi_vectors_%'").fetchall()
            for (table,) in tables:
                if re.fullmatch(r'raazi_vectors_\d+', table):
                    conn.execute(f'DELETE FROM {table} WHERE namespace=%s AND id=ANY(%s)', (self.namespace, ids))


def migrate(conn):
    additions = {
        'settings': {'embedding_url': "TEXT NOT NULL DEFAULT ''", 'embedding_model': "TEXT NOT NULL DEFAULT ''",
                     'embedding_key': "TEXT NOT NULL DEFAULT ''", 'embedding_dimensions': 'INTEGER NOT NULL DEFAULT 768',
                     'vector_namespace': "TEXT NOT NULL DEFAULT ''"},
        'documents': {'filename': "TEXT NOT NULL DEFAULT ''", 'mime': "TEXT NOT NULL DEFAULT 'text/plain'", 'original': 'BLOB',
                      'units': "TEXT NOT NULL DEFAULT '[]'", 'status': "TEXT NOT NULL DEFAULT 'ready'",
                      'error': "TEXT NOT NULL DEFAULT ''", 'warning': "TEXT NOT NULL DEFAULT ''",
                      'indexed_signature': "TEXT NOT NULL DEFAULT 'keyword'", 'index_backend': "TEXT NOT NULL DEFAULT 'local'"}}
    for table, columns in additions.items():
        existing = {r['name'] for r in conn.execute(f'PRAGMA table_info({table})')}
        for name, ddl in columns.items():
            if name not in existing:
                conn.execute(f'ALTER TABLE {table} ADD COLUMN {name} {ddl}')
    conn.execute("UPDATE settings SET vector_namespace=? WHERE vector_namespace=''", (uuid.uuid4().hex,))
    conn.executescript('''CREATE TABLE IF NOT EXISTS passages (
        id TEXT PRIMARY KEY, doc_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        repo_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
        content TEXT NOT NULL, page INTEGER, label TEXT NOT NULL, vector TEXT);
        CREATE INDEX IF NOT EXISTS passages_doc ON passages(doc_id);
        CREATE INDEX IF NOT EXISTS passages_repo ON passages(repo_id);
        CREATE VIRTUAL TABLE IF NOT EXISTS passages_fts USING fts5(content, passage_id UNINDEXED);
        CREATE TRIGGER IF NOT EXISTS passages_delete AFTER DELETE ON passages BEGIN
          DELETE FROM passages_fts WHERE passage_id=old.id;
        END;
    ''')
    for doc in conn.execute("SELECT * FROM documents WHERE units='[]' AND content<>''").fetchall():
        units = [{'text': doc['content'], 'page': None, 'label': 'Text'}]
        conn.execute('UPDATE documents SET units=? WHERE id=?', (json.dumps(units), doc['id']))
        for chunk in chunk_units(units):
            conn.execute('INSERT INTO passages(id,doc_id,repo_id,content,page,label) VALUES(?,?,?,?,?,?)',
                         (chunk['id'], doc['id'], doc['repo_id'], chunk['content'], chunk['page'], chunk['label']))
            conn.execute('INSERT INTO passages_fts(content,passage_id) VALUES(?,?)', (chunk['content'], chunk['id']))
    conn.commit()


def register_knowledge(app, db, cipher, protected, allowed_repos, body, field, audit):
    lock = threading.RLock()
    with app.app_context():
        migrate(db())
        namespace = db().execute('SELECT vector_namespace FROM settings').fetchone()[0]
    pg_url = app.config.get('VECTOR_DATABASE_URL', os.environ.get('VECTOR_DATABASE_URL', ''))
    store = PgVectors(pg_url, namespace) if pg_url else None
    backend = 'postgres' if store else 'local'

    @app.errorhandler(KnowledgeError)
    def knowledge_error(error):
        return jsonify(error=str(error)), 400

    def settings():
        return db().execute('SELECT * FROM settings WHERE id=1').fetchone()

    def checked_source(sid):
        source = db().execute('''SELECT p.*, d.title, d.filename, d.mime FROM passages p
                                JOIN documents d ON d.id=p.doc_id WHERE p.id=?''', (sid,)).fetchone()
        if not source or source['repo_id'] not in [r['id'] for r in allowed_repos()]:
            abort(404)
        return source

    @app.get('/sources/<sid>')
    @protected()
    def source_page(sid):
        checked_source(sid)
        return send_from_directory('static', 'source.html')

    @app.get('/api/sources/<sid>')
    @protected()
    def source_info(sid):
        source = dict(checked_source(sid))
        source.pop('vector')
        source['file_url'] = f'/api/sources/{sid}/file'
        return jsonify(source)

    @app.get('/api/sources/<sid>/file')
    @protected()
    def source_file(sid):
        source = checked_source(sid)
        doc = db().execute('SELECT original,content FROM documents WHERE id=?', (source['doc_id'],)).fetchone()
        raw = doc['original'] or doc['content'].encode('utf-8')
        return send_file(io.BytesIO(raw), mimetype=source['mime'],
                         download_name=source['filename'] or 'document.txt', as_attachment=source['mime'] != 'application/pdf')

    @app.get('/api/admin/embedding-settings')
    @protected(admin=True)
    def get_embedding_settings():
        s = settings()
        return jsonify(base_url=s['embedding_url'], model=s['embedding_model'], dimensions=s['embedding_dimensions'],
                       has_api_key=bool(s['embedding_key']), backend=backend, enabled=bool(s['embedding_url']))

    @app.put('/api/admin/embedding-settings')
    @protected(admin=True)
    def save_embedding_settings():
        data = body()
        url = field(data, 'base_url', 1000).rstrip('/')
        model = field(data, 'model', 200)
        dimensions = data.get('dimensions', 768)
        if type(dimensions) is not int or not 1 <= dimensions <= 2000:
            abort(400, 'Dimensions must be an integer between 1 and 2000.')
        if url:
            parsed = urlparse(url)
            if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or not model:
                abort(400, 'Enter a valid embedding base URL and model identifier.')
        elif model:
            abort(400, 'Provide both embedding URL and model, or clear both for keyword mode.')
        secret = field(data, 'api_key', 4000)
        with lock:
            old = settings()
            encrypted = old['embedding_key']
            if secret:
                encrypted = cipher.encrypt(secret.encode()).decode()
            elif data.get('clear_api_key') is True:
                encrypted = ''
            candidate = dict(old)
            candidate.update(embedding_url=url, embedding_model=model, embedding_dimensions=dimensions, embedding_key=encrypted)
            if url:
                embeddings(candidate, cipher, ['Connection test'])
                if store:
                    try:
                        store.prepare(dimensions)
                    except Exception as error:
                        raise KnowledgeError('Cannot initialize pgvector. Check the database connection and extension permissions.') from error
            db().execute('UPDATE settings SET embedding_url=?,embedding_model=?,embedding_dimensions=?,embedding_key=? WHERE id=1',
                         (url, model, dimensions, encrypted))
            if signature(old) != signature(candidate):
                db().execute("UPDATE documents SET status='needs_reindex' WHERE status='ready'")
            audit('Updated and tested embedding settings')
            db().commit()
        return jsonify(ok=True)

    def index_document(did):
        # One process handles indexing/settings changes at a time. No long SQLite transaction during HTTP calls.
        with lock:
            doc = db().execute('SELECT * FROM documents WHERE id=?', (did,)).fetchone()
            if not doc:
                abort(404)
            db().execute("UPDATE documents SET status='processing',error='' WHERE id=?", (did,))
            db().commit()
            try:
                s = settings()
                chunks = chunk_units(json.loads(doc['units']))
                vectors = embeddings(s, cipher, [c['content'] for c in chunks]) if s['embedding_url'] else [None] * len(chunks)
                old_chunks = db().execute('SELECT id,content,page,label FROM passages WHERE doc_id=?', (did,)).fetchall()
                old_ids = [r['id'] for r in old_chunks]
                # Re-embedding unchanged text preserves citation URLs.
                previous = {}
                for row in old_chunks:
                    previous.setdefault((row['content'], row['page'], row['label']), []).append(row['id'])
                for chunk in chunks:
                    matches = previous.get((chunk['content'], chunk['page'], chunk['label']), [])
                    if matches:
                        chunk['id'] = matches.pop()
                retired_ids = list(set(old_ids) - {c['id'] for c in chunks})
                if store and s['embedding_url']:
                    store.put(s['embedding_dimensions'], doc['repo_id'], signature(s), chunks, vectors)
                if store:
                    store.delete(retired_ids)
                db().execute('DELETE FROM passages WHERE doc_id=?', (did,))
                db().execute('DELETE FROM chunks WHERE doc_id=?', (did,))
                for chunk, vector in zip(chunks, vectors):
                    db().execute('INSERT INTO passages(id,doc_id,repo_id,content,page,label,vector) VALUES(?,?,?,?,?,?,?)',
                        (chunk['id'], did, doc['repo_id'], chunk['content'], chunk['page'], chunk['label'], json.dumps(vector) if vector else None))
                    db().execute('INSERT INTO passages_fts(content,passage_id) VALUES(?,?)', (chunk['content'], chunk['id']))
                db().execute("UPDATE documents SET status='ready',indexed_signature=?,index_backend=?,error='' WHERE id=?", (signature(s), backend, did))
                audit('Indexed knowledge document')
                db().commit()
            except Exception as error:
                db().rollback()
                message = str(error) if isinstance(error, KnowledgeError) else 'Indexing failed. Check the vector database connection and retry.'
                db().execute("UPDATE documents SET status='failed',error=? WHERE id=?", (message, did))
                db().commit()
                return message
        return None

    @app.post('/api/admin/documents/<int:did>/reindex')
    @protected(admin=True)
    def reindex(did):
        error = index_document(did)
        return jsonify(id=did, status='failed' if error else 'ready', error=error), 422 if error else 200

    @app.post('/api/admin/documents/upload')
    @protected(admin=True)
    def upload():
        file = request.files.get('file')
        rid = request.form.get('repository_id', type=int)
        if not file or not file.filename:
            abort(400, 'Choose a document to upload.')
        if not db().execute('SELECT id FROM repositories WHERE id=?', (rid,)).fetchone():
            abort(400, 'Select a repository.')
        filename = file.filename.replace('\\', '/').split('/')[-1][:250]
        title = request.form.get('title', '').strip() or filename
        if len(title) > 250:
            abort(400, 'Title must be at most 250 characters.')
        raw = file.read(MAX_UPLOAD + 1)
        if len(raw) > MAX_UPLOAD:
            abort(413, 'Files are limited to 20 MB.')
        units, mime, warning = extract_document(filename, raw)
        with lock:
            did = db().execute('''INSERT INTO documents(repo_id,title,content,filename,mime,original,units,status,warning)
                VALUES(?,?,?,?,?,?,?,'processing',?)''',
                (rid, title, '\n\n'.join(u['text'] for u in units), filename, mime, raw, json.dumps(units), warning)).lastrowid
            db().commit()
            error = index_document(did)
        return jsonify(id=did, status='failed' if error else 'ready', error=error, warning=warning), 422 if error else 201

    def add_text():
        data = body()
        rid = data.get('repository_id')
        if type(rid) is not int or not db().execute('SELECT id FROM repositories WHERE id=?', (rid,)).fetchone():
            abort(400, 'Select a repository')
        title = field(data, 'title', 250, True)
        content = field(data, 'content', MAX_TEXT, True)
        units = [{'text': content, 'page': None, 'label': 'Text'}]
        with lock:
            did = db().execute("INSERT INTO documents(repo_id,title,content,units,status) VALUES(?,?,?,?,'processing')",
                               (rid, title, content, json.dumps(units))).lastrowid
            db().commit()
            error = index_document(did)
        return jsonify(id=did, status='failed' if error else 'ready', error=error), 422 if error else 201

    def remove_documents(where, value):
        # Call before deleting metadata. Failed remote cleanup leaves the document intact for retry.
        with lock:
            ids = [r[0] for r in db().execute(f'SELECT id FROM passages WHERE {where}=?', (value,))]
            if store:
                try:
                    store.delete(ids)
                except Exception as error:
                    raise KnowledgeError('Vector cleanup failed; document was not deleted. Check PostgreSQL and retry.') from error
            db().execute(f'DELETE FROM passages WHERE {where}=?', (value,))

    def retrieve(prompt, repo_ids):
        if not repo_ids:
            return []
        s = settings()
        sig = signature(s)
        marks = ','.join('?' for _ in repo_ids)
        sql = f'''SELECT p.*,d.title,d.filename,d.mime FROM passages p JOIN documents d ON d.id=p.doc_id
                  WHERE p.repo_id IN ({marks}) AND d.status='ready' AND d.indexed_signature=?'''
        params = [*repo_ids, sig]
        if s['embedding_url']:
            sql += ' AND d.index_backend=?'
            params.append(backend)
            # Do not call embeddings or search a missing pg table when no authorized documents are ready.
            exists = db().execute(sql.replace('SELECT p.*,d.title,d.filename,d.mime', 'SELECT 1') + ' LIMIT 1', params).fetchone()
            if not exists:
                return []
            vector = embeddings(s, cipher, [prompt])[0]
            if store:
                try:
                    ranking = store.search(s['embedding_dimensions'], sig, repo_ids, vector)
                except Exception as error:
                    raise KnowledgeError('Vector search failed. Check PostgreSQL connectivity.') from error
                ids = [sid for sid, score in ranking]
                if not ids:
                    return []
                candidates = ','.join('?' for _ in ids)
                rows = db().execute(sql + f' AND p.id IN ({candidates})', [*params, *ids]).fetchall()
                authorized = {r['id']: r for r in rows}
                rows = [authorized[sid] for sid in ids if sid in authorized][:5]
            else:
                rows = db().execute(sql, params).fetchall()
                rows = sorted(rows, key=lambda row: sum(a*b for a, b in zip(vector, json.loads(row['vector']))), reverse=True)[:5]
        else:
            terms = list(dict.fromkeys(re.findall(r'\w{3,}', prompt)))[:25]
            if not terms:
                return []
            query = ' OR '.join('"' + term + '"' for term in terms)
            sql = sql.replace('FROM passages p', 'FROM passages_fts JOIN passages p ON p.id=passages_fts.passage_id')
            rows = db().execute(sql + ' AND passages_fts MATCH ? ORDER BY rank LIMIT 5', [*params, query]).fetchall()
        return [{'source_id': r['id'], 'document_id': r['doc_id'], 'title': r['title'], 'content': r['content'],
                 'page': r['page'], 'label': r['label'], 'filename': r['filename'],
                 'url': f'/sources/{r["id"]}'} for r in rows]

    def document_list():
        s = settings()
        docs = [dict(r) for r in db().execute('''SELECT id,repo_id,title,length(content) AS size,filename,mime,status,error,warning,
                      indexed_signature,index_backend FROM documents''')]
        for doc in docs:
            if doc['status'] == 'ready' and (doc['indexed_signature'] != signature(s) or
                                           (s['embedding_url'] and doc['index_backend'] != backend)):
                doc['status'] = 'needs_reindex'
        return docs

    return {'retrieve': retrieve, 'add_text': add_text, 'remove_documents': remove_documents,
            'documents': document_list, 'lock': lock}

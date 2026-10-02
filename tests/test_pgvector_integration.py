"""Opt-in test against an isolated PostgreSQL database with pgvector installed."""
import os
import uuid

import pytest

from knowledge import PgVectors


def test_live_pgvector_hnsw_and_namespace_filter():
    url = os.environ.get('TEST_VECTOR_DATABASE_URL')
    if not url:
        pytest.skip('TEST_VECTOR_DATABASE_URL is not configured; live pgvector not verified')
    namespace = 'test-' + uuid.uuid4().hex
    store = PgVectors(url, namespace)
    ids = [uuid.uuid4().hex for _ in range(3)]
    try:
        store.put(3, 101, 'test-model', [{'id': ids[0]}, {'id': ids[1]}], [[1., 0., 0.], [0., 1., 0.]])
        store.put(3, 102, 'test-model', [{'id': ids[2]}], [[1., 0., 0.]])
        results = store.search(3, 'test-model', [101], [1., 0., 0.])
        assert results[0][0] == ids[0]
        assert ids[2] not in [row[0] for row in results]
        assert store.search(3, 'different-model', [101], [1., 0., 0.]) == []
        assert PgVectors(url, namespace + '-other').search(3, 'test-model', [101], [1., 0., 0.]) == []
        store.delete([ids[0]])
        assert ids[0] not in [row[0] for row in store.search(3, 'test-model', [101], [1., 0., 0.])]
    finally:
        store.delete(ids)

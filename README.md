# Raazi

A compact, self-hosted enterprise AI workspace. Flask, SQLite for workspace metadata, optional PostgreSQL for history/vectors, and a dependency-free browser interface. Git starts on `dev`.

## Run locally (PowerShell)

```powershell
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.lock.txt
./start-dev.ps1
```

Open http://127.0.0.1:8080 and choose **Enter development workspace**. The development login explicitly grants local administrator access. The server binds to loopback. Never expose development mode through a proxy or on a shared network.

In **Admin console → Models & settings**, enter your server's API base URL (for example `http://localhost:11434/v1`), exact model identifier, and optional API key. The backend calls `/chat/completions`. No OpenAI cloud subscription or key is needed. HTTP is supported for trusted local networks; use HTTPS for network traffic carrying confidential data.

## What works

- Private, persisted conversations with groups, pinning, renaming, search, recency ordering, and per-user access checks.
- A compact navigation rail and expandable history sidebar, with mobile history drawer.
- PostgreSQL chat/message/group storage in the same container as pgvector, with a one-time import of existing SQLite history.
- Administrator-configured OpenAI-compatible chat and embedding endpoints, separate encrypted credentials, and system instructions.
- Enterprise sign-in using OIDC authorization code flow with PKCE through AD FS or Entra ID.
- First-login account provisioning; administrator role derived from an exact configured group claim.
- Names, email, department, and job title populated from signed identity claims. Admin-maintained enterprise context is included in model requests.
- Knowledge repositories with exact AD-group restrictions; unrestricted repositories are shared with all authenticated users.
- PDF, DOCX, text and Markdown ingestion with page/section metadata, overlapping chunks, semantic vector retrieval, keyword mode, and clickable source citations.
- User disabling, administrative activity history, CSRF checks, secure-cookie defaults, and browser security headers.

## Enterprise identity setup

Register Raazi as a confidential web application in your AD-backed identity provider. Configure the exact HTTPS callback URI, OIDC discovery endpoint, client ID, and client secret. See `.env.example` for environment-variable names; it is a reference, not an automatically loaded dotenv file.

Set these environment variables in your service host:

- `AUTH_MODE=oidc` (default).
- `SECRET_KEY`: a stable random session signing secret of at least 32 bytes.
- `ENCRYPTION_KEY`: a stable Fernet key generated with `.venv/Scripts/python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`.
- `OIDC_DISCOVERY_URL`: your tenant/provider-specific HTTPS discovery URL.
- `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URI`.
- `ADMIN_GROUP`: the exact group ID/value emitted for administrators.
- `COOKIE_SECURE=true` (default).
- Optional `DATABASE` (defaults to `data/raazi.db`) and `PORT` (defaults to 8080).

Run `.venv/Scripts/python app.py` behind a TLS reverse proxy on the same host. The redirect URI is explicit, so forwarded headers are not trusted. Configure claims `groups` (array of exact IDs), `department`, and `job_title` as needed. Entra's ordinary ID token may not include department/job title without additional configuration. Group-overage tokens are not expanded through Graph: omitted groups grant no restricted access and no admin role. Role and group membership refresh on sign-in; sessions expire after eight hours. Disabling an account in Raazi takes effect immediately on subsequent requests. Logout clears the Raazi session, not the identity provider's SSO session.

Direct LDAP credential binding and IIS integrated Windows authentication are not implemented. The current default is AD-backed OIDC; confirm your environment before production integration.

## Chat history and groups

The left sidebar has **Pinned**, expandable **Groups**, and ungrouped history organized by recency. Search filters titles within pinned chats, groups, and history. Use the plus button beside Groups to create a folder; a chat's ellipsis menu lets you rename it, pin it, or move it to a group. Group options offer rename, **New chat in group**, and delete. Deleting a group moves its chats back to History and preserves their messages. Groups organize only your own chats; they do not grant access to knowledge repositories or other users' conversations. Folder collapse state is saved in the active database. Group ordering currently follows creation order; drag-and-drop is not implemented.

When `VECTOR_DATABASE_URL` is set, chat storage automatically uses the same PostgreSQL database. Set `CHAT_DATABASE_URL` explicitly only if you need a different connection; setting it to an empty string forces local history for development. PostgreSQL preparation creates ordinary tables prefixed `raazi_chat_` alongside the pgvector tables. No extension is needed for chat rows.

On the first PostgreSQL startup for a workspace, existing SQLite groups, conversations, messages, and source snapshots are imported in a single transaction. A persistent import marker prevents duplicates and prevents later restarts from resurrecting deleted chats. The original SQLite records remain as a backup snapshot and are no longer updated once PostgreSQL history is active. Stop the previous app process and back up SQLite before switching. Do not switch back to SQLite as an outage fallback: it contains the old snapshot, not newer PostgreSQL history. Further SQLite changes made after the one-time import are not imported automatically. Keep `DATABASE` and its persistent workspace namespace stable across restarts, and back up both databases.

A configured PostgreSQL outage returns a storage-unavailable error; Raazi never silently writes new chats to SQLite. PostgreSQL startup fails with a clear configuration error if its chat tables cannot be prepared. The PostgreSQL account needs privileges to create the chat tables, indexes, and sequences, or these must be provisioned by a DBA.

## Knowledge workspace workflow

1. In **Admin console → Models & settings**, configure your chat model.
2. In the **Embedding model** card, enter the local embedding server's base URL, model ID, optional credential, and actual output dimensions. Saving runs a test embedding and validates the response. The endpoint must implement `/embeddings` with OpenAI-compatible `input` and indexed `data` responses. Dimensions describe the model output; they are not a request to truncate it. Supported dimensions: 1–2,000.
3. In **Knowledge**, create repositories and set exact AD group IDs. Empty groups mean all signed-in users; administrators can access everything.
4. Upload PDF, DOCX, UTF-8 TXT or Markdown, or paste text. Maximum upload: 20 MB; extracted text: 500,000 characters; PDF: 500 pages; DOCX expanded archive: 50 MB. Scanned PDF pages need OCR upstream. Mixed PDFs report how many pages had no extractable text. DOCX extracts body paragraphs and tables; headers, footers, text boxes, and images are not indexed.
5. Uploads progress through `processing` to `ready` or `failed`. Failed embedding/index requests retain extracted content for **Retry**. Format/extraction errors reject the upload before creating a document. Indexing is synchronous in this version; the browser shows Processing while the request runs. **Refresh status** reads the persisted state. Keep one application process (Waitress can use threads); a process-local lock serializes ingestion, embedding settings changes, and deletion. There is no durable background job queue yet. After an interrupted request, use Reindex to recover.
6. Chat embeds the question and retrieves up to five passages from authorized, ready repositories. Without embedding settings, it uses FTS5 keyword ranking. There is no silent fallback on embedding service errors. Changing embedding endpoint/model/dimensions marks documents `needs_reindex`; stale vectors are excluded until **Reindex** succeeds. Changing vector backend also requires reindexing. API-key-only changes preserve valid vectors.
7. Citations such as **[1]** open an authenticated source page with the exact excerpt. For PDFs, **Open PDF at page N** opens the original with a `#page=N` fragment. Page numbers mean physical PDF pages, not printed page labels. DOCX cites section/paragraph/table locations because pagination depends on rendering. Text is cited as text. Reindexing unchanged passages preserves citation links. Deleted/changed sources return unavailable. Pre-upgrade historical source snapshots have no source URLs.

Original uploads are stored in the local SQLite database with extracted text and metadata; they are never served from a public upload directory. Source previews and original downloads recheck current repository permissions, even if someone knows the source URL. Model answers and excerpts are HTML-escaped; only references to supplied source IDs become links. Citations point to retrieved evidence and do not guarantee that the model's claim is supported.

Existing databases are migrated additively on startup. Old text documents become page-neutral passages without contacting an embedding server. After enabling embeddings, reindex them from the admin panel. Back up your database before upgrading.

## PostgreSQL / pgvector

**A PostgreSQL container with pgvector is sufficient for vector search; no separate vector-database product is required.** Plain PostgreSQL does not include pgvector automatically. `compose.yaml` uses the versioned `pgvector/pgvector:0.8.6-pg17` image, a persistent volume, health checks, and a localhost-only port.

When configured, PostgreSQL stores the **vector index and private chat history, messages, groups, pin states, and folder collapse states**. Users, document binaries, repository ACLs, model settings, and source metadata remain in SQLite. SQLite authenticates users and authorizes knowledge access; every PostgreSQL vector result is checked against current ready/authorized passages before it reaches the model. Chat tables separately enforce workspace namespaces and user ownership. Knowledge text is not copied into vector tables; generated answers and source excerpt snapshots are stored in chat message rows.

To enable PostgreSQL, start Docker Desktop and use PowerShell:

```powershell
# Supply a strong password through your deployment secret mechanism.
# Set POSTGRES_PASSWORD in the environment or ignored .env (Compose reads it).
docker compose up -d vectors
docker compose ps
# Set VECTOR_DATABASE_URL in the application environment:
# postgresql://raazi:<URL-encoded-password>@127.0.0.1:5432/raazi_vectors
./start-dev.ps1
```

`.env` is read by Docker Compose, not automatically by the Flask app. The application needs `VECTOR_DATABASE_URL` in its own process environment. Chat storage defaults to that same connection. You may set `CHAT_DATABASE_URL` to override the history connection separately. Do not put a real password in Git. The PostgreSQL role must be able to create the vector extension, tables and indexes; for hardened deployment, have a DBA pre-provision these and constrain privileges.

On the first embedding-settings save, Raazi prepares a dimension-specific vector table and cosine HNSW index. Each SQLite database has a persistent namespace to isolate its vectors. Queries filter namespace, model fingerprint and allowed repository IDs; pgvector iterative scanning helps filtered approximate search. HNSW is approximate: measure recall/latency on your own data before tuning. Changing dimensions creates a separate table. Unused empty dimension tables can be retained or removed by a DBA.

Without `VECTOR_DATABASE_URL`, development stores vectors in SQLite and performs exact cosine search in Python. This needs no extra container and is suitable for small workspaces; use pgvector as the corpus grows. A backend switch requires restarting Raazi and reindexing documents.

There is no distributed transaction between SQLite and PostgreSQL. Indexing publishes ready metadata only after vectors are written; failed documents are excluded from retrieval. A process crash can leave orphaned vectors, which cannot pass the metadata/ACL check but may require administrative cleanup. Deletion removes active vector rows before committing metadata removal; PostgreSQL failure leaves the document intact for retry. Back up both stores. Removing documents or changing permissions does not erase already generated answers and excerpt snapshots from existing conversations; original-file links still recheck current access.

Enterprise profile context is currently supplied by identity claims plus admin-maintained text. Automated HR/ERP/SharePoint sync, custom business workflow execution, and external data connectors require your source schemas, permissions, and workflow rules and are not implemented yet.

## Operations and limitations

This is an MVP foundation, not Open WebUI feature parity. Streaming, multiple chat-model routing, OCR, legacy .doc parsing, repository editing, password/LDAP login, quotas, enterprise audit export, a full PostgreSQL metadata migration, and durable job queues are not included. Chat renders model output as plain text to prevent HTML injection.

SQLite keeps users, settings, documents, repository permissions, and audit entries in the configured database. In local mode it also keeps chat history; when configured, PostgreSQL keeps active chat history and groups. Back up that file consistently and preserve `ENCRYPTION_KEY` separately; losing the key makes saved model credentials unreadable. Protect the data directory with OS permissions and disk encryption: only model API credentials are encrypted at the application layer. Development generates an ignored `data/encryption.key` automatically. Production requires explicit secrets.

Only trusted administrators should configure model URLs: internal network endpoints are intentionally allowed for local inference. Restrict backend egress to approved inference hosts in deployment. Put rate limiting and request concurrency controls at your reverse proxy. Model requests are synchronous with a 120-second read timeout. Review context budgets for your selected model. No hosted deployment or remote Git repository is created.

## Verification

```powershell
.venv/Scripts/python -m pytest -q
node --check static/app.js
```

Tests use temporary SQLite databases and mocked inference responses. They cover authentication/CSRF, admin permissions, conversation isolation, encrypted credentials, real PDF/DOCX extraction, semantic ranking, page citations, source permissions, vector validation, retry/reindex, legacy migration, and PostgreSQL query scoping.

Optional live PostgreSQL integration tests (use an isolated test database with pgvector): set `TEST_VECTOR_DATABASE_URL` and run `.venv/Scripts/python -m pytest tests/test_pgvector_integration.py tests/test_chat_postgres_integration.py -q`. Without that variable they are explicitly skipped. The history test checks transactional import, grouping, ownership, namespace isolation, persistence, and deleted-chat import behavior.

Optional browser workflow test: install `requirements-dev.txt`, then run `.venv/Scripts/python tests/browser_smoke.py`. It uses a temporary database, a mocked model endpoint, and installed Microsoft Edge in headless mode. It verifies knowledge ingestion/citations plus chat creation, grouping, pinning, search, reload persistence, and the mobile sidebar; screenshots go to ignored `data/browser-smoke/`. It does not change your real workspace data.

Validate live enterprise sign-in and your actual chat/embedding model before rollout.

Protocol references: [Microsoft OIDC](https://learn.microsoft.com/en-us/entra/identity-platform/v2-protocols-oidc) and [vLLM OpenAI-compatible server](https://docs.vllm.ai/en/latest/serving/online_serving/openai_compatible_server/).

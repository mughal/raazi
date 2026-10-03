# Raazi

Raazi is a compact enterprise AI workspace built in **TypeScript**: React for the interface and Node.js/Express for the API. It uses administrator-configured local chat and embedding models through OpenAI-compatible endpoints. No Python runtime is required.

## Run locally

Install Node.js 22.12 or newer, then run these commands in PowerShell:

```powershell
npm ci
./start-dev.ps1
```

Open http://127.0.0.1:8080 and select **Continue as local administrator**. Development mode grants local admin access and binds to loopback.

For React and backend development with automatic reload, run `./start-dev.ps1 -Watch` and open http://127.0.0.1:5173. Vite proxies API/authentication requests to port 8080.

In **Administration → Models**, configure the local chat endpoint's base URL, model identifier, optional key, and system prompt. The server calls `/chat/completions` with `stream: false`. No OpenAI cloud subscription is needed.

## Features and structure

- React interface with a navigation rail, left-hand history, pinned chats, title search, folders, recency sections, and mobile drawer.
- Private persisted chats, rename/pin/move/delete controls, saved folder collapse state, and drafts retained while navigating.
- PostgreSQL chat storage alongside pgvector, with a one-time transactional import of SQLite history.
- AD-backed OIDC sign-in with authorization code flow, PKCE, state, nonce, and verified signed identity claims.
- Enterprise profiles from identity claims plus administrator-maintained context.
- Group-restricted knowledge repositories, PDF/DOCX/TXT/Markdown ingestion, semantic vectors, keyword mode, retry/reindex, and clickable citations.
- Administrator settings, encrypted model credentials, user disabling, audit history, CSRF checks, HTTP-only cookies, and browser security headers.

| Directory   | Purpose                                                                                  |
| ----------- | ---------------------------------------------------------------------------------------- |
| `client/`   | React components, API client, styles                                                     |
| `server/`   | Express API, authentication, migrations, chat storage, ingestion, retrieval, backup      |
| `shared/`   | Shared interface and API types                                                           |
| `tests-ts/` | Vitest tests, real document fixtures, PostgreSQL integration tests, Playwright workflows |
| `dist/`     | Generated server/browser build, ignored by Git                                           |

`npm run build` compiles and checks TypeScript. `npm start` serves the compiled React application and API. Run it from the repository root because the server reads `server/schema.sql` there. Start and backend watch commands load an ignored `.env` file if it exists; process environment values take precedence.

## Conversion and existing data

The conversion retains the SQLite schema, profiles, documents, source IDs, PostgreSQL chat tables, pgvector tables, workspace namespace, and embedding fingerprints. Keep the existing `DATABASE` and encryption key. The server reads legacy Fernet credentials with the original key and writes new credentials using AES-256-GCM. Saved model keys do not need to be re-entered. Browser cookies changed, so users must sign in again. The Python implementation remains in Git history.

Before upgrading, stop the old application and run:

```powershell
npm run backup
```

This uses SQLite's online backup API and copies the local encryption key into a timestamped `data/backups/` directory. Preserve an externally supplied `ENCRYPTION_KEY` through your secret-management system. Back up PostgreSQL separately. Rollback requires the matching pre-upgrade backup because newly saved credentials use the new encryption format.

## Enterprise identity

Register a confidential OIDC web application in AD FS or Entra ID with an explicit HTTPS callback. Configure these environment values; `.env.example` lists them:

- `AUTH_MODE=oidc` — default.
- `SECRET_KEY` — stable random signing secret of at least 32 characters.
- `ENCRYPTION_KEY` — stable base64-encoded 32-byte encryption key.
- `OIDC_DISCOVERY_URL` — provider's HTTPS discovery URL.
- `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URI`.
- `ADMIN_GROUP` — exact identity-provider group ID granting administration.
- `COOKIE_SECURE=true` — default.
- Optional `DATABASE`, `PORT`, `HOST`; defaults are `data/raazi.db`, 8080, and `127.0.0.1`.

Generate each secret separately:

```powershell
node -e 'console.log(require("node:crypto").randomBytes(32).toString("base64url"))'
```

Run `npm run build` then `npm start` behind an HTTPS reverse proxy. Forwarded headers are not trusted. Keep development authentication local.

Identity claims supply name/email, `groups` as exact IDs, and optionally `department` and `job_title`. Configure provider claims accordingly. Group-overage claims are not expanded through Graph; absent groups grant no restricted/admin access. Membership refreshes at sign-in; sessions expire after eight hours. Disabling an account takes effect on subsequent requests. Logout ends the Raazi session, not provider SSO.

Direct LDAP binding and IIS integrated Windows authentication are not implemented. Automated enterprise-data/profile synchronization and workflow execution require your source schemas, permissions, and integration rules.

## Chats and knowledge

Use **New chat**, the plus beside **Folders**, and chat/folder ellipsis menus. Deleting a folder preserves its chats and messages in ungrouped history. Folders organize only the current user's chats and do not grant knowledge permissions. History follows recent activity. Drafts survive interface navigation but not reload. Folder order follows creation; drag-and-drop is not implemented.

1. Configure the chat model in **Administration → Models**.
2. In **Embeddings**, enable semantic search and provide the endpoint, model, optional key, and actual dimensions (1–2,000). Saving tests `/embeddings` and validates response indices, dimensions, finite values, and nonzero vectors. Dimensions do not request truncation.
3. In **Knowledge**, create repositories with exact allowed AD group IDs. Empty groups share with all signed-in users; admins can access all repositories.
4. Upload PDF, DOCX, UTF-8 TXT, or Markdown, or use **Add text directly**. Limits: 20 MB upload, 500,000 extracted characters, 500 PDF pages, and 50 MB declared expanded DOCX archive.
5. Synchronous processing finishes as `ready` or `failed`. Index errors retain extracted content for **Retry**. Format errors reject the upload before creating a document. Interrupted indexing becomes failed on startup. Use **Refresh status** and **Reindex** as needed.
6. Questions retrieve up to five authorized, ready passages. Disabled embeddings use SQLite FTS5 keyword ranking. Service errors do not silently change search mode.
7. **[1]** citations open the exact source excerpt. PDF originals use `#page=N` physical page numbers. DOCX cites headings/paragraphs/tables without inventing pages.

Scanned PDFs require upstream OCR; mixed PDFs report unextractable pages. DOCX body paragraphs and tables are indexed; images, headers, footers, and text boxes are not. Model output renders as plain text with safe source links.

Changing the embedding endpoint/model/dimensions or vector backend requires reindexing. Key-only changes retain valid vectors. Reindexing unchanged passages preserves citation IDs. Deleted sources become unavailable; early messages without IDs cannot acquire links retroactively.

Original uploads, source metadata, and extracted text remain in SQLite, outside public static directories. Previews/downloads recheck repository permissions. Existing private chat answers and source snapshots remain after document deletion, while original links enforce current access.

## PostgreSQL with pgvector

**One PostgreSQL container with pgvector is sufficient; a separate vector database is not required.** `compose.yaml` uses `pgvector/pgvector:0.8.6-pg17` with a persistent volume, health check, and localhost-only port.

```powershell
# Supply POSTGRES_PASSWORD via your environment or ignored .env.
docker compose up -d vectors
docker compose ps
# Set VECTOR_DATABASE_URL in the app environment or .env:
# postgresql://raazi:<URL-encoded-password>@127.0.0.1:5432/raazi_vectors
./start-dev.ps1
```

`VECTOR_DATABASE_URL` enables vectors and chat history in that database. `CHAT_DATABASE_URL` overrides history separately; an explicitly empty value keeps local development history. PostgreSQL stores chats, messages, folders, pins, collapse state, and semantic vectors. Users, settings, permissions, audit entries, document binaries, and source metadata remain in SQLite. A full PostgreSQL metadata migration is outside this conversion.

Chat tables retain their `raazi_chat_` names. The first PostgreSQL startup imports SQLite chats/groups/messages atomically. An import marker prevents duplicates or revival of deleted chats. Retained SQLite history is a stale backup snapshot, not failover storage. Keep the file and its persistent namespace stable. Configured outages fail visibly; new chats never silently fall back to SQLite.

Vector tables retain `raazi_vectors_<dimensions>` names and cosine HNSW indexes. Queries filter namespace, model fingerprint, and authorized repositories, then recheck current SQLite metadata. Filtered searches use pgvector iterative scanning. Without PostgreSQL, Node performs exact cosine search over local SQLite vectors.

The role needs table/index/extension privileges, or a DBA must provision them. SQLite/PostgreSQL do not share a distributed transaction: ready metadata publishes after vector writes; crash-orphaned vectors cannot pass metadata checks. Deletion removes vectors before metadata so an outage leaves documents available for retry. Back up both stores.

## Operations and verification

Run one Node application process. A local mutex serializes ingestion, reindexing, embedding configuration, and deletion. Distributed locks and a durable job queue are not implemented.

Current limits include no streaming, multi-model routing, OCR, legacy `.doc`, repository editing, quotas, enterprise audit export, automated connectors, or full PostgreSQL metadata migration. Protect data and backups with OS permissions and disk encryption; only model API credentials are encrypted at the application layer. Model calls time out after 120 seconds. Configure deployment rate/concurrency limits and approved inference-network access.

```powershell
npm run build
npm test
npm run test:browser
npm audit
npm run format:check
```

Vitest uses temporary databases and mocked inference. It tests access controls, CSRF, legacy/encrypted keys, chat ownership/grouping, deletion during inference, migration, real PDF/DOCX extraction, citations, vector validation, and retry/reindex. OIDC uses locally signed tokens and mocked provider HTTP responses.

Playwright uses installed Microsoft Edge, an isolated temporary database, and mock inference. It checks React settings, uploads, citations, folders/pins/search, navigation drafts, persistence, and mobile history. Screenshots go to ignored `data/react-workspace.png` and `data/react-mobile.png`. Tests do not change real workspace data.

For the two optional live PostgreSQL tests, set `RAAZI_TEST_DATABASE_URL` to an isolated test database with pgvector and run `npm test`. Without it, those tests explicitly skip. Validate your live identity provider and actual inference endpoints before rollout.

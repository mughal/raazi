# Development handoff

Updated: 6 October 2026. This file is the starting point for work on another PC.

## Current project

- Product: **Raazi**, now with SNGPL branding.
- Repository: https://github.com/mughal/raazi.git
- Working branch: `dev`.
- Current PC checkout: `D:\Old-F\sngpl\rnd\raazi`.
- Planned Linux checkout: `/opt/rnd/raazi`, using Podman in the existing Aigate context.
- Fixed `podnet10` QA addresses: Raazi `192.168.10.40`, PostgreSQL `192.168.10.41`. Add `RAAZI_APP_IP` and `RAAZI_POSTGRES_IP` to an existing `.env.qa`; init preserves existing files. Confirm no other container configuration reserves them before starting.
- Tracked deployment templates: `env.sample.qa` and `env.sample.prod`. Copy to ignored `.env.qa` or `.env.prod`. The supplied systemd unit uses `.env.qa`.
- Linux controller: `bash raazictl [--env qa|prod] init|update|prepare|start|status|stop|restart|logs`. Only `prepare` builds/downloads images. Update fast-forwards the current upstream; service controls use existing images. Shell contract checks run with `bash tests-shell/raazictl.test.sh`.

- Stack: React, TypeScript, Node.js, Express, SQLite, optional PostgreSQL/pgvector, S3-compatible storage.
- Feature baseline before this branding/documentation change: `f80ea86`.
- Local preview: http://127.0.0.1:8080. A running preview is not transferred through Git.

Use the latest `origin/dev` commit. The architecture and guides are committed with the code. Do not rely on the chat transcript to reconstruct decisions.

The Linux host successfully prepared the PostgreSQL/pgvector image and built `localhost/raazi:local` after the HTTPS source fix. Initial startup then failed during Compose parsing with `missing networks: default`. Unlike Aigate's fully declared shared-network setup, Raazi referenced the application network without a top-level declaration. The Podman overlay now explicitly declares `default` as a bridge. The corrected files passed the actual podman-compose 1.6.0 dry-run config parser with fixture values on this PC. This Compose-only correction needs no image rebuild. Retry startup after updating the code.

Controller contract checks passed with mocked Git and Podman on Windows Git Bash. They cover preflight failures before restart, no implicit build/pull, volume-preserving teardown, clean fast-forward updates, environment selection, and operational values read without shell execution. The symlink check skipped because Git Bash created a copy instead of a real link. Actual Podman provider behavior and the Linux symlink still need host verification.

## What has been built

Admin Sessions adds persistent SQLite login records for development, Portal, and OIDC. Admins can view activity and end one session or all sessions for a user, with audited CSRF-protected actions. Browser session checks occur every 30 seconds without counting as activity. Revocation is enforced on subsequent requests and before saving chat inference. Pre-upgrade cookies require one new sign-in because they lack a registered session ID. Restart preserves new session records. No image or dependency changes are needed; update mounted code and restart. Live AD/Portal behavior still requires Linux verification.

Session verification: the TypeScript/Vite build and all 11 Edge workflows passed, including ending another browser session and ending the administrator's own sessions. API fixtures cover admin/CSRF access, individual and bulk revocation, expiry, legacy cookie rejection, restart persistence, logout replay, and rejection of an in-flight revoked chat save. Live PostgreSQL checks remain skipped without a disposable URL; session records use the retained SQLite metadata volume.

The Thoughts disclosure remains closed until clicked. The reasoning parser now handles a standalone closing `</think>` delimiter without a generated opening tag, as can occur with template-prefilled reasoning. The Edge fixture uses this format to verify hidden thoughts, answer-only copy, and history reload. Fenced code examples containing closing tags remain intact. Unmarked reasoning still requires the inference server's reasoning parser.

PostgreSQL storage is now explicitly external: `raazi-qa_postgres_data` for QA, or `${COMPOSE_PROJECT_NAME}_postgres_data` for another project. This keeps the prior named volume identity. Normal restarts already preserved it; external ownership also excludes it from Compose volume deletion. Missing external storage blocks restart before teardown. `prepare volumes` creates storage explicitly for a new installation and refuses to replace storage for an existing database container. Verify the live database mount name before applying the change. No image rebuild or data migration is needed when the existing name matches.

Linux restart exposed a preflight bug: `compose run app` inherited `192.168.10.40`, already held by the running app. The check now uses a networkless Podman helper with read-only checkout/dependencies and no credentials. No image rebuild is needed for this controller/Compose correction. Shell regression checks reject Compose-based preflight and cover restart while the app is running. The actual corrected restart still needs Linux verification.

The 6 October deployment correction follows Sheetmagic's mounted-code pattern. `Dockerfile` prepares a reusable Node runtime with Linux dependencies and native build tools. Compose mounts the checkout read-only and uses separate modules/output/npm-cache volumes. `update` plus `restart` compiles current code without image rebuilds or package downloads. A changed manifest or lock file fails restart before teardown; stop, `prepare deps`, then start. Existing baked-code installations need `prepare app` once. Base-image pulls use `--pull=missing`. Existing SQLite and PostgreSQL volume names, keys, and namespaces are unchanged. The controller and runtime shell contracts pass with mocked tools; actual image creation, volume seeding, SELinux mounts, and mounted startup still require Linux verification.

The 6 October change adds model display names, per-model thinking controls, a composer Thinking switch, and collapsed reasoning on replies. Read the thinking setup in [ADMIN_GUIDE.md](ADMIN_GUIDE.md). Existing model IDs, credentials, namespace, and history remain intact. History adds a separate reasoning column in both stores. Reasoning is excluded from answer copy and subsequent model context. Live inference and the PostgreSQL migration still require target-host checks.

The Linux host now reports both Raazi and PostgreSQL healthy. The user also verified HTTPS `/api/session` through the `raaziqa.sngpl.com.pk` Nginx route with `curl --resolve`, before DNS registration. This confirms the route and TLS connection; it does not verify Portal sign-in, inference, or S3.

Verification for the thinking and display-name change: TypeScript/Vite build passed; 53 application tests passed. Three live PostgreSQL checks skipped without a disposable URL. All nine existing Edge workflows passed. The new thinking/display-name workflow passed on its focused rerun after an accessible-label correction. It covers generation on/off, separate reasoning, answer copy, history reload, default-model naming, provider naming, and unsupported-model switch state. Changed files pass formatting and diff whitespace checks. No live inference or PostgreSQL migration was performed on this PC. After committing and pushing, ordinary Linux code updates need `bash raazictl update` and `bash raazictl restart`. The reusable-runtime migration below requires one initial `prepare app`.

| Area                   | Completed work                                                                                              |
| ---------------------- | ----------------------------------------------------------------------------------------------------------- |
| Application            | Python/Flask replaced with React and TypeScript/Node                                                        |
| Identity               | Development admin login and AD-backed OIDC support                                                          |
| Knowledge              | Repository permissions, PDF/DOCX/TXT/Markdown ingestion, keyword search, embeddings, vector index           |
| Citations              | Clickable source excerpts, physical PDF pages, original-file access                                         |
| Storage                | S3-compatible configuration, original-file storage, bucket access/write/read/delete test                    |
| Private files          | Chat uploads, file status/reindex, private document retrieval, vision-model image messages                  |
| History                | Private saved chats, folders, pinning, search, SQLite or PostgreSQL persistence                             |
| Responses              | Safe Markdown, tables, code blocks, answer/code copy, question edit and resend                              |
| Composer               | Fixed bottom position, independent message scroll, light shades, Compact/Comfortable/Spacious sizes         |
| Preferences            | Six accent palettes, five composer shades, three sizes; saved per user                                      |
| Providers              | Multiple engines, model discovery, explicit approved models, user model selection                           |
| Decisions              | Jev API adapter, local JSON adapter, composer switch, confidence threshold, direct/knowledge/clarify routes |
| Demo                   | Long sample replies in local development when no chat model exists                                          |
| Branding               | Bundled SNGPL logo on login, sidebar, welcome, and favicon                                                  |
| Production preparation | Dockerfile, pgvector Compose, TLS proxy example, deployment and backup guides                               |

Useful implementation commits:

| Commit    | Change                                          |
| --------- | ----------------------------------------------- |
| `dd0c827` | React and TypeScript conversion                 |
| `a94aa39` | Private uploads and S3-compatible storage       |
| `e977c6d` | Production guidance and accent palettes         |
| `aadd135` | Markdown, copy, question edit/resend            |
| `7486e83` | Light composer shades                           |
| `3e1ec3a` | Fixed composer and local demo                   |
| `5740e51` | Compact composer and saved sizes                |
| `f80ea86` | Provider catalog and Jev/local decision routing |

## Resume on another Windows PC

Install Git, Node.js 22.12 or later, and Microsoft Edge for browser tests. Use a supported Node 22 release for consistent native dependencies. Docker Desktop is optional for local PostgreSQL.

For a new checkout:

```powershell
git clone --branch dev https://github.com/mughal/raazi.git
cd raazi
git status --short --branch
git log -1 --oneline
npm ci
./start-dev.ps1
```

Open http://127.0.0.1:8080. Select **Continue as local administrator**. Keep development mode local.

For an existing clean checkout:

```powershell
git switch dev
git pull --ff-only origin dev
npm ci
./start-dev.ps1
```

Preserve local changes before pulling. Do not discard them to force a clean checkout.

Run `./start-dev.ps1 -Watch` for automatic reload. Open http://127.0.0.1:5173 in that mode. Run all commands from the repository root.

## Transfer existing settings and data

Git carries source code, the logo, package lock, examples, tests, and documents. It does **not** carry `.env`, `data/`, credentials, local databases, S3 objects, Docker volumes, screenshots, `node_modules/`, or `dist/`.

For the same workspace on the next PC:

1. On the current PC, run `npm run backup`. It creates a dated folder beneath `data/backups/`.
2. Transfer the backed-up `raazi.db` and its matching `encryption.key` through your approved private transfer method.
3. Stop the target application before restoring. Back up any existing target workspace first.
4. Restore the database as `data/raazi.db` and key as `data/encryption.key`, unless your configured paths differ.
5. Transfer any required ignored `.env` privately. Preserve externally supplied `ENCRYPTION_KEY` and the signing `SECRET_KEY`.
6. If PostgreSQL is used, preserve or restore its data and the original SQLite workspace namespace. Update connection URLs for the new PC.
7. Keep access to every referenced S3 bucket/object version. Update network connectivity, not stored object identity.
8. Start the app. Check provider settings, a saved chat, a private file, and a source citation.

A SQLite backup does not include PostgreSQL or S3. Named Docker volumes do not follow a Git clone. Do not copy a live SQLite database file manually; use the backup command.

The backup command does not load `.env` itself. Set `DATABASE` in its process environment if the database is not at the default path. If encryption uses an environment key, preserve that key separately.

A fresh checkout without restored data starts a new empty workspace. This is useful for isolated development, but it will not contain the current provider configuration or chat history.

## Configure integrations

Use [ADMIN_GUIDE.md](ADMIN_GUIDE.md) for model providers, S3, embeddings, and routing. Use [OPERATIONS.md](OPERATIONS.md) for OIDC, database URLs, and backups.

- **Models** keeps the original default chat connection.
- **Providers** adds local or hosted engines and approved models. Discovery does not approve names automatically.
- TypeSafe base URL: `https://api.typesafe.ai/v1`. Approve an available Jev model and enter your own key.
- A local decision endpoint must implement the documented JSON choice contract.
- Enable decision routing, choose its provider/model, and set the threshold. The user then enables **Use decision model** beneath the composer.
- Hosted decision providers receive the question, recent text, and filenames. They do not receive image bytes in the decision call.
- S3 must be configured before private uploads. Test the actual Huawei bucket.
- The application does not automatically read `OPENAI_API_KEY` to configure a provider. Use the admin panel.
- Never commit credentials or put plaintext keys in documentation.

## Verification status

At feature baseline `f80ea86`, 46 application tests and all eight browser workflows passed. Three live PostgreSQL tests were skipped because no isolated database URL was supplied. Model and Jev tests used local fixtures, not live hosted inference.

For the SNGPL branding and handoff change, the TypeScript/Vite build, all eight browser workflows, and formatting checks passed. The logo asset loaded in the login and sidebar checks. API behavior did not change; the 46-test application baseline above remains the latest API run.

```powershell
npm run build
npm test
npm run test:browser
npm run format:check
```

Browser tests use Microsoft Edge and an isolated fixture service on port 8091. Generated screenshots are ignored under `data/react-*.png`. Set `RAAZI_TEST_DATABASE_URL` only to a disposable pgvector database for live database tests.

## Startup fix

The development launcher generates its temporary signing secret with .NET cryptographic randomness. This avoids Windows PowerShell stripping quotes from a Node inline command. It preserves a valid process signing secret and stops early if a supplied value is too short. It does not change the database encryption key.

## Next useful work

The 5 October setup adds a Podman overlay for the existing `podnet10` network and Portal password plus authenticator sign-in matching Aigate's API contract. Read [PODMAN.md](PODMAN.md). Configure explicit `PORTAL_ADMIN_USERS`; no first-login admin is assigned. Portal validation does not supply verified AD groups. Existing OIDC behavior is retained. Real Portal, local inference, S3, and Podman container checks still require the Linux host. No production deployment or push has been performed from this PC.

Verification for this change: the TypeScript/Vite build passed. All 50 application tests passed; three live PostgreSQL tests skipped. The eight existing Edge workflows passed, and the new Portal password/OTP workflow passed on its focused rerun. Changed files pass formatting checks. The full formatting check flags 38 untouched files in this Windows checkout. Tests used the bundled Node 24 runtime; the PC's default Node 22.1 is below the required 22.12 minimum.

1. Verify a real chat provider, discovery, and approved model switching.
2. Verify the live Jev adapter with a TypeSafe account/key, or a local decision model with its JSON contract.
3. Verify the production pgvector container, history migration, backup, and restore.
4. Test enterprise OIDC claims and group permissions with AD FS or Entra ID.
5. Test the Huawei S3 endpoint, original-file access, and version references.
6. Run the production checklist in [PRODUCTION.md](PRODUCTION.md).
7. Add business action execution only after defining allowed operations, permissions, and review rules.

Streaming, OCR, quotas, durable background indexing, distributed coordination, automatic enterprise connectors, and full PostgreSQL metadata storage remain future work.

## Instructions for the next coding session

Read this file, [ARCHITECTURE.md](ARCHITECTURE.md), and the relevant guide. Inspect `git status` before editing. Preserve the user's data, encryption key, and workspace namespace. Keep the active application in TypeScript. Retain the compact, light, fixed composer and SNGPL identity unless the user asks to change them.

Continue on `dev` unless the user requests another branch. Update these documents when behavior or outstanding work changes.

## Screen-size support

The chat layout uses the available viewport height. Short laptop screens use a smaller welcome logo, less spacing, and compact suggestion cards. The composer, decision switch, and AI notice stay visible. Messages and overflow welcome content scroll above them. Narrow screens keep the history drawer. Browser checks cover desktop, laptop, tablet, phone, and landscape sizes.

Platform branding: Administration > Platform saves a display name (1-80 characters) in SQLite. Login, workspace labels, and browser title use this name. Signed-in pages refresh it within 30 seconds; reload login to see changes. Internal container names, storage, and keys stay unchanged. The SNGPL mark has no blue background.

Platform verification: TypeScript/Vite build and 57 API tests passed; three live PostgreSQL tests skipped. The focused Edge workflow passed for saving the platform name, updating the browser title, anonymous login branding, and transparent logo styling. Linux rollout remains pending.

Embedding settings include Test connection. It tests the entered endpoint, model, dimensions, and key without saving settings or changing document indexes. A blank key uses the saved key unless Remove saved embedding key is selected. Success shows the model and returned dimensions. Save still validates the connection before applying settings.

Embedding test verification: build and 58 API tests passed; three live PostgreSQL tests skipped. The Edge workspace workflow passed with the new test button. The actual Aigate embedding connection needs testing on Linux.

Models and Embeddings each have an independent Test connection button beside their save control. Tests use current form values and the saved key when the key field is blank. Model testing sends a short inference request and checks for returned text; it does not create a chat or save settings. Embedding testing checks returned vectors.

Bucket-test failures now classify known TLS, DNS, connection, authentication, and HTTP errors using fixed messages. Raw upstream messages and keys are not returned. HeadBucket can return a generic 403, which does not prove whether credentials or permissions failed. Live Pacific diagnosis still requires target-host testing.

Attachment chips show Ready with a green border after indexing. Unreadable documents show Not readable and extraction details; indexing failures remain distinct. Upload tooltip and composer help list supported file types and size limits, with images conditional on the selected model.

Knowledge indexing shows preparation, embedding section counts, and index saving. Administration polls document status every 1.5 seconds while Knowledge or Embeddings is open. Counts advance after validated batches of two sections by default; the progress bar measures embedding sections, not total elapsed time. Changed embedding endpoint/model/dimensions mark incompatible documents stale, excluded from retrieval until reindexed. A stale notice appears on Knowledge and Embeddings. Keys alone do not invalidate indexes.

Selecting a specific repository enables knowledge-only answers. It bypasses decision routing and excludes private files, images, profile evidence, and prior answers. Non-ready documents block answers with an indexing notice. Empty or insufficient results return an apology. Vector retrieval uses an initial cosine threshold of 0.35; it needs calibration against real manuals. The model returns a structured answer with citations and exact supporting excerpt quotes. Missing/invalid evidence fails closed to the apology; this validates provenance but cannot prove semantic correctness. All available knowledge retains general chat behavior.

Knowledge-only verification: build and 63 API tests passed, with three live PostgreSQL checks skipped. Edge workspace and empty-repository abstention workflows passed. Fixtures cover unsupported quotes, valid citations, unrelated vector filtering, stale indexes, and no model call for missing evidence. Live model JSON compliance and relevance threshold require testing with actual manuals.

Composer accepts file drops and multiple selection (five attachments per message). Knowledge uploads accept drops and multiple selection, process files separately, and report per-file results. Multi-file titles use filenames. PDFs with extraction warnings may still be readable: a failed embedding step is distinct from PDF extraction failure. Inference HTTP failures now include the status without returning upstream bodies.

Upload verification: build and 63 API tests passed, with three live PostgreSQL tests skipped. Edge workspace and multi-file/drop workflows passed. The reported protected manual extracted 242,861 characters but failed embeddings; its real inference failure still needs a target-host retry with the improved HTTP diagnostics.

Aigate embedding compatibility: its gateway accepts at most 16 input texts. Raazi now sends batches of at most 16 instead of 32. This fixes the identified HTTP 400 cause for large manuals; single-text connection tests were below the limit. Retry existing failed documents after updating; no re-upload, model change, or image rebuild is required.

TEI permit correction: the deployed engine has four concurrent permits and acquires one per input text before processing a batch. Raazi defaults to two texts per sequential embedding request; EMBEDDING_BATCH_SIZE can select 1-16. Existing env files need no edit to use the default. Keep the value below engine capacity to allow other requests. The TEI served-model-name mismatch is a warning, not the observed failure. Live retry is required.

Embedding HTTP 429 retry: each batch has up to four attempts, with 0.5, 1, and 2 second default waits. Numeric Retry-After is honored up to five seconds per wait. Successful batches are not duplicated; progress advances only after valid vectors arrive. Other errors are not retried. Persistent overload still fails clearly and requires a later retry or inference capacity adjustment.

Aigate rate-window handling: gateway keys permit 60 requests per minute. Its known rate-limit response now triggers a 61-second wait before retrying the same embedding batch; Retry-After waits are capped at 120 seconds. Unknown busy responses keep short retries. Index status displays Waiting for embedding capacity and resumes counts after success. No saved work is duplicated. Larger manuals may take several minute windows.

Knowledge answer compatibility: accept JSON code fences and whitespace-normalized exact evidence quotes. Malformed/unverifiable model output now reports a verification problem rather than pretending retrieval found nothing. Explicit whole-repository summary requests use representative passages from up to eight documents (12 excerpts), and disclose that the overview is sampled. Other questions retain relevance filtering. Actual manual retrieval and model compliance still need live validation.

Current knowledge behavior (supersedes the earlier JSON-evidence format): General chat is the default and never retrieves shared repositories, including when decision routing is on. Private attached files remain available in general chat. Selecting a named repository enables knowledge-only mode: normal Markdown answers with valid numbered citations; the model returns NO_EVIDENCE when excerpts cannot support an answer. Exact quote metadata and JSON formatting are no longer required. Citation validation proves references exist, not that every claim is correct; live manual checks remain required. Stale index checks, repository permissions, and sampled overview behavior remain active.

General chat / normal cited answers verification: build, 68 API tests, and all 17 Edge workflows passed. Three live PostgreSQL tests skipped without a disposable database. Added rollout checks in PRODUCTION.md. No live host deployment or real manual/model validation was performed from this PC.

Administrator routing and usage: Administration > Providers controls decision routing for all users or selected registered users. Chat has no routing switch; the server enforces the policy and ignores legacy per-chat requests. Named repositories retain their knowledge-only path and bypass decision routing. This policy routes requests only; it does not moderate or block workplace content. Existing enabled routing applies to all users until an administrator selects a narrower audience.

Administration > Usage shows rolling 24-hour, 7-day, 30-day, or 90-day totals and per-user questions, completed/failed requests, input/output tokens, token coverage, and last activity. GET /api/admin/usage is administrator-only. SQLite stores durable request counters and provider-reported chat/decision usage from this release onward. Embeddings and connection tests are excluded. Missing token metadata is not estimated; coverage shows incomplete totals. No prompt text is stored in the usage ledger. Existing chat history is not backfilled.

Routing policy and usage verification: build and 70 API tests passed. All 17 existing Edge workflows and the new Usage dashboard workflow passed. Three live PostgreSQL checks skipped without a disposable database. Real decision-provider token reporting and Linux rollout need target-host verification.

Reload navigation: the browser tab remembers the current page and conversation per user. Administration remembers its selected tab. Reload restores the conversation through the authorized API; a missing or inaccessible conversation returns to an empty chat. Logout clears the saved page. No chat content or credentials are stored in navigation state.

Administration > Backups starts an asynchronous manual backup to `<prefix>/<workspace>/backups/<timestamp-id>/`. Each set has `raazi.sqlite`, a custom-format dump for each distinct configured PostgreSQL URL, and `manifest.json` with object paths and SHA-256 hashes. SQLite uses the online backup API plus an integrity check; PostgreSQL uses pg_dump and pg_restore --list. Both tools must match PostgreSQL 17 or later. These creation checks do not prove a restore. A successful manual backup enables daily scheduling. Restore testing can be done separately and is not a UI prerequisite. Daily time uses Asia/Karachi, defaults to 02:00, and runs inside the single app process. A missed run is caught up once after restart. No overlapping backups.

Backups pause new application changes and wait for active requests and knowledge indexing before taking sequential snapshots. Do not change the databases externally during a backup. The latest seven completed sets include manual and daily backups. Retention removes only recorded backup object versions after a new set succeeds. Failed deletion is shown as cleanup pending and retries after the next backup; old objects may remain until storage permits deletion. Failed runs do not replace successful sets. Original bucket documents and environment keys require separate backup. No raw keys or environment files are added to the bucket. The existing command-line local SQLite backup remains available.

Reload and backups verification: build, 76 API/unit tests, and all 19 Edge workflows passed. Storage fixtures verify streamed small files and multipart large files; backup fixtures reopen SQLite snapshots and exercise scheduling, failure handling, and seven-set retention. PostgreSQL dump content in these fixtures is simulated. Three live PostgreSQL checks skipped. No real Pacific upload, Linux runtime build, or PostgreSQL restore was run. The administrator can enable daily scheduling after a successful manual backup; no restore confirmation is required.

Portable object metadata: new private and knowledge uploads write `<key>.metadata.json` with original filename/title, MIME, workspace, object version/size/SHA-256 and private owner or repository/group labels. Companion references are kept in SQLite and deleted with originals. Administration > Backups can refresh metadata for existing objects and export a credential-free file catalogue. New backup sets include file-catalogue.json. Permissions are snapshot recovery hints, not authorization grants. Keep metadata private and confirm target permissions independently. See [RECOVERY.md](RECOVERY.md) for full restore and file-only rebuild limits.

Portable metadata verification: build, 78 API/unit tests and all 19 Edge workflows passed. Tests cover private ownership, checksums, credential/content exclusion, catalogue authorization, permission-label refresh, companion deletion and catalogue download. Three live PostgreSQL checks skipped. Live Pacific metadata writes and target-host recovery remain unverified. Existing tracked files retain prior uncommitted backup/navigation changes; no secrets or local data were added.

Backup presentation: summary cards show last success, retained completed sets and daily schedule. Separate panels contain schedule and catalogue controls. History is collapsed by default; open a row for object paths, sizes and SHA-256. Status remains explicit and errors appear in details. All timestamps use Asia/Karachi. Backup behavior is unchanged.

Backup layout verification: build passed. Focused Edge settings and backup workflows passed, including collapsed/expanded history, catalogue download and a 390-pixel mobile layout without horizontal overflow. Desktop and mobile screenshots inspected. No server behavior or live storage integration changed.

Knowledge library browsing: users open View documents on an allowed knowledge base to see its description, total/ready counts, searchable titles and filenames, status, stored section counts and a 600-character extracted-text preview. Lists use 50-document pages and refresh every five seconds. The named knowledge base remains selected after reload within the browser tab. Chat with this repository selects it explicitly. Authenticated GET /api/library and /api/library/:id enforce repository groups on each request; unavailable repositories return 404. Private attachments, storage references, credentials and raw index errors are excluded. Your files remains a separate private section. Empty or non-ready bases show clear guidance; administrators retain all upload/index controls.

Library browsing verification: build, 80 API/unit tests and all 20 Edge workflows passed. Fixtures cover group permissions and revocation, missing authentication, search escaping, pagination, stale counts, safe response fields, preview expansion, reload and chat selection. Library screenshot inspected. Three live PostgreSQL tests skipped; target-host Library verification remains pending. No reindex or runtime image rebuild is needed.

Sidebar chat paths (9 October 2026): Knowledge library expands to show each allowed knowledge base. Knowledge bases start collapsed and open when selected for chat. Each base and General chats has a disclosure arrow, new-chat control, custom folders, and saved chats. Use Manage chat to move a chat into a folder within its section. Pinned chats also appear in Pinned. Search opens matching branches temporarily. Section disclosure state is saved per user in the browser tab; folder state remains in the database.

New conversations and folders retain repository_id in SQLite or PostgreSQL. Existing records default to General chats because their original knowledge selection was not recorded. Saved chats restore their repository and folder on open or reload. Their knowledge path remains fixed; start a new chat to use a different base. Folder moves cannot change the knowledge path. Deleting a folder keeps its chats under the same base. Removed or inaccessible bases appear under Unavailable knowledge bases; new questions still require current repository access. No existing chat content, keys, namespace, or objects are removed.

Sidebar verification: the TypeScript/Vite build, 81 application fixture tests, and all 21 Microsoft Edge workflows passed. Changed files pass formatting and whitespace checks. Three live PostgreSQL tests skipped without a disposable RAAZI_TEST_DATABASE_URL. The PostgreSQL import test now covers retained repository paths but still requires that live test database. Real Jev, AD, Huawei S3, and production rollout remain target-environment checks.

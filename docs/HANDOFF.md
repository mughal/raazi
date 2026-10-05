# Development handoff

Updated: 5 October 2026. This file is the starting point for work on another PC.

## Current project

- Product: **Raazi**, now with SNGPL branding.
- Repository: https://github.com/mughal/raazi.git
- Working branch: `dev`.
- Current PC checkout: `D:\Old-F\sngpl\rnd\raazi`.
- Planned Linux checkout: `/opt/rnd/raazi`, using Podman in the existing Aigate context.
- Tracked deployment templates: `env.sample.qa` and `env.sample.prod`. Copy to ignored `.env.qa` or `.env.prod`. The supplied systemd unit uses `.env.qa`.
- Linux controller: `bash raazictl [--env qa|prod] init|update|prepare|start|status|stop|restart|logs`. Only `prepare` builds/downloads images. Update fast-forwards the current upstream; service controls use existing images. Shell contract checks run with `bash tests-shell/raazictl.test.sh`.

- Stack: React, TypeScript, Node.js, Express, SQLite, optional PostgreSQL/pgvector, S3-compatible storage.
- Feature baseline before this branding/documentation change: `f80ea86`.
- Local preview: http://127.0.0.1:8080. A running preview is not transferred through Git.

Use the latest `origin/dev` commit. The architecture and guides are committed with the code. Do not rely on the chat transcript to reconstruct decisions.

Controller contract checks passed with mocked Git and Podman on Windows Git Bash. They cover preflight failures before restart, no implicit build/pull, volume-preserving teardown, clean fast-forward updates, environment selection, and operational values read without shell execution. The symlink check skipped because Git Bash created a copy instead of a real link. Actual Podman provider behavior and the Linux symlink still need host verification.

## What has been built

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

# Operations guide

For production containers and rollout steps, use the [production guide](PRODUCTION.md).

## Run the application

Use Node.js 22.12 or later. Run one Node application process.

```powershell
npm ci
npm run build
npm start
```

Keep the working directory at the repository root. The application reads SQL schema files there.

Start and watch commands load an ignored `.env` file if it exists. Process environment values take precedence. See `.env.example`.

A local mutex serializes indexing, deletion, and embedding changes. Distributed locks and a durable job queue are not implemented.

## Configure enterprise sign-in

Register a confidential OIDC web application in AD FS or Entra ID. Set an explicit HTTPS callback.

| Variable             | Set this value                                           |
| -------------------- | -------------------------------------------------------- |
| `AUTH_MODE`          | `oidc`                                                   |
| `SECRET_KEY`         | A stable random signing secret of at least 32 characters |
| `ENCRYPTION_KEY`     | A stable base64-encoded 32-byte encryption key           |
| `OIDC_DISCOVERY_URL` | The provider's HTTPS discovery URL                       |
| `OIDC_CLIENT_ID`     | The registered client ID                                 |
| `OIDC_CLIENT_SECRET` | The registered client secret                             |
| `OIDC_REDIRECT_URI`  | The exact HTTPS callback                                 |
| `ADMIN_GROUP`        | The exact provider group ID for admins                   |
| `COOKIE_SECURE`      | `true`                                                   |

Generate each secret separately:

```powershell
node -e 'console.log(require("node:crypto").randomBytes(32).toString("base64url"))'
```

Set `HOST`, `PORT`, and `DATABASE` if needed. The defaults are `127.0.0.1`, `8080`, and `data/raazi.db`.

Run the application behind an HTTPS reverse proxy. Forwarded headers are not trusted. Keep development sign-in local.

Raazi verifies signed identity claims. It uses authorization code flow, PKCE, state, and nonce. Configure name, email, and group claims. Department and job title are optional.

Use exact group IDs. Group-overage claims are not expanded through Graph. Missing groups grant no restricted or admin access. Logout ends the Raazi session. It does not end provider SSO.

Direct LDAP sign-in and IIS integrated Windows authentication are not implemented.

## Start PostgreSQL with pgvector

One PostgreSQL service can store history and semantic vectors.

```powershell
# Set POSTGRES_PASSWORD in the environment or ignored .env.
docker compose up -d vectors
docker compose ps
```

Set this application variable. URL-encode the password:

```text
VECTOR_DATABASE_URL=postgresql://raazi:<password>@127.0.0.1:5432/raazi_vectors
```

Restart Raazi after you set it.

`compose.yaml` uses `pgvector/pgvector:0.8.6-pg17`. It has a persistent volume, a health check, and a local port.

`VECTOR_DATABASE_URL` also selects PostgreSQL for chat history. Set `CHAT_DATABASE_URL` to override history storage. An explicitly empty `CHAT_DATABASE_URL` keeps history in SQLite.

The database role needs table, index, and extension privileges. A DBA can create the required extension first.

## Know where data is stored

| Store                        | Data                                                                                           |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| S3-compatible object storage | Original uploaded documents and images                                                         |
| SQLite                       | Users, settings, permissions, audit entries, extracted text, source IDs, and object references |
| PostgreSQL, when configured  | Chat messages, groups, pins, folder state, and semantic vectors                                |
| SQLite, without PostgreSQL   | Local chat history and exact-search vectors                                                    |

Manually entered knowledge text and legacy document originals remain in SQLite. Existing uploads are not moved to S3 automatically.

PostgreSQL vector tables use `raazi_vectors_<dimensions>` names and cosine HNSW indexes. Private uploads use a separate namespace for each owner. Retrieval filters selected files and current source metadata.

Without PostgreSQL, Raazi performs exact cosine search over local vectors. Without embeddings, it uses SQLite FTS5.

The stores do not share a transaction. Ready metadata is published after vector writes. Metadata checks exclude orphan vectors. Failed deletion keeps the current file metadata for retry. A bulk delete can finish some files before it stops on a failure.

An interrupted S3 request can leave an object without metadata. Retain storage logs and use your bucket lifecycle policy for temporary test objects.

## Preserve existing data

The application keeps the earlier SQLite schema, document source IDs, profiles, workspace namespace, and PostgreSQL table names.

Keep the existing database and encryption key. Legacy Fernet credentials remain readable. New credentials use AES-256-GCM.

The first PostgreSQL startup imports SQLite chat history in one transaction. An import marker prevents duplicate imports. Retained SQLite history becomes a stale snapshot. It is not automatic failover storage.

Configured PostgreSQL failures are shown to the user. Raazi does not silently switch new chats to SQLite.

## Back up and restore

Back up all stores together. A SQLite backup does not include S3 objects or PostgreSQL.

1. Stop new writes for a consistent application backup.
2. Run `npm run backup`.
3. Back up PostgreSQL with your database tools.
4. Back up every bucket and object version referenced by Raazi.
5. Preserve the signing secret and encryption key.
6. Record the application commit and storage configuration.
7. Test the restore before you need it.

The backup command uses SQLite's online backup API. It copies the local encryption key into a dated `data/backups/` folder. If `DATABASE` is customized, set it in the command environment. The backup command does not load `.env` itself.

Preserve an externally supplied `ENCRYPTION_KEY` in your secret system. Retain old bucket credentials while originals use them.

Restore matching databases, keys, and objects before you restart. Rollback to the Python version needs the matching pre-conversion backup because it cannot read newly written AES credentials.

Protect data and backups with OS permissions and disk encryption. Model and S3 keys are encrypted by the application. Other stored content is not.

## Verify a release

```powershell
npm run build
npm test
npm run test:browser
npm audit
npm run format:check
```

API tests use temporary databases. They cover access, CSRF, encrypted keys, history, document extraction, citations, private uploads, image messages, and bucket failures.

The S3 client test uses a local HTTP fixture. It checks signed requests and original bytes. It does not prove compatibility with your Huawei appliance.

Browser tests use installed Microsoft Edge, an isolated database, and mock inference. Screenshots are saved under ignored `data/react-*.png` files.

Set `RAAZI_TEST_DATABASE_URL` to an isolated pgvector database for live PostgreSQL tests. These tests skip when it is absent.

Before rollout, test the real identity provider, chat model, embedding model, image model, and S3 bucket.

## Apply deployment limits

Model requests time out after 120 seconds. S3 requests time out after 30 seconds per attempt.

Set rate and concurrency limits at deployment. Permit only approved inference and storage network targets.

Raazi does not yet provide quotas, OCR, streaming, multi-model routing, enterprise audit export, automatic connectors, or a full PostgreSQL metadata migration.

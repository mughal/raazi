# Raazi

A compact, self-hosted enterprise AI workspace. Flask + SQLite + a dependency-free browser interface. Git starts on `dev`.

## Run locally (PowerShell)

```powershell
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.lock.txt
./start-dev.ps1
```

Open http://127.0.0.1:8080 and choose **Enter development workspace**. The development login explicitly grants local administrator access. The server binds to loopback. Never expose development mode through a proxy or on a shared network.

In **Admin console → Models & settings**, enter your server's API base URL (for example `http://localhost:11434/v1`), exact model identifier, and optional API key. The backend calls `/chat/completions`. No OpenAI cloud subscription or key is needed. HTTP is supported for trusted local networks; use HTTPS for network traffic carrying confidential data.

## What works

- Private, persisted conversations with per-user access checks and deletion.
- One administrator-configured OpenAI-compatible model endpoint, optional encrypted credential, and system instructions.
- Enterprise sign-in using OIDC authorization code flow with PKCE through AD FS or Entra ID.
- First-login account provisioning; administrator role derived from an exact configured group claim.
- Names, email, department, and job title populated from signed identity claims. Admin-maintained enterprise context is included in model requests.
- Knowledge repositories with exact AD-group restrictions; unrestricted repositories are shared with all authenticated users.
- Text and Markdown ingestion, overlapping chunks, SQLite FTS5 keyword ranking, and retrieved source excerpts alongside answers.
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

## Knowledge and enterprise context

Create a repository, enter exact allowed group IDs (comma separated), then upload a `.txt`/`.md` file or paste text. Files are limited to 500 KB through the UI and 500,000 characters on the API. An empty group list grants access to all signed-in users. Administrators can access all repositories. Retrieval enforces authorization before selecting chunks, including when a repository ID is supplied directly.

The initial retrieval method is lexical FTS5 ranking, not embedding/vector search. It sends at most five 1,800-character excerpts and the last 20 messages to the model. Source references identify retrieved excerpts; they do not guarantee the model's claim is supported. Documents and profiles are treated as untrusted prompt content, but model prompt-injection resistance is not an authorization boundary.

Previously generated answers and source snapshots remain in their owner's conversation history when a repository/document is deleted or access later changes. Deletion removes future search results, not historical conversations. Define retention rules before handling sensitive enterprise records.

Enterprise profile context is currently supplied by identity claims plus admin-maintained text. Automated HR/ERP/SharePoint sync, custom business workflow execution, and external data connectors require your source schemas, permissions, and workflow rules and are not implemented yet.

## Operations and limitations

This is an MVP foundation, not Open WebUI feature parity. Streaming, multiple model routing, PDF/Office parsing, embedding retrieval, repository editing, password/LDAP login, quotas, enterprise audit export, and job queues are not included. Chat renders model output as plain text to prevent HTML injection.

SQLite keeps users, conversations, documents, and audit entries in the configured database. Back up that file consistently and preserve `ENCRYPTION_KEY` separately; losing the key makes saved model credentials unreadable. Protect the data directory with OS permissions and disk encryption: only model API credentials are encrypted at the application layer. Development generates an ignored `data/encryption.key` automatically. Production requires explicit secrets.

Only trusted administrators should configure model URLs: internal network endpoints are intentionally allowed for local inference. Restrict backend egress to approved inference hosts in deployment. Put rate limiting and request concurrency controls at your reverse proxy. Model requests are synchronous with a 120-second read timeout. Review context budgets for your selected model. No hosted deployment or remote Git repository is created.

## Verification

```powershell
.venv/Scripts/python -m pytest -q
node --check static/app.js
```

Tests use a temporary SQLite database and mocked inference responses; no live model or AD connection is required. They cover authentication/CSRF, admin permissions, disabled accounts, conversation isolation, knowledge-group filtering, encrypted credentials, document removal, invalid inputs, and failed model requests. Validate real identity claims and a live inference response in your environment before rollout.

Protocol references: [Microsoft OIDC](https://learn.microsoft.com/en-us/entra/identity-platform/v2-protocols-oidc) and [vLLM OpenAI-compatible server](https://docs.vllm.ai/en/latest/serving/online_serving/openai_compatible_server/).

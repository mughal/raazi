# Raazi

Raazi is a small enterprise AI workspace. React runs the interface. TypeScript and Node.js run the API. Users sign in through AD-backed OIDC or Portal password and authenticator validation. Admins configure chat providers, approved models, optional decision routing, and embedding models. The interface carries SNGPL branding.

## Start locally

Install Node.js 22.12 or later. Run these commands from the repository root:

```powershell
npm ci
./start-dev.ps1
```

Open [Raazi](http://127.0.0.1:8080). Select **Continue as local administrator**. Development sign-in gives admin access. Keep this mode on the local computer.

For automatic reload, run `./start-dev.ps1 -Watch`. Open port 5173.

## Configure Raazi

For Linux QA, copy `env.sample.qa` to `.env.qa` and fill its settings. For production, copy `env.sample.prod` to `.env.prod`. The sample files belong in Git; the filled files are ignored. See the Podman guide for startup commands.

Use `bash raazictl init`, then edit the environment file. Run `bash raazictl prepare` explicitly to build/download images. Normal controls are `start`, `status`, `stop`, `restart`, and `update`; none build or download images. Start compiles the mounted checkout with cached dependencies. Ordinary code updates need only `update` and `restart`; use `prepare deps` separately when dependencies change. `update` fast-forwards the current Git upstream without restarting services. Use `--env prod` before the command for production.

1. Open **Administration → Models**. Set the local model URL and name.
2. Open **Storage**. Set your S3-compatible endpoint, bucket, and keys.
3. Select **Test bucket**. Then select **Save storage settings**.
4. Open **Embeddings**. Set an embedding model, or keep keyword search.
5. Open **Knowledge**. Create a repository and upload its documents.
6. Open **Providers** to add engines, discover model names, and approve chat models.
7. Configure **Decision routing** if you want Jev or a local JSON model to route chat requests.

Use **+** in chat to upload private documents or images. Image questions need a local vision model. Original uploaded files go to object storage.

## Read the guides

| Guide                                  | Use                                                                         |
| -------------------------------------- | --------------------------------------------------------------------------- |
| [Architecture](docs/ARCHITECTURE.md)   | Components, data flows, decisions, and limits                               |
| [Handoff](docs/HANDOFF.md)             | Resume on another PC and preserve local data                                |
| [User guide](docs/USER_GUIDE.md)       | Chats, folders, uploads, and citations                                      |
| [Admin guide](docs/ADMIN_GUIDE.md)     | Models, S3 storage, embeddings, and access                                  |
| [Production guide](docs/PRODUCTION.md) | Production containers, HTTPS, and rollout                                   |
| [Podman guide](docs/PODMAN.md)         | Linux setup in `/opt/rnd/raazi`, Portal OTP, and existing inference engines |
| [Operations guide](docs/OPERATIONS.md) | Identity, PostgreSQL, backups, and tests                                    |

The guides use short sentences, active voice, and direct instructions. They follow ASD-STE100 principles with some technical terms retained. They are not a certified STE document. The target is approximately 80% adoption of the style.

## Data stores

One PostgreSQL container with **pgvector** can store chat history and vectors. You do not need a separate vector database. S3 stores the original uploaded files. SQLite still stores users, settings, permissions, extracted passages, and file references.

Without PostgreSQL, Raazi stores history and vectors in SQLite. Without an embedding model, it uses keyword search.

## Development

```powershell
npm run build
npm test
npm run test:browser
npm run format:check
```

Run `npm start` to serve the compiled application. Keep the process in the repository root. The server reads its SQL schemas there.

| Folder      | Content                            |
| ----------- | ---------------------------------- |
| `client/`   | React interface                    |
| `server/`   | API, sign-in, search, and storage  |
| `shared/`   | Shared TypeScript types            |
| `tests-ts/` | API and browser tests              |
| `docs/`     | User, admin, and operations guides |

The Git development branch is `dev`. The Python version remains in Git history.

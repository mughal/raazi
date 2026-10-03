# Raazi

Raazi is a small enterprise AI workspace. React runs the interface. TypeScript and Node.js run the API. Users sign in through an AD-backed OIDC provider. An admin selects the local chat and embedding models.

## Start locally

Install Node.js 22.12 or later. Run these commands from the repository root:

```powershell
npm ci
./start-dev.ps1
```

Open [Raazi](http://127.0.0.1:8080). Select **Continue as local administrator**. Development sign-in gives admin access. Keep this mode on the local computer.

For automatic reload, run `./start-dev.ps1 -Watch`. Open port 5173.

## Configure Raazi

1. Open **Administration → Models**. Set the local model URL and name.
2. Open **Storage**. Set your S3-compatible endpoint, bucket, and keys.
3. Select **Test bucket**. Then select **Save storage settings**.
4. Open **Embeddings**. Set an embedding model, or keep keyword search.
5. Open **Knowledge**. Create a repository and upload its documents.

Use **+** in chat to upload private documents or images. Image questions need a local vision model. Original uploaded files go to object storage.

## Read the guides

| Guide                                  | Use                                        |
| -------------------------------------- | ------------------------------------------ |
| [User guide](docs/USER_GUIDE.md)       | Chats, folders, uploads, and citations     |
| [Admin guide](docs/ADMIN_GUIDE.md)     | Models, S3 storage, embeddings, and access |
| [Production guide](docs/PRODUCTION.md) | Production containers, HTTPS, and rollout  |
| [Operations guide](docs/OPERATIONS.md) | Identity, PostgreSQL, backups, and tests   |

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

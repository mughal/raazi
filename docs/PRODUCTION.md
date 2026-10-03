# Production deployment

Use this guide to prepare a single production host. Use a Linux host with Docker Compose and an HTTPS reverse proxy. The application runs one Node process.

This repository includes a production Dockerfile, Compose file, environment template, and Nginx example. These are deployment templates. Test them on a staging host before rollout.

## Prepare the host

1. Select an internal DNS name, such as `raazi.example.com`.
2. Install Docker Engine and Docker Compose.
3. Install Nginx, or use your existing HTTPS proxy.
4. Obtain a trusted TLS certificate for the DNS name.
5. Permit HTTPS access to the host.
6. Permit outbound access to your identity provider, local models, and S3 service.
7. Keep port 8080 and the database port private.

The Compose file publishes the app only on the host's loopback address. PostgreSQL has no published port.

Use internal model and S3 DNS names that the app container can resolve. Inside the container, `localhost` means the container itself.

## Register enterprise sign-in

Register a confidential web client in AD FS or Entra ID.

Set the callback to `https://raazi.example.com/auth/callback`. Use the exact production name. Configure name, email, and group claims. Set an admin group ID.

Direct LDAP sign-in and integrated Windows authentication are not available. See the [operations guide](OPERATIONS.md) for OIDC details.

## Set secrets and configuration

1. Clone the repository on the host.
2. Select a reviewed release commit.
3. Copy `.env.production.example` to `.env.production`.
4. Fill every required value.
5. Restrict file access to the deployment account.
6. Set `RAAZI_IMAGE_TAG` to the release commit.

Generate separate random signing and encryption keys for a new installation. See the operations guide.

For an existing installation, preserve its encryption key and database. Do not generate a replacement encryption key. Keep the signing key stable too.

Set `PRODUCTION_DATABASE_URL` to:

```text
postgresql://raazi:<URL-encoded-password>@vectors:5432/raazi_vectors
```

Use the same password as `POSTGRES_PASSWORD`. URL-encode special characters in the URL. `vectors` is the database service name.

The Compose file forces OIDC sign-in and secure cookies. Do not run `start-dev.ps1` on a production host.

Secrets are supplied through the process environment. They are not stored in the image. Keep the environment file out of Git. Limit Docker administration to trusted operators.

## Start the services

Run these commands from the repository root:

```bash
docker compose --env-file .env.production -f compose.production.yaml config --quiet
docker compose --env-file .env.production -f compose.production.yaml up -d --build
docker compose --env-file .env.production -f compose.production.yaml ps
docker compose --env-file .env.production -f compose.production.yaml logs --tail=100 app
```

The app runs as the Node user. Named volumes keep SQLite and PostgreSQL data. Container replacement does not remove these volumes.

The HTTP health check tests the app response. It does not test the identity provider, models, S3 bucket, or all database operations.

Image building needs access to the Node image, system build packages, and npm packages. Python is a native-module build tool in the builder stage. The final application runtime uses Node.js.

## Enable HTTPS

Use `deploy/nginx.conf.example` as a starting point.

1. Replace its hostname and certificate paths.
2. Install it as an Nginx site configuration.
3. Run `nginx -t`.
4. Reload Nginx.
5. Open the HTTPS URL.

The example expects Nginx and Docker on the same host. A containerized or remote proxy needs a different upstream address.

The proxy accepts 21 MB request bodies for 20 MB uploads plus form overhead. It permits a 300-second upstream wait for synchronous ingestion and model responses. Adjust limits to your workload. See the [Nginx proxy reference](https://nginx.org/en/docs/http/ngx_http_proxy_module.html).

If an internal service uses a private certificate authority, mount its PEM certificate in the app container. Set `NODE_EXTRA_CA_CERTS` to that container path. Do not disable TLS verification.

## Configure the application

1. Sign in with a member of the admin group.
2. Set the local chat model.
3. Enable image input only for a tested vision model.
4. Configure Huawei S3 storage. Select **Test bucket**, then save.
5. Configure and test the embedding model.
6. Create repositories with exact allowed group IDs.
7. Upload a small PDF. Ask a question. Open its page citation.
8. Upload a private file from a regular user account.
9. Confirm that another account cannot access that file or its source.
10. Test chat history and the user's color palette after sign-in on another browser.

The S3 test must pass on the real Huawei endpoint. Local test fixtures cannot verify your appliance.

## Move existing data

New production volumes start empty. They do not use the local development data folder automatically.

1. Stop writes to the old instance.
2. Back up SQLite, PostgreSQL, keys, and referenced S3 objects.
3. Restore SQLite to the app volume at `/app/data/raazi.db`.
4. Set ownership so UID 1000 can write the SQLite directory.
5. Set the original encryption key in the production environment.
6. Restore existing PostgreSQL data if you already use it.
7. Keep the existing workspace namespace.
8. Start the new instance and verify user and chat counts.
9. Reindex documents if the embedding model or vector backend changed.

If history is still in SQLite, the first configured PostgreSQL startup imports it once. Do not regenerate the namespace or discard the SQLite file.

## Operate and update

Use an approved backup schedule. Back up SQLite, PostgreSQL, S3 originals, and keys. Test a restore.

Record the release commit. Build a candidate image and test it in staging. Back up before you update production. Keep the prior image and matching backup for rollback.

Named volumes are not backups. Do not run `docker compose down -v` on production. It removes persistent data.

Set deployment rate and concurrency limits for your workload. Watch error rates, disk space, database health, and model response time.

Run one app replica. Multiple replicas require a durable job queue and distributed coordination, which are not implemented.

For Docker build and Compose behavior, see the [Docker build specification](https://docs.docker.com/reference/compose-file/build/).

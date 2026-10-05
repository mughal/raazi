# Linux Podman deployment

Use `/opt/rnd/raazi` and the `dev` branch. The active application is React, TypeScript, and Node.js. Run one app container and one PostgreSQL/pgvector container. Use your existing vLLM, embedding server, and S3 service. No inference engine is downloaded or started by this setup.

The overlay joins both services to the external `podnet10` network used by Aigate. Both also share the application network, where the database name is `vectors`. Run Podman in the same root or rootless context that owns `podnet10`. The existing Aigate host uses root Podman.

QA selects `RAAZI_APP_IP=192.168.10.40` and `RAAZI_POSTGRES_IP=192.168.10.41`. The production sample selects `.42` and `.43` on the same subnet. Check the addresses against other running and stopped container configurations before starting. The supplied network snapshot showed Aigate at `.37` and vLLM at `.32`; it did not show these Raazi addresses in use. Existing environment files are not overwritten by `init`, so add these settings manually when upgrading. PostgreSQL now has an address reachable by other containers on `podnet10`; its port is still not published on the host. Keep using `vectors` in the database URL.

## Prepare configuration

Install Podman and a Compose provider such as `podman-compose`. `podman compose` calls an external provider. See the [Podman Compose reference](https://docs.podman.io/en/latest/markdown/podman-compose.1.html).

From the existing checkout:

```bash
cd /opt/rnd/raazi
git status --short --branch
git switch dev
git pull --ff-only origin dev
podman network inspect podnet10 >/dev/null
bash raazictl init
```

Preserve local changes before updating. Do not recreate an existing environment file. Set these values privately in `.env.qa`:

```dotenv
AUTH_MODE=portal
PORTAL_API_URL=https://portal.sngpl.com.pk/portalAppsApi
PORTAL_ADMIN_USERS=your-approved-admin-username
CONTAINER_LOG_DRIVER=k8s-file
INFERENCE_NETWORK=podnet10
```

Supply `SECRET_KEY`, `ENCRYPTION_KEY`, `POSTGRES_PASSWORD`, and `PRODUCTION_DATABASE_URL` too. Generate two independent 32-byte base64url values for the signing and encryption keys. Use a strong database password, and URL-encode it in `PRODUCTION_DATABASE_URL`. The database host in that URL is `vectors`. Preserve existing keys when migrating a workspace. The tracked `env.sample.qa` and `env.sample.prod` files contain placeholders. `raazictl init` creates a missing `.env.qa`; `raazictl --env prod init` creates a missing `.env.prod`. Both filled files are ignored by Git. Existing files are preserved. The Compose project names keep QA and production volumes separate; preserve the existing project name when migrating data. Both deployments use port 8080, so they cannot run on the same host port at once.

Portal mode uses the same APIs as Aigate: `validateUserFromLdap`, then `authenticator/validateOtp`. Enter the Portal username, password, and six-digit authenticator code. Both checks must pass. Passwords and OTPs are not stored. Challenges expire after five minutes and permit five code attempts. A process restart clears pending challenges.

Portal validation does not supply verified AD group memberships or profile fields. New users receive the user role and no repository groups. Only usernames in `PORTAL_ADMIN_USERS` receive the admin role. There is no automatic first-user administrator. Restricted repositories need OIDC group claims or a future verified group integration. Existing disabled accounts remain disabled. Existing OIDC users and Portal users have separate identities and histories; changing modes does not merge them.

For AD FS or Entra SSO, keep `AUTH_MODE=oidc` and set the OIDC variables instead. Portal password plus OTP is a two-step sign-in, not federated SSO. OIDC remains supported.

## Control the services

Use `raazictl` to manage the two Raazi services. QA is the default. For production, put `--env prod` before the command. The script selects the environment file and Compose files. The Podman overlay includes the app's `env_file`; the script also supplies the selected file for Compose variable substitution. Operational project, image-tag, and network names must be literal values, optionally quoted. Environment files are read as data and never executed.

```bash
bash raazictl prepare
bash raazictl start
bash raazictl status
bash raazictl logs app
```

Only `prepare` builds or downloads images. It pulls pgvector and builds the app. The initial build needs access to the image registry, Debian packages, and npm. Use `prepare app` to rebuild only Raazi or `prepare vectors` to download only PostgreSQL. Imported images can also satisfy startup checks. Preparation does not stop or start services.

`start` checks both local images, the inference network, and Compose configuration before `up -d --no-build`. The runtime Compose files contain no build recipe; the Podman overlay sets both pull policies to `never`. Missing prerequisites fail without downloading or building. Use a provider that supports pull policies and the health-check dependency.

`stop` uses Compose `down` without removing volumes. `restart` checks prerequisites before taking services down, then brings them up from existing images. The image runs as UID 1000. Named volumes preserve SQLite and PostgreSQL across container replacement. An existing app volume must permit UID 1000 to write its directory. Do not run `down -v`.

For updates:

```bash
bash raazictl update
# If application code changed, prepare its image explicitly before restarting.
bash raazictl prepare app
bash raazictl restart
```

`update` uses `git pull --ff-only` on the current branch and upstream. A GitLab clone normally tracks GitLab as `origin`. Dirty, detached, or untracked checkouts stop with a clear message. No reset, stash, environment overwrite, image preparation, or service restart happens during update. Git changes alone do not change the running image.

To use the short command from any directory, install a symlink once:

```bash
chmod +x /opt/rnd/raazi/raazictl
ln -s /opt/rnd/raazi/raazictl /usr/local/bin/raazictl
raazictl status
raazictl --env prod status
```

If that link already exists, inspect it instead of replacing it. You can always use `bash /opt/rnd/raazi/raazictl status` without the link.

Set `RAAZI_IMAGE_TAG` to the reviewed release commit. Keep the same Compose project and Podman context when updating, so the volumes remain attached.

## HTTPS and inference

The app publishes `127.0.0.1:8080` on the Linux host. Use the existing host HTTPS proxy with `deploy/nginx.conf.example`. Do not send Portal passwords over a shared HTTP connection. A containerized proxy needs access through a shared network instead of the host loopback upstream.

After administrator sign-in, open **Administration → Providers**. Set a reachable OpenAI-compatible base URL, discover models, and approve the required chat models. On the same `podnet10` bridge, a raw vLLM service may use `http://vllm:8000/v1`. Use your actual service name and port. For Aigate's authenticated gateway, use its gateway base URL and an application key configured in the GUI. `localhost` inside Raazi means its own container.

Set embeddings separately in **Embeddings**. A chat engine does not necessarily serve `/embeddings`. Use the actual embedding model ID and output dimensions. Configure and test S3 in **Storage** before uploading original files. An additional object-store container is unnecessary when an existing S3 service is available.

The model credentials belong in the GUI, not Git. A private CA must be trusted by the Node container; follow `PRODUCTION.md`. Do not disable certificate validation.

## Start after reboot

For the existing root Podman context, install the supplied unit after a successful initial build and start:

```bash
install -m 0644 deploy/raazi.service /etc/systemd/system/raazi.service
systemctl daemon-reload
systemctl enable --now raazi.service
```

The unit uses `raazictl start` and `raazictl stop`, selecting `.env.qa`. For production, add `--env prod` before `start` and `stop` in the installed unit. The unit starts the existing images from `/opt/rnd/raazi`. It does not build code or restart inference engines. It requires the external network to exist. A rootless installation needs a user unit and the matching user's Podman storage; do not use this root unit for it.

## Verify on the server

1. Confirm both containers are healthy.
2. Sign in with the real Portal password and authenticator code. Check an allowed admin and a regular user.
3. Discover and approve the real local chat model. Send a question.
4. Save tested embedding settings. Index a small document. Ask a question and open its citation.
5. Test the real S3 bucket and a private upload. Verify another user cannot read it.
6. Restart the app and confirm history, settings, and files remain available.
7. Back up SQLite, PostgreSQL, keys, and referenced S3 objects. Test a restore before rollout.

PC build and fixture tests cannot establish server connectivity, real Portal authentication, pgvector readiness, or S3 compatibility. Live PostgreSQL tests require a disposable `RAAZI_TEST_DATABASE_URL`, as described in `OPERATIONS.md`.

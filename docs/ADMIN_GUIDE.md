# Admin guide

## View and end sessions

Open **Administration → Sessions**. The page shows users with unexpired sessions, their roles, browsers, sign-in times, last activity, and expiry. **This session** marks your current browser. **Recently active** means an authenticated request within five minutes; it is not proof that the user is still at the screen. Idle browsers remain signed in until expiry, logout, or revocation. The page refreshes every 30 seconds.

Use **End session** for one browser or **End all sessions for [user]** for all that user's current logins. Review the target in the confirmation dialog. Ending your own session signs you out too. The audit log records the administrator and action. The user can sign in again; use **Users → Disable account** if access must stay blocked. Ending a Raazi session does not end AD/Portal SSO elsewhere.

The server rejects subsequent requests immediately. Open browsers return to sign-in on an unauthorized response or within the next 30-second session check. A model request already in progress can finish at the inference engine, but Raazi will not save its chat answer after the session is revoked. This upgrade requires existing users to sign in once again. New sessions survive ordinary application restarts.

## Configure the local model

1. Open **Administration → Models**.
2. Enter the base URL, such as `http://llm.internal:8000/v1`.
3. Enter the model name.
4. Enter an API key if the service requires one.
5. Set the system prompt.
6. Select **Save model settings**.

Raazi calls `/chat/completions` with `stream: false`.

Set **Model display name** to your organization's preferred name, such as `Raazi Assistant`. Users see it in the composer. Keep **Model name** as the exact ID required by the inference service. For multiple approved models, open **Providers** and set a display name for each model. Blank display names keep the existing labels.

## Configure thinking

Select **Thinking control** for each chat model. For a switchable Qwen model on vLLM, select **Switchable (vLLM / Qwen: enable_thinking)**. Raazi sends `chat_template_kwargs: {enable_thinking: true|false}`. For a model whose template uses `thinking`, select that control instead. See the [vLLM reasoning documentation](https://docs.vllm.ai/en/stable/features/reasoning_outputs/).

Keep **Unavailable / engine default** for services that do not support these controls. The composer switch is disabled for that model and Raazi sends no thinking parameter. Some models always reason or always answer directly. Test your exact model and server version; a display setting cannot make a fixed-mode model switchable.

Users enable **Thinking** beneath the composer for their next requests. It starts off after reload. With decision routing, the preference applies to the chosen chat model if that model supports it. The decision model keeps its own behavior.

Reasoning returned in `reasoning_content`, `reasoning`, or leading `<think>` blocks appears under a collapsed **Thinking** icon on the reply. Select it to view the returned text. The final answer and **Copy response** exclude reasoning. Reasoning remains in private saved history but is not sent as prior context. A reply containing only reasoning fails without saving. Engines that return unmarked reasoning as ordinary prose need a server-side reasoning parser to separate it reliably.

Enable **This model accepts image input** only for a vision model. The service must accept OpenAI-compatible `image_url` message parts with base64 data URLs. Test a real image before rollout.

## Test with an OpenAI key

For a cloud test, enter your existing key in **Models → API key**. Raazi encrypts it on the server. Do not put it in frontend code or Git.

Use `https://api.openai.com/v1` as the base URL. Enter a model name available to your project that supports Chat Completions. The selected model must support image input before you enable images.

Raazi uses the key saved in model settings. Setting `OPENAI_API_KEY` on the laptop does not configure Raazi automatically. Local endpoints still work with their own settings.

See the [official OpenAI Chat Completions reference](https://developers.openai.com/api/reference/resources/chat).

## Configure S3 object storage

For Huawei OceanStor Pacific, request these details from the storage admin:

- The S3 data-service HTTPS endpoint, including FQDN and port. Do not use the management-console URL. Confirm DNS and firewall access from the Raazi host/container network.
- A private QA bucket and a separate production bucket, with the exact bucket names and tenant/account context.
- A dedicated application's object-user access key ID (AK) and secret access key (SK), delivered through an approved private channel. No storage administrator credential is needed. Huawei describes AK/SK authentication in its [Pacific integration guide](https://info.support.huawei.com/storage/docs/en-us/oceanstor-6.1.5/smartmobility-userguide/en-us_topic_0000001463754568.html).
- The region/signing value required for AWS Signature Version 4, and confirmation of S3 V4 and path-style compatibility. Do not assume the region from the appliance location or cloud examples.
- Bucket access checks and object put, get, and delete permissions under the application's prefix, including temporary `_checks/` objects. For versioned buckets, permit retrieval and deletion of the referenced version. The app does not need bucket creation or administrator access.
- The trusted CA chain in PEM format if the endpoint uses a private CA. The endpoint hostname must match its certificate. Configure Node trust through `NODE_EXTRA_CA_CERTS` and a mounted certificate file as described in the production guide.
- Quota, backup/restore, retention, encryption, and versioning policies. Ensure retention locks do not block the application's required deletes or temporary bucket tests. Do not expire objects still referenced by saved chats or documents.

The exact Pacific software version and enabled S3 feature set are useful for compatibility checks. Enter the endpoint, region, bucket, AK/SK, and prefix in **Administration → Storage**, then use **Test bucket**. Raazi uses single-object writes with Content-MD5 and AWS V4 signing. A successful test checks access, write, read, and delete, but does not prove backup/restore or every appliance feature.

Use **Administration → Storage**. Raazi supports an S3-compatible endpoint, including a suitably configured Huawei OceanStor Pacific service.

1. Create a private bucket on the storage service.
2. Create credentials for Raazi.
3. Select **Enable file uploads**.
4. Enter the S3 endpoint and bucket.
5. Enter the region required by your service.
6. Set an object prefix, such as `raazi`.
7. Start with **Use path-style bucket addresses** enabled.
8. Enter the access key and secret key.
9. Select **Test bucket**.
10. Check the result. Then select **Save storage settings**.

The test uses the values in the form. It does not save them.

The test checks bucket access, writes a temporary object, reads its bytes, and deletes it. Save runs the same test before it changes the configuration. A failed test leaves the saved configuration unchanged.

Permit bucket access and object write, read, and delete operations. For a versioned bucket, permit access to the saved object version. The test deletes its returned version if the service returns a version ID.

If cleanup fails, the error shows the test object key. Remove that object before you retry. A service timeout can leave an object behind. Configure a cleanup policy for old objects under `_checks/`.

The endpoint uses AWS Signature Version 4. Uploads send a Content-MD5 value. Optional AWS streaming checksum behavior is disabled for compatibility. Confirm the required region, signing, certificate, and address style with your storage admin.

Use HTTPS in production. For a private certificate authority, set `NODE_EXTRA_CA_CERTS` to the trusted PEM certificate file before Node starts.

New uploads require enabled object storage. This includes admin repository uploads. Text entered with **Add text directly** remains in SQLite.

## Keep storage credentials and old files

Both S3 keys are encrypted in SQLite. The API returns saved-key indicators. It does not return plaintext keys.

Leave the key fields blank to keep saved keys on the same endpoint. A different endpoint requires both keys.

A new endpoint or bucket affects new uploads. Existing files keep their original storage reference. Raazi keeps the old storage configuration so it can read and delete those originals.

Do not remove an old bucket or revoke its credentials while files still use it. To rotate keys for an old endpoint and bucket, save that target with its new keys. Then restore the desired active target.

Turning uploads off blocks new uploads. Existing files remain readable and can still be deleted.

## Configure embeddings

1. Open **Embeddings**.
2. Select **Use an embedding model**.
3. Enter the base URL, model name, and optional API key.
4. Enter the model's actual vector dimensions.
5. Select **Save embedding settings**.

Saving tests `/embeddings`. Raazi checks response indices, dimensions, finite numbers, and nonzero vectors. It accepts dimensions from 1 to 2,000. It does not request vector truncation.

Changing the endpoint, model, dimensions, or vector backend requires reindexing. Key-only changes keep valid vectors. Reindex shared repositories in **Knowledge**. Users reindex private uploads in **Your files**.

Keep embeddings disabled to use SQLite FTS5 keyword search.

## Create shared knowledge

1. Open **Knowledge**.
2. Create a repository.
3. Enter the exact allowed identity-provider group IDs.
4. Select the repository in the upload form.
5. Upload a PDF, DOCX, TXT, or Markdown file.
6. Check its status.

An empty group list permits all signed-in users. Admins can access all shared repositories. Private chat uploads remain restricted to their owner, including when another user is an admin.

An index failure keeps the original and extracted text. Use **Retry** or **Reindex**. An invalid repository file is rejected before it creates a document.

Raazi retrieves only authorized, ready passages. It combines private files and the selected repositories. Answers can cite up to eight passages.

## Manage users

Users receive name, email, groups, and optional department or job title from identity claims. Add enterprise context through the admin user controls.

Disable a user to block subsequent requests. Group membership refreshes at sign-in. Sessions expire after eight hours.

Automated enterprise profile synchronization, workflow execution, repository editing, and connectors are not implemented yet.

## Storage references

Huawei describes Pacific object storage as compatible with Amazon S3. Compatibility still needs a test on your appliance and firmware. See the [Huawei Pacific product brochure](https://e-file.huawei.com/en/material/MaterialDownload?materialid=62dc143d87474955a82a43cb23d9567c).

For AWS SDK checksum settings, see the [AWS JavaScript SDK guide](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/s3-checksums.html).

For the writing standard, see [ASD-STE100 Issue 9](https://www.asd-ste100.org/assets/files/ASD-STE100_ISSUE9.pdf).

## Providers and decision routing

Open **Administration → Providers**.

1. Add a provider name and its base URL. Include `/v1` when required.
2. Select **OpenAI-compatible** for a local or hosted chat engine. Select **TypeSafe Jev** for TypeSafe.
3. Set **Provider use**. Use **Decision models only** for a local router. TypeSafe is always a decision provider.
4. Enter a key if required. Keys stay encrypted on the server. A blank field keeps a saved key.
5. Add approved model names, one per line. Save the provider.
6. Select **Discover models**. Select the names to approve, then save. Discovery does not enable models by itself.
7. Enable image input only if every approved chat model in that provider supports it. Split text and image models into separate provider entries if necessary.

The existing **Models** tab remains the default connection. Its model also appears in the user's model menu. You can use providers without configuring this default connection. Users see only enabled, approved chat models. Disabling a provider removes its models from the menu.

To enable routing:

1. Add a TypeSafe or local decision provider and approve its decision model name.
2. Configure at least one chat model.
3. Select the decision provider and model under **Decision routing**.
4. Set the minimum confidence. The default is 0.80.
5. Choose a default chat model if needed.
6. Select **Enable decision routing** and save.

TypeSafe's base URL is `https://api.typesafe.ai/v1`. The adapter uses `POST /systemone` with two named choice questions: action and target. See the [TypeSafe API](https://api.typesafe.ai/redoc).

A local decision engine uses `POST /chat/completions` with JSON output. It must return `answers.action` and `answers.target`. Each answer has `type: "choice"`, a permitted `choice`, a `confidence` from 0 to 1, and a probability for every supplied criterion. Probabilities must sum to approximately 1, and the selected choice must have the highest probability. The request includes the exact criteria.

The router can select a chat model, search permitted knowledge, answer directly, or ask for clarification. An explicit repository selection or attached document keeps knowledge retrieval active. Images can route only to image-capable chat models. No tool execution, business workflow action, or external system update is included in this release.

The decision provider receives the question, up to ten recent messages, and filenames. It does not receive image bytes, the enterprise profile, or retrieved document passages. Hosted providers therefore receive this conversation content. Chat providers still receive the context needed to answer.

The lower of the two confidence scores must meet the threshold. Otherwise, Raazi asks for clarification without calling a chat model. A malformed response or service failure stops the request and preserves history. Disable routing before deleting or disabling its decision provider.

Credentials and provider settings remain in the application metadata database. Chat history continues to use PostgreSQL when configured. Provider discovery uses authenticated `GET /models`; enter approved names manually if an engine does not implement discovery.

Platform branding: Administration > Platform saves a display name (1-80 characters) in SQLite. Login, workspace labels, and browser title use this name. Signed-in pages refresh it within 30 seconds; reload login to see changes. Internal container names, storage, and keys stay unchanged. The SNGPL mark has no blue background.

Embedding settings include Test connection. It tests the entered endpoint, model, dimensions, and key without saving settings or changing document indexes. A blank key uses the saved key unless Remove saved embedding key is selected. Success shows the model and returned dimensions. Save still validates the connection before applying settings.

Models and Embeddings each have an independent Test connection button beside their save control. Tests use current form values and the saved key when the key field is blank. Model testing sends a short inference request and checks for returned text; it does not create a chat or save settings. Embedding testing checks returned vectors.
